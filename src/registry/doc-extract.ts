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
import { extractPdfImages } from './doc-image-pdf.js';

/** 带错误码的解析异常（错误码与 docs/ERROR_REFERENCE.md 对齐） */
export class DocError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocError';
    this.code = code;
  }
}

interface DocResult {
  /** 归一化后的格式名：pdf / docx / xlsx / pptx / text / html / csv / json / markdown */
  format: string;
  /** 抽取出的纯文本（含内嵌图片的位置标记，形如 `[图片 #1]`——节点侧落盘后会把 #N 换成真实文件名） */
  text: string;
  chars: number;
  /** 是否被 maxChars 截断 */
  truncated: boolean;
  /** 附加信息：页数/工作表/幻灯片/段落数、原文件名、字节数等 */
  meta: Record<string, string | number | boolean>;
  /** ★ 2026-10-16 用户需求「doc_parse 抽图落统一目录 + 在文本相应位置注明图片位置」：
   *  文档内嵌图片（**只回引用与字节，不落盘**——落盘由节点侧走 `src/adapter/image-library.ts`）。 */
  images: DocImageRef[];
  /** ★ 2026-10-16 第二轮（PDF 抽图）：跳过的图片**原因**（如 `{ JPXDecode: 3 }`）——PDF 里含
   *  JPEG2000/传真压缩/1 位掩码这类抽不出来的图时，让用户一眼看出"为什么只抽到 2 张"。
   *  只在真的有跳过时出现（无图/全抽出来的文档不带这个字段，输出与改动前一致）。 */
  skippedImageReasons?: Record<string, number>;
}

/** 从文档里抽出的内嵌图片（文本里 `[图片 #index]` 与它一一对应） */
export interface DocImageRef {
  /** 文档内出现顺序，从 1 开始 */
  index: number;
  /** 在原文档容器里的位置（如 `word/media/image1.png`），便于排查"这张图哪来的" */
  source: string;
  /** 原始字节（保持原格式，不做转换） */
  bytes: Buffer;
  /** 由扩展名推出的 MIME（白名单内：png/jpeg/gif/webp） */
  mediaType: string;
}

/** 会抽出并落盘的图片扩展名 → MIME（emf/wmf/tiff/svg 等一律跳过并计数，避免目录里堆打不开的文件）。
 *  ★2026-10-17 修：**bmp 移出白名单** —— 宿主附件服务与「🖼 选图」都只认 png/jpeg/webp/gif
 *  （见 adapter/image-inputs.ts 的 MEDIA_TYPES）⇒ 抽出来的 .bmp 会被文本公布成地址、却自家读不了
 *  （填进 images 直接 IMAGE_UNSUPPORTED_TYPE，选图弹窗也列不出）。移出后由收集处的 `!mediaType`
 *  分支自动计入 skipped（三个收集器都是这么写的），不会静默丢图。 */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** 取扩展名对应的图片 MIME；不是白名单里的图片格式返回 null */
function imageMediaType(target: string): string | null {
  const ext = (/(\.[A-Za-z0-9]+)$/.exec(target)?.[1] ?? '').toLowerCase().replace(/^\./, '');
  return IMAGE_MEDIA_TYPES[ext] ?? null;
}

/** 洗掉文本里的 `[图片 #N]` 占位（**extractImages: off 时用**，2026-10-17 修）：占位是 extractDocument
 *  按"有没有抽到图"无条件插入的，而节点选「关」时只清空 images ⇒ 文本会留下指向不存在文件的假地址
 *  （还会进下游 AI prompt）。用它把文本还原成"加抽图功能之前"的样子。 */
