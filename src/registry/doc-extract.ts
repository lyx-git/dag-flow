// src/registry/doc-extract.ts — 文档文本抽取内核（PDF / Office / 纯文本），**零依赖、纯函数**
//
// 设计取舍（与 yaml-lite 同一思路：够用即止，不为极端格式写全套解析器）：
//   · Office（docx/xlsx/pptx）本质是 ZIP + XML：自己读 zip（中央目录 + stored/deflate），
//     再从 document.xml / sharedStrings+worksheets / slides 里取文本 —— 不需要任何第三方库。
//   · PDF：解析对象表 + FlateDecode 流，抽取 BT…ET 里的 Tj/TJ 文本；字形→Unicode 走
//     ToUnicode CMap（中文 PDF 通常带），没有 CMap 时按 Latin-1 兜底。
//   · **不做 OCR**：扫描版（图片型）PDF 没有文本层 → 明确报 DOC_NO_TEXT_LAYER，提示另走 OCR。
//   · **加密 PDF**（trailer 带 /Encrypt）→ 明确报 DOC_ENCRYPTED，别报成"扫描版"误导用户去 OCR。
//   · 旧版 .doc/.xls/.ppt 是 OLE2 二进制 → 明确报 DOC_UNSUPPORTED 并提示"另存为 docx/xlsx/pptx"。
//
// 本文件不依赖 DSH / ctx，可被单测直接调用（见 test/doc-extract.test.mjs）。

import { inflateRawSync, inflateSync } from 'node:zlib';
import { extractPdf } from './doc-pdf.js';

/** 带错误码的解析异常（错误码与 docs/ERROR_REFERENCE.md 对齐） */
export class DocError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocError';
    this.code = code;
  }
}

export interface DocResult {
  /** 归一化后的格式名：pdf / docx / xlsx / pptx / text / html / csv / json / markdown */
  format: string;
  /** 抽取出的纯文本 */
  text: string;
  chars: number;
  /** 是否被 maxChars 截断 */
  truncated: boolean;
  /** 附加信息：页数/工作表/幻灯片/段落数、原文件名、字节数等 */
  meta: Record<string, string | number | boolean>;
}

export interface ExtractOptions {
  /** 文本上限（默认 200_000 字符；超出截断并置 truncated=true） */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 200_000;
/** 单文件字节上限（100 MB）——避免把内存吃爆 */
export const DOC_MAX_BYTES = 100 * 1024 * 1024;

// ==================== 入口 ====================

/** 按扩展名分发；buf 为该文件的原始字节 */
export function extractDocument(buf: Buffer, filename: string, opts: ExtractOptions = {}): DocResult {
  const maxChars = opts.maxChars && opts.maxChars > 0 ? opts.maxChars : DEFAULT_MAX_CHARS;
  if (buf.length > DOC_MAX_BYTES) {
    throw new DocError('DOC_TOO_LARGE', `文件过大（${(buf.length / 1048576).toFixed(1)} MB，上限 ${DOC_MAX_BYTES / 1048576} MB）`);
  }
  const ext = (/(\.[A-Za-z0-9]+)$/.exec(filename)?.[1] ?? '').toLowerCase();
  const base = filename.replace(/^.*[\\/]/, '');

  let format: string;
  let text: string;
  let meta: Record<string, string | number | boolean> = { file: base, bytes: buf.length };

  switch (ext) {
    case '.pdf':
      format = 'pdf'; { const r = extractPdf(buf); text = r.text; meta = { ...meta, ...r.meta }; } break;
    case '.docx': {
      const xml = zipEntry(buf, ['word/document.xml'], base);
      const raw = unzipText(buf);
      format = 'docx';
      text = docxToText(xml);
      meta = { ...meta, paragraphs: raw.paragraphs };
      break;
    }
    case '.xlsx': {
      format = 'xlsx'; { const r = extractXlsx(buf); text = r.text; meta = { ...meta, ...r.meta }; } break;
    }
    case '.pptx': {
      format = 'pptx'; { const r = extractPptx(buf); text = r.text; meta = { ...meta, ...r.meta }; } break;
    }
    case '.doc': case '.xls': case '.ppt':
      throw new DocError('DOC_UNSUPPORTED', `暂不支持旧版 Office 二进制格式 ${ext}（OLE2）——请在 Office 里另存为 ${ext === '.doc' ? '.docx' : ext === '.xls' ? '.xlsx' : '.pptx'} 后再解析`);
    case '.html': case '.htm': {
      format = 'html';
      const html = decodeText(buf);
      const r = htmlToText(html);
      text = r.text;
      meta = { ...meta, title: r.title };
      break;
    }
    case '.txt': case '.log': case '.md': case '.markdown': case '.csv': case '.tsv': case '.json': case '.xml': case '.yaml': case '.yml': {
      format = ext === '.md' || ext === '.markdown' ? 'markdown' : (ext === '.txt' || ext === '.log') ? 'text' : ext.replace('.', '');
      text = decodeText(buf);
      break;
    }
    case '':
      throw new DocError('DOC_UNSUPPORTED', '无法识别文件类型（没有扩展名）——支持 pdf / docx / xlsx / pptx / txt / md / csv / json / html');
    default:
      throw new DocError('DOC_UNSUPPORTED', `不支持的文件类型 ${ext}——支持 pdf / docx / xlsx / pptx / txt / md / csv / json / html`);
  }

  const truncated = text.length > maxChars;
  const out = truncated ? text.slice(0, maxChars) : text;
  return { format, text: out, chars: out.length, truncated, meta };
}

// ==================== 文本/HTML ====================

function decodeText(buf: Buffer): string {
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);      // 去 BOM
  return s.replace(/\r\n?/g, '\n');
}

