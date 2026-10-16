// src/registry/doc-pdf.ts — PDF 文本抽取（极简解析器：对象表 → 页树顺序 → CMap → 内容流文本）
// 只处理 FlateDecode 流与 ToUnicode CMap；扫描版（无文本层）与加密（/Encrypt）各自明确报错码。
// 2026-10-14 重构轮 3 自 doc-extract.ts 纯搬运拆出；safeChar/squeezeLines/DocError 从 doc-extract.ts 导入。

import { inflateRawSync, inflateSync } from 'node:zlib';
import { DocError, safeChar, squeezeLines } from './doc-extract.js';

type PdfObj = { num: number; body: string; stream?: Buffer };

/** 极简 PDF：对象表 → 页树顺序 → 每页字体 CMap + 内容流文本 */
export function extractPdf(buf: Buffer): {
  text: string;
  meta: Record<string, string | number | boolean>;
  /** 逐页文本（**与 pageNums 一一对应，含空文本页**）——doc-extract 在有内嵌图片时用它按页标注 `[图片 #N]` */
  pages: { text: string }[];
} {
  const raw = buf.toString('latin1');        // latin1 ⇒ 字符下标 == 字节下标（便于切 stream）
  // ★ 加密 PDF：内容流与字符串都是密文，再往下走只会得到「没有文本层」这种误导性结论（真实文件踩过：
  //   orimi pdf-test.pdf 带 /Encrypt，被误报成扫描版）。这里直接给专门的码，让用户知道该去解密而不是去 OCR。
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(raw) || /\/Encrypt\s*<</.test(raw)) {
    throw new DocError('DOC_ENCRYPTED', '这个 PDF 是加密的（/Encrypt），本节点不破解密码——请先用阅读器去掉密码保护另存一份再解析');
  }
  const objs = new Map<number, PdfObj>();
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
  for (const m of raw.matchAll(objRe)) {
    const num = Number(m[1]);
    const bodyStart = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf('endobj', bodyStart);
    const body = raw.slice(bodyStart, end < 0 ? raw.length : end);
    const sIdx = body.indexOf('stream');
    let stream: Buffer | undefined;
    if (sIdx >= 0) {
      let p = bodyStart + sIdx + 'stream'.length;
      if (raw[p] === '\r') p++;
      if (raw[p] === '\n') p++;
      const e = raw.indexOf('endstream', p);
      const sLen = (e < 0 ? raw.length : e) - p;
      let data = buf.subarray(p, p + sLen);
      if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) data = data.subarray(0, data.length - 2);
      else if (data.length >= 1 && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) data = data.subarray(0, data.length - 1);
      if (/\/FlateDecode/.test(body.slice(0, sIdx))) {
        try { stream = inflateSync(data); } catch { try { stream = inflateRawSync(data); } catch { stream = undefined; } }
      } else {
        stream = data;
      }
    }
    if (!objs.has(num)) objs.set(num, { num, body, stream });
  }
  if (objs.size === 0) throw new DocError('DOC_PARSE_FAILED', '不是有效的 PDF（没读到任何对象）');

  // 页对象：优先按 /Pages → /Kids 树顺序，退化到文件顺序
  const pageNums: number[] = [];
  const seen = new Set<number>();
  const walk = (n: number, depth = 0): void => {
    if (depth > 32 || seen.has(n)) return;
    seen.add(n);
    const o = objs.get(n);
    if (!o) return;
    if (/\/Type\s*\/Pages\b/.test(o.body)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.body)?.[1] ?? '';
      for (const r of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(r[1]), depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(o.body)) {
      pageNums.push(n);
    }
  };
  const rootPages = (() => {
    for (const o of objs.values()) {
      if (/\/Type\s*\/Catalog\b/.test(o.body)) {
        const r = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(o.body)?.[1];
        if (r) return Number(r);
      }
    }
    return -1;
  })();
  if (rootPages >= 0) walk(rootPages);
  if (!pageNums.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.body)) pageNums.push(o.num);

  // 全文档 ToUnicode 映射（作为兜底）
  const cmapCache = new Map<number, CMap>();
  const cmapOf = (objNum: number): CMap => {
    const hit = cmapCache.get(objNum);
    if (hit) return hit;
    const parsed = parseCMap(objs.get(objNum)?.stream?.toString('latin1') ?? '');
    cmapCache.set(objNum, parsed);
    return parsed;
  };
  const globalCmap: CMap = { map: new Map(), bytes: 2 };
  for (const o of objs.values()) {
    const ref = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.body)?.[1];
    if (ref) {
      const c = cmapOf(Number(ref));
      globalCmap.bytes = c.bytes;
      for (const [k, v] of c.map) if (!globalCmap.map.has(k)) globalCmap.map.set(k, v);
    }
  }

  const parts: string[] = [];
  const pages: { text: string }[] = [];      // 与 pageNums 一一对应（空文本/无内容流的页补 ''）——保证 下标+1 == 页号
  let textPages = 0;
  for (const pn of pageNums) {
    const page = objs.get(pn);
    if (!page) { pages.push({ text: '' }); continue; }
    // 该页字体资源：/F1 5 0 R → fontObjNum
    const fontNameToObj = new Map<string, number>();
    const resBlock = /\/Resources\b[\s\S]{0,400}?\/Font\s*<<([\s\S]*?)>>/.exec(page.body)?.[1] ?? '';
    for (const m of resBlock.matchAll(/\/([A-Za-z0-9#+.]+)\s+(\d+)\s+\d+\s+R/g)) fontNameToObj.set(m[1]!, Number(m[2]));
    const fontCmaps = new Map<string, CMap>();
    for (const [name, objNum] of fontNameToObj) {
      const ref = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(objs.get(objNum)?.body ?? '')?.[1];
      if (ref) fontCmaps.set(name, cmapOf(Number(ref)));
    }
    // 内容流（可能是数组）
    const contents = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(page.body)?.[1];
    const contentsArr = /\/Contents\s*\[([^\]]*)\]/.exec(page.body)?.[1];
    const streams: string[] = [];
    if (contents) { const s = objs.get(Number(contents))?.stream; if (s) streams.push(s.toString('latin1')); }
    if (contentsArr) for (const r of contentsArr.matchAll(/(\d+)\s+\d+\s+R/g)) { const s = objs.get(Number(r[1]))?.stream; if (s) streams.push(s.toString('latin1')); }
    if (!streams.length) { pages.push({ text: '' }); continue; }
    const pageText = contentToText(streams.join('\n'), fontCmaps, globalCmap);
    pages.push({ text: pageText.trim() });
    if (pageText.trim()) { textPages++; parts.push(pageText.trim()); }
  }

  // 有些 PDF 没有 /Type /Page 标记（罕见）→ 直接扫全部流
  let text = parts.join('\n\n');
  if (!text.trim()) {
    const all: string[] = [];
    for (const o of objs.values()) if (o.stream && /BT[\s\S]*?ET/.test(o.stream.toString('latin1'))) all.push(contentToText(o.stream.toString('latin1'), new Map(), globalCmap));
    text = all.join('\n\n');
  }
  text = squeezeLines(text);
  if (!text.trim()) {
    throw new DocError('DOC_NO_TEXT_LAYER', '这个 PDF 没有可提取的文本层（疑似扫描版/图片型）——本节点不做 OCR，请改用 OCR 工具或索取文字版');
  }
  return { text, meta: { pages: pageNums.length, pagesWithText: textPages }, pages };
}

/** ToUnicode 映射 + 码宽（由 CMap 的 codespacerange 决定，别按 key 大小猜） */
type CMap = { map: Map<number, string>; bytes: 1 | 2 };

/** 解析 ToUnicode CMap（bfchar / bfrange） */
function parseCMap(cmap: string): CMap {
  const map = new Map<number, string>();
  // ★ 码宽取自 codespacerange：`<0000> <FFFF>` ⇒ 2 字节，`<00> <FF>` ⇒ 1 字节。
  //   只看 key 大小会判错——CJK 子集字体常用 `<0001>` 这类小码值表示双字节 CID
  //   （2026-10-11 实测踩到：把「你好」解成 `\u0000你\u0000好`）。
  const csr = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap)?.[1] ?? '';
  const firstRange = /<([0-9a-fA-F\s]+)>/.exec(csr)?.[1];
  let bytes: 1 | 2 | 0 = firstRange ? (firstRange.replace(/\s+/g, '').length <= 2 ? 1 : 2) : 0;
  const hexToStr = (h: string): string => {
    const s = h.replace(/\s+/g, '');
    let out = '';
    for (let i = 0; i + 3 < s.length + 1; i += 4) {
      const v = parseInt(s.slice(i, i + 4), 16);
      if (Number.isFinite(v) && v !== 0) out += safeChar(v);
    }
    return out;
  };
  for (const blk of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of (blk[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1]!, 16), hexToStr(m[2]!));
  }
  for (const blk of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = blk[1] ?? '';
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = parseInt(m[1]!, 16); const hi = parseInt(m[2]!, 16); const dst = parseInt(m[3]!, 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, safeChar(dst + (c - lo)));
    }
    for (const m of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
      const lo = parseInt(m[1]!, 16);
      const items = [...(m[3] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)];
      items.forEach((it, i) => map.set(lo + i, hexToStr(it[1]!)));
    }
  }
  if (!bytes) bytes = [...map.keys()].some((k) => k > 0xff) ? 2 : 1;
  return { map, bytes };
}