export function stripImageMarks(text: string): string {
  // ★ 2026-10-17 修（独立审查报的 D1）：**没有占位就原样返回**。下面的空白规整（删行尾空格、压连续空行、
  //   trim）是**全文生效**的；若无条件跑，解析一份普通 .md/.txt 也会被改掉 Markdown 硬换行、空行与首尾缩进
  //   —— 那是超出"洗掉假地址"目标的行为变更。
  if (!/\[图片 #\d+\]/.test(text)) return text;
  return text
    // ① 占位**独占一行**时：连行尾换行一起吃（否则会留下空行）
    .replace(/^[ \t]*\[图片 #\d+\][ \t]*\r?\n/gm, '')
    // ② 行内/行尾剩下的占位（连同前导空格）
    .replace(/[ \t]*\[图片 #\d+\]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 相对路径归一化：`baseDir` + Target ⇒ 容器内的真实路径。
 *  例：docx `('word', 'media/image1.png')` ⇒ `word/media/image1.png`；
 *      pptx `('ppt/slides', '../media/image1.png')` ⇒ `ppt/media/image1.png`；
 *      Target 以 `/` 开头＝容器绝对路径 ⇒ 去掉前导斜杠直接用。 */
function joinRel(baseDir: string, target: string): string {
  if (/^\//.test(target)) return target.replace(/^\//, '');
  const parts = [...baseDir.split('/').filter(Boolean), ...target.split('/')];
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** 读 `_rels/*.rels` 的 rId → Target 映射（docx 的 `word/_rels/document.xml.rels`、pptx 的 slideN.xml.rels） */
function relsMap(zip: Map<string, Buffer>, relsPath: string): Map<string, string> {
  const out = new Map<string, string>();
  const xml = zipText(zip, relsPath);
  if (!xml) return out;
  for (const b of tagBlocks(xml, 'Relationship')) {
    const id = /\bId="([^"]+)"/.exec(b.attrs)?.[1];
    const tgt = /\bTarget="([^"]+)"/.exec(b.attrs)?.[1];
    if (id && tgt) out.set(id, tgt.replace(/^\.\//, ''));
  }
  return out;
}

interface ExtractOptions {
  /** 文本上限（默认 200_000 字符；超出截断并置 truncated=true） */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 200_000;
/** 单文件字节上限（100 MB）——避免把内存吃爆 */
export const DOC_MAX_BYTES = 100 * 1024 * 1024;

// ==================== 下载文件的"命名"推导（2026-10-19 用户报缺陷后新增） ====================
//  背景：doc_parse 的 url 分支以前只用 URL pathname 的最后一段当文件名。抓**首页型地址**
//  （`https://example.com/` 的 pathname 就是 `/`）时取不到任何段 ⇒ 扩展名为空 ⇒ 报
//  「无法识别文件类型（没有扩展名）」；抓 `.php` / `.aspx` 页面同理（扩展名不在支持集里）。
//  这里按「pathname → content-disposition → content-type」三级兜底推导出一个**带可识别扩展名**的名字，
//  节点侧拿它去分派即可；字节不动、只是给"没有文件名的响应"补一个名字。
//  ★ 只认本内核真正支持的扩展名：`.php` / `.aspx` 这类页面壳不算，会继续往后兜底换成 `.html`。

/** extractDocument / doc_parse 的图片-OCR 通路认识的扩展名 */
const KNOWN_FILE_EXTS = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
  '.html', '.htm', '.txt', '.log', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff',
]);

/** 取文件名尾部的扩展名（小写，含点；没有则空串） */
function extOfName(name: string): string {
  return (/(\.[A-Za-z0-9]{1,8})$/.exec(String(name ?? ''))?.[1] ?? '').toLowerCase();
}

/** content-type → 支持集的扩展名；不认识返回空串 */
export function extFromContentType(contentType: string): string {
  const base = String(contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!base) return '';
  const table: Record<string, string> = {
    'text/html': '.html',
    'application/xhtml+xml': '.html',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/x-markdown': '.md',
    'text/csv': '.csv',
    'text/tab-separated-values': '.tsv',
    'application/json': '.json',
    'application/ld+json': '.json',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'application/yaml': '.yaml',
    'application/x-yaml': '.yaml',
    'text/yaml': '.yaml',
    'application/msword': '.doc',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
  };
  const hit = table[base];
  if (hit) return hit;
  // 族后缀：application/rss+xml / application/problem+json 之类
  if (base.endsWith('+json')) return '.json';
  if (base.endsWith('+xml')) return '.xml';
  // 未知的 text/* 一律按纯文本读（decodeText 能吃）
  if (base.startsWith('text/')) return '.txt';
  return '';
}

/** 从 content-disposition 里取文件名；`filename*=UTF-8''…` 优先，取不到返回空串 */
export function fileNameFromDisposition(disposition: string): string {
  const s = String(disposition ?? '');
  if (!s) return '';
  const star = /filename\*\s*=\s*([^;]+)/i.exec(s);
  if (star) {
    const v = star[1]!.trim().replace(/^["']|["']$/g, '');
    const quoted = /^[^']*'[^']*'(.*)$/.exec(v);   // charset'lang'value
    const raw = quoted ? quoted[1]! : v;
    try {
      const d = decodeURIComponent(raw);
      if (d) return d.replace(/^.*[\\/]/, '');
    } catch { /* 解码失败退回下面那条 */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(s);
  const v2 = (plain?.[2] ?? plain?.[3] ?? '').trim();
  return v2 ? v2.replace(/^.*[\\/]/, '') : '';
}

/**
 * 给一个 HTTP 响应的字节推导文件名（供按扩展名分派用）。
 * 顺序：URL pathname 的最后一段（仅当扩展名在支持集里）→ content-disposition → content-type 兜底。
 * 拿不到任何线索时返回 `download`（无扩展名 ⇒ 后续仍会明确报 DOC_UNSUPPORTED，不会静默）。
 */
export function downloadedFileName(urlStr: string, headers: { get(name: string): string | null }): string {
  let last = '';
  try {
    const seg = new URL(String(urlStr)).pathname.split('/').filter(Boolean).pop() ?? '';
    if (seg) { try { last = decodeURIComponent(seg); } catch { last = seg; } }
  } catch { /* 非法 URL：交给后面兜底 */ }

  if (last && KNOWN_FILE_EXTS.has(extOfName(last))) return last;

  const disp = fileNameFromDisposition(headers.get('content-disposition') ?? '');
  if (disp && KNOWN_FILE_EXTS.has(extOfName(disp))) return disp;

  const ext = extFromContentType(headers.get('content-type') ?? '');
  // 页面壳（.php/.aspx/.jsp…）不算文件类型 ⇒ 用 content-type 换掉它；没有 content-type 线索时原样返回（保持原有报错）
  const baseName = (last || disp || 'download').replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (!ext) return last || disp || 'download';
  return (baseName || 'download') + ext;
}

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
  // ★ 2026-10-16：「doc_parse 抽图落统一目录 + 在文本相应位置注明图片位置」——这里只**抽出引用与字节**，
  //   落盘由节点侧（adapter/image-library）负责，内核保持"零依赖纯函数、不写盘"。
  let images: DocImageRef[] = [];
  let skippedImages = 0;
  let skippedImageReasons: Record<string, number> | undefined;

  switch (ext) {
    case '.pdf': {
      const r = extractPdf(buf);
      format = 'pdf';
      text = r.text;
      meta = { ...meta, ...r.meta };
      // 2026-10-16 第二轮：PDF 内嵌图片（DCTDecode 原样取 JPEG / FlateDecode 现场编码 PNG）。
      // ★ 只有真的抽到图时才重排文本；没图时 text 就是 extractPdf 的原样输出（逐字不变）。
      const hit = extractPdfImages(buf);
      skippedImages = hit.skipped;
      if (hit.skipped > 0 && Object.keys(hit.reasons).length) skippedImageReasons = hit.reasons;
      if (hit.images.length) {
        images = hit.images.map((im, i) => ({
          index: i + 1,
          source: im.page > 0 ? `第 ${im.page} 页 (对象 ${im.objNum})` : `未引用对象 ${im.objNum}`,
          bytes: im.bytes,
          mediaType: im.mediaType,
        }));
        text = markPdfImages(r.pages, hit.images, text);
      }
      break;
    }
    case '.docx': {
      const xml = zipEntry(buf, ['word/document.xml'], base);
      const raw = unzipText(buf);
      format = 'docx';
      const hit = collectDocxImages(xml, unzip(buf));
      images = hit.images;
      skippedImages = hit.skipped;
      text = docxToText(xml, hit.refToIndex);
      meta = { ...meta, paragraphs: raw.paragraphs };
      break;
    }
    case '.xlsx': {
      format = 'xlsx'; { const r = extractXlsx(buf); text = r.text; images = r.images; skippedImages = r.skipped; meta = { ...meta, ...r.meta }; } break;
    }
    case '.pptx': {
      format = 'pptx'; { const r = extractPptx(buf); text = r.text; images = r.images; skippedImages = r.skipped; meta = { ...meta, ...r.meta }; } break;
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

  if (skippedImages > 0) meta = { ...meta, skippedImages };
  if (images.length > 0) meta = { ...meta, images: images.length };
  const truncated = text.length > maxChars;
  const out = truncated ? text.slice(0, maxChars) : text;
  return { format, text: out, chars: out.length, truncated, meta, images, ...(skippedImageReasons ? { skippedImageReasons } : {}) };
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

/**
 * 把 PDF 内嵌图片按页标注到该页文本尾部（`[图片 #N]`，N 与 DocImageRef.index 一致）。
 * 只在"确实抽到图片"时被调用 ⇒ 无图片的 PDF 输出与旧版逐字相同。
 * 未被任何页引用的图像对象（page=0）挂在文末，保证每张落盘的图在文本里都有出处。
 */
function markPdfImages(
  pages: { text: string }[],
  imgs: { page: number }[],
  fallbackText: string,
): string {
  const marksOfPage = new Map<number, number[]>();
  const orphans: number[] = [];
  imgs.forEach((im, i) => {
    if (im.page > 0) {
      const arr = marksOfPage.get(im.page) ?? [];
      arr.push(i + 1);
      marksOfPage.set(im.page, arr);
    } else orphans.push(i + 1);
  });
  const orphanLine = orphans.map((n) => `[图片 #${n}]`).join(' ');
  if (!pages.length) {
    // 页树没解析出来（罕见 → extractPdf 走了全流兜底）：没有页边界可挂，统一附在文末
    const all = imgs.map((_, i) => i + 1);
    return squeezeLines([fallbackText, all.map((n) => `[图片 #${n}]`).join(' ')].filter((x) => x.trim()).join('\n\n'));
  }
  const out: string[] = [];
  pages.forEach((p, idx) => {
    const marks = (marksOfPage.get(idx + 1) ?? []).map((n) => `[图片 #${n}]`).join(' ');
    const t = marks ? (p.text ? `${p.text}\n${marks}` : marks) : p.text;
    if (t.trim()) out.push(t.trim());
  });
  if (orphanLine) out.push(orphanLine);
  return squeezeLines(out.join('\n\n'));
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
function tagBlocks(xml: string, name: string): { attrs: string; inner: string }[] {
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

/** docx 内嵌图：按 `document.xml` 里 `r:embed="rIdN"` 的**出现顺序**收集（只收白名单图片格式）。
 *  ★ 2026-10-16：返回的 `index` 与文本里的 `[图片 #N]` 一一对应；非图片/取不到的计入 `skipped`。
 *  同一张图被引用多次只算一条（`refToIndex` 保证文本里重复引用指向同一个 #N）。 */
function collectDocxImages(xml: string, zip: Map<string, Buffer>): { images: DocImageRef[]; skipped: number; refToIndex: Map<string, number> } {
  const images: DocImageRef[] = [];
  const refToIndex = new Map<string, number>();
  let skipped = 0;
  const ridMap = relsMap(zip, 'word/_rels/document.xml.rels');
  for (const m of xml.matchAll(/r:embed="([^"]+)"/g)) {
    const rid = m[1]!;
    if (refToIndex.has(rid)) continue;
    const target = ridMap.get(rid);
    if (!target) { skipped++; continue; }
    const mediaType = imageMediaType(target);
    const mediaPath = joinRel('word', target);
    const bytes = zip.get(mediaPath);
    if (!bytes || !mediaType) { skipped++; continue; }
    const index = images.length + 1;
    refToIndex.set(rid, index);
    images.push({ index, source: mediaPath, bytes, mediaType });
  }
  return { images, skipped, refToIndex };
}

/** 段落 → 行；表格单元格用 \t 分隔（w:tc 结束补 \t、w:tr 结束补 \n）
 *  ★ 2026-10-16：段落里内嵌的图片在该行末尾补 `[图片 #N]`（**没传映射时输出与改动前完全一致**）。 */
function docxToText(documentXml: string, refToIndex?: Map<string, number>): string {
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
    let marks = '';
    if (refToIndex) {
      const seen = new Set<number>();
      for (const m of para.matchAll(/r:embed="([^"]+)"/g)) {
        const n = refToIndex.get(m[1]!);
        if (n && !seen.has(n)) { seen.add(n); marks += ` [图片 #${n}]`; }
      }
    }
    lines.push(runs + marks + (tabs ? '' : '') + (brs ? '\n'.repeat(brs) : ''));
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

function extractXlsx(buf: Buffer): { text: string; meta: Record<string, string | number | boolean>; images: DocImageRef[]; skipped: number } {
  const zip = unzip(buf);
  const shared = tags(zipText(zip, 'xl/sharedStrings.xml'), 'si').map((si) => tags(si, 't').map((t) => decodeEntities(t)).join(''));
  const wb = zipText(zip, 'xl/workbook.xml');
  const sheetNames = tagBlocks(wb, 'sheet').map((s) => decodeEntities(/name="([^"]*)"/.exec(s.attrs)?.[1] ?? ''));
  // ★ 2026-10-16：工作表里的浮动图片（`xl/media/*`）——xlsx 的 XML 不含"图在第几行"的可靠信息，
  //   故按文件序号收集、在**文末**统一标注（docx/pptx 能做到精确定位，所以那边是行内标记）。
  const images: DocImageRef[] = [];
  let skipped = 0;
  for (const k of [...zip.keys()].filter((n) => /^xl\/media\//.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const mediaType = imageMediaType(k);
    const bytes = zip.get(k);
    if (!bytes || !mediaType) { skipped++; continue; }
    images.push({ index: images.length + 1, source: k, bytes, mediaType });
  }
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
    text: tidyTable(parts.join('\n\n')) + (images.length ? `\n\n[图片 #${images.map((i) => i.index).join('] [图片 #')}]` : ''),
    meta: { sheets: files.length, sheetNames: sheetNames.join(' / '), rows },
    images,
    skipped,
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

function extractPptx(buf: Buffer): { text: string; meta: Record<string, string | number | boolean>; images: DocImageRef[]; skipped: number } {
  const zip = unzip(buf);
  const files = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => (Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0)));
  if (!files.length) throw new DocError('DOC_PARSE_FAILED', 'pptx 里没有找到幻灯片（ppt/slides/slideN.xml）');
  // ★ 2026-10-16：每页按 `<p:pic>` 里 `r:embed` 的出现顺序收图，并在该页文本末尾补 `[图片 #N]`
  const images: DocImageRef[] = [];
  let skipped = 0;
  const slides = files.map((f, i) => {
    const xml = zipText(zip, f);
    const ridMap = relsMap(zip, `ppt/slides/_rels/${f.replace(/^ppt\/slides\//, '')}.rels`);
    const marks: string[] = [];
    for (const m of xml.matchAll(/r:embed="([^"]+)"/g)) {
      const target = ridMap.get(m[1]!);
      if (!target) { skipped++; continue; }
      const mediaType = imageMediaType(target);
      const mediaPath = joinRel('ppt/slides', target);   // slide 的 Target 多为 `../media/image1.png`
      const bytes = zip.get(mediaPath);
      if (!bytes || !mediaType) { skipped++; continue; }
      images.push({ index: images.length + 1, source: mediaPath, bytes, mediaType });
      marks.push(`[图片 #${images.length}]`);
    }
    const lines = tags(xml, 'a:p')
      .map((p) => tags(p, 'a:t').map((t) => decodeEntities(t)).join(''))
      .map((l) => l.trim())
      .filter(Boolean);
    return `## 第 ${i + 1} 页\n${lines.join('\n')}${marks.length ? `\n${marks.join(' ')}` : ''}`;
  });
  return { text: squeezeLines(slides.join('\n\n')), meta: { slides: files.length }, images, skipped };
}
// ==================== PDF → 已拆至 ./doc-pdf.ts（2026-10-14 重构轮 3） ====================
// extractPdf / CMap / parseCMap / contentToText / decodeShowString 都在那边；
// 对外符号保持不变：extractPdf 在这里 import（extractDocument 分发要用）+ 再导出（历史导入路径不变）。
export { extractPdf };
// ★ 2026-10-16 第二轮：PDF 抽图内核也在这里再导出——节点侧要判「没有文本层但整页是图」的场景
//   （用户：「只有图没有文字的，text 里面说明抽出来的图片地址就行」）。
export { extractPdfImages };