/** 极简 HTML → 文本：去 script/style、块级标签转换行、实体解码（不追求完整 DOM 语义） */
export function htmlToText(html: string): { text: string; title: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<(li|td|th)\b[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return { text: squeezeLines(s), title };
}

export function squeezeLines(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&');

export function safeChar(cp: number): string {
  try { return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; } catch { return ''; }
}

// ==================== ZIP（Office 容器）====================

/** 读 zip 的所有条目（中央目录 + 本地头；支持 stored/deflate） */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new DocError('DOC_PARSE_FAILED', '不是有效的 ZIP 容器（Office 文档应为 zip）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    try {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    } catch { /* 单个条目坏了就跳过，不让整篇解析失败 */ }
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (out.size === 0) throw new DocError('DOC_PARSE_FAILED', 'ZIP 里没读到任何条目（文件可能损坏或不是 Office 文档）');
  return out;
}

function unzip(buf: Buffer): Map<string, Buffer> { return readZip(buf); }
function zipText(zip: Map<string, Buffer>, name: string): string {
  const b = zip.get(name);
  return b ? b.toString('utf8') : '';
}
function zipEntry(buf: Buffer, names: string[], base: string): string {
  const zip = unzip(buf);
  for (const n of names) { const t = zipText(zip, n); if (t) return t; }
  throw new DocError('DOC_PARSE_FAILED', `${base}：ZIP 里缺少 ${names[0]}（文件可能损坏）`);
}
function unzipText(buf: Buffer): { paragraphs: number } {
  const zip = unzip(buf);
  return { paragraphs: countTags(zipText(zip, 'word/document.xml'), 'w:p') };
}

// ==================== XML 小工具 ====================

/** 取某个标签的全部内层内容（非贪婪，够用） */
export function tags(xml: string, name: string): string[] {
  return tagBlocks(xml, name).map((b) => b.inner);
}

/** ★ 取标签块**连同属性**：xlsx 的工作表名（`<sheet name=…/>`）与单元格类型（`t="s"`）都在属性里，
 *  只取内层会把它们丢掉（2026-10-11 写到 xlsx 时踩到：sheet 名全空、共享字符串失效）。 */
export function tagBlocks(xml: string, name: string): { attrs: string; inner: string }[] {
  const out: { attrs: string; inner: string }[] = [];
  const paired = new RegExp(`<${name}(\\s[^>]*?)?>([\\s\\S]*?)</${name}>`, 'g');
  for (const m of xml.matchAll(paired)) out.push({ attrs: m[1] ?? '', inner: m[2] ?? '' });
  const selfClosing = new RegExp(`<${name}(\\s[^>]*?)?/>`, 'g');
  for (const m of xml.matchAll(selfClosing)) out.push({ attrs: m[1] ?? '', inner: '' });
  return out;
}

function countTags(xml: string, name: string): number {
  const re = new RegExp(`<${name}(\\s[^>]*?)?/?>`, 'g');
  return [...xml.matchAll(re)].length;
}

// ==================== docx ====================

/** 段落 → 行；表格单元格用 \t 分隔（w:tc 结束补 \t、w:tr 结束补 \n） */
export function docxToText(documentXml: string): string {
  if (!documentXml) return '';
  let s = documentXml
    .replace(/<\/w:tc>/g, '</w:tc>\t')
    .replace(/<\/w:tr>/g, '</w:tr>\n')
    .replace(/<\/w:p>/g, '</w:p>\n');
  // 逐段取 w:t（含 w:tab / w:br 的语义）
  const lines: string[] = [];
  for (const para of tags(s, 'w:p')) {
    const runs = tags(para, 'w:t').map((t) => decodeEntities(t)).join('');
    const tabs = countTags(para, 'w:tab');
    const brs = countTags(para, 'w:br');
    lines.push(runs + (tabs ? '' : '') + (brs ? '\n'.repeat(brs) : ''));
  }
  return squeezeLines(lines.join('\n').replace(/\t\n/g, '\n'));
}

// ==================== xlsx ====================

function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function extractXlsx(buf: Buffer): { text: string; meta: Record<string, string | number | boolean> } {
  const zip = unzip(buf);
  const shared = tags(zipText(zip, 'xl/sharedStrings.xml'), 'si').map((si) => tags(si, 't').map((t) => decodeEntities(t)).join(''));
  const wb = zipText(zip, 'xl/workbook.xml');
  const sheetNames = tagBlocks(wb, 'sheet').map((s) => decodeEntities(/name="([^"]*)"/.exec(s.attrs)?.[1] ?? ''));
  const files = [...zip.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => (Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0)));

  const parts: string[] = [];
  let rows = 0;
  files.forEach((f, i) => {
    const xml = zipText(zip, f);
    const lines: string[] = [];
    for (const row of tagBlocks(xml, 'row')) {
      rows++;
      const cells: string[] = [];
      for (const c of tagBlocks(row.inner, 'c')) {
        const ref = /r="([A-Z]+\d+)"/.exec(c.attrs)?.[1] ?? '';
        const isShared = /t="s"/.test(c.attrs);
        const inlineStr = tagBlocks(c.inner, 'is').map((is) => tags(is.inner, 't').map((x) => decodeEntities(x)).join('')).join('');
        const vTag = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c.inner)?.[1];
        let val = '';
        if (inlineStr) val = inlineStr;
        else if (isShared && vTag !== undefined) val = shared[Number(vTag)] ?? '';
        else if (vTag !== undefined) val = decodeEntities(vTag);
        else val = tags(c.inner, 't').map((x) => decodeEntities(x)).join('');
        const at = colIndex(ref);
        while (cells.length < at) cells.push('');
        cells[at] = val;
      }
      const line = cells.join('\t').replace(/\t+$/, '');
      if (line.trim()) lines.push(line);
    }
    const name = sheetNames[i] ?? `sheet${i + 1}`;
    parts.push(`## ${name}\n${lines.join('\n')}`);
  });

  return {
    text: tidyTable(parts.join('\n\n')),
    meta: { sheets: files.length, sheetNames: sheetNames.join(' / '), rows },
  };
}