/** 从内容流里抽文本：跟踪 Tf 当前字体、按**真正的换行**切行。
 *  ★ 关键（真实文件踩过）：`Td/TD` 是「相对当前行原点平移」，`dx 0` 这种**纯横向**位移只是把同一行的
 *    文字分段摆放（W3C dummy.pdf 就是 `Dummy` 被拆成 4 段）——**不能当成换行**，否则一行被拆成好几行。
 *    只有纵向位移（ty≠0）才换行；`Tm` 则比较两次的 y 值是否真的变了。 */
function contentToText(content: string, fontCmaps: Map<string, CMap>, globalCmap: CMap): string {
  let out = '';
  let font: CMap | undefined;
  // ★ 必须是**token 列表**而不是一个大字符串（真实文件踩过）：`[(Lor) 17 (em) -91 ( ) -35 (ipsum)] TJ`
  //   里每个 `(…)`/`<…>` 都是独立字符串，攒成一个再解码只会剥掉最外层括号 → 输出 `Lor)(em)( )(ipsum)`。
  let buf: string[] = [];
  let lastY: number | null = null;
  const nums: number[] = [];
  const flush = (): void => {
    if (buf.length) { for (const tk of buf) out += decodeShowString(tk, font); buf = []; }
  };
  const newline = (): void => { flush(); if (out && !out.endsWith('\n')) out += '\n'; };
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)|\/([A-Za-z0-9#+.]+)\s+[\d.]+\s+Tf|\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]*>|\bT[Jj]|\bTD\b|\bTd\b|\bT\*|\bTm\b|\bBT\b|\bET\b|\bTL\b|'|"/g;
  for (const m of content.matchAll(re)) {
    const tok = m[0];
    // 纯数字 ⇒ 算子操作数（Td/TD/Tm 的坐标），攒着给后面的算子用
    if (!m[1] && /^[-+]?[\d.]/.test(tok) && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(tok)) {
      nums.push(Number(tok));
      if (nums.length > 8) nums.shift();
      continue;
    }
    if (tok.endsWith('Tf')) {
      flush();
      const name = /\/([A-Za-z0-9#+.]+)/.exec(tok)?.[1] ?? '';
      font = fontCmaps.get(name) ?? (globalCmap.map.size ? globalCmap : undefined);
      continue;
    }
    if (tok === 'TJ' || tok === 'Tj') { flush(); continue; }
    if (tok === 'Td' || tok === 'TD') {
      const ty = nums[nums.length - 1];
      nums.length = 0;
      if (ty === undefined || Math.abs(ty) > 0.5) newline();   // 只有真的往下/上走了才换行
      continue;
    }
    if (tok === 'Tm') {
      const y = nums[nums.length - 1];
      nums.length = 0;
      if (y === undefined) newline();
      else {
        if (lastY !== null && Math.abs(y - lastY) > 0.5) newline();
        lastY = y;
      }
      continue;
    }
    if (tok === 'BT') { nums.length = 0; lastY = null; newline(); continue; }
    if (tok === 'T*' || tok === "'" || tok === '"') { nums.length = 0; newline(); continue; }
    if (tok === 'ET' || tok === 'TL') { flush(); continue; }
    buf.push(tok);                                // 文本串累积（各自独立解码），遇算子再 flush
  }
  flush();
  return out.replace(/[ \t]+\n/g, '\n');
}

/** 解 PDF 字符串字面量 → 文本（走 CMap；无 CMap 时按 Latin-1） */
function decodeShowString(tok: string, cmap?: CMap): string {
  let bytes: number[] = [];
  if (tok.startsWith('<')) {
    const hex = tok.slice(1, -1).replace(/[^0-9a-fA-F]/g, '');
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  } else if (tok.startsWith('(')) {
    const body = tok.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch !== '\\') { bytes.push(body.charCodeAt(i) & 0xff); continue; }
      const nx = body[++i];
      if (nx === undefined) break;
      if (nx === 'n') bytes.push(10);
      else if (nx === 'r') bytes.push(13);
      else if (nx === 't') bytes.push(9);
      else if (nx === 'b') bytes.push(8);
      else if (nx === 'f') bytes.push(12);
      else if (nx >= '0' && nx <= '7') {
        let oct = nx;
        while (oct.length < 3 && body[i + 1] !== undefined && body[i + 1]! >= '0' && body[i + 1]! <= '7') oct += body[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (nx === '\n') { /* 续行 */ }
      else bytes.push(nx.charCodeAt(0) & 0xff);
    }
  } else return '';

  if (!cmap || cmap.map.size === 0) return Buffer.from(bytes).toString('latin1');
  let s = '';
  if (cmap.bytes === 2) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i]! << 8) | bytes[i + 1]!;
      s += cmap.map.get(code) ?? '';
    }
  } else {
    for (const b of bytes) s += cmap.map.get(b) ?? safeChar(b);
  }
  return s;
}