/** 表格类文本的规整：折叠空格但**保留制表符**（列分隔符），并去掉尾部空白 */
function tidyTable(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \u00a0]+/g, ' ').replace(/[ ]+$/g, '').replace(/\t[ ]+/g, '\t').replace(/[ ]+\t/g, '\t'))
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ==================== pptx ====================

export function extractPptx(buf: Buffer): { text: string; meta: Record<string, string | number | boolean> } {
  const zip = unzip(buf);
  const files = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => (Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0)));
  if (!files.length) throw new DocError('DOC_PARSE_FAILED', 'pptx 里没有找到幻灯片（ppt/slides/slideN.xml）');
  const slides = files.map((f, i) => {
    const xml = zipText(zip, f);
    const lines = tags(xml, 'a:p')
      .map((p) => tags(p, 'a:t').map((t) => decodeEntities(t)).join(''))
      .map((l) => l.trim())
      .filter(Boolean);
    return `## 第 ${i + 1} 页\n${lines.join('\n')}`;
  });
  return { text: squeezeLines(slides.join('\n\n')), meta: { slides: files.length } };
}
// ==================== PDF → 已拆至 ./doc-pdf.ts（2026-10-14 重构轮 3） ====================
// extractPdf / CMap / parseCMap / contentToText / decodeShowString 都在那边；
// 对外符号保持不变：extractPdf 在这里 import（extractDocument 分发要用）+ 再导出（历史导入路径不变）。
export { extractPdf };
