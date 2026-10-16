// src/registry/doc-image-pdf.ts — PDF 内嵌图片抽取（2026-10-16 第二轮：PDF 抽图）
//
// 与 doc-pdf.ts（文本抽取）同样的极简路线：扫对象表 → 找 `/Subtype /Image` → 按 filter 处理。
//   · `/DCTDecode`  ⇒ 流本身就是 **JPEG** ⇒ 原样取出存 .jpg（零转换，覆盖率最高）
//   · `/FlateDecode` ⇒ 扫描时已 inflate ⇒ 拿到**原始像素** ⇒ 现场编码成 PNG（8 位 RGB/灰度）
//   · 其余（JPXDecode / CCITTFaxDecode / JBIG2Decode / LZWDecode / RunLengthDecode / ImageMask /
//     非 8 位 / Indexed 调色板 / 长度对不上…）⇒ **明确跳过并计数原因**，绝不产出坏图。
//   · `/DecodeParms` 带 Predictor（TIFF 2 / PNG 10-15）⇒ 先反预测再编码。
//
// 本文件零依赖（只用 node:zlib）、纯函数、不写盘；落盘在 adapter/image-library。
import { deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

type PdfObj = { num: number; body: string; stream?: Buffer };

/** 抽到的一张 PDF 图（page 为 1-based 的"被第几页引用"，0＝未被任何页引用） */
export interface PdfImageHit {
  objNum: number;
  mediaType: string;
  bytes: Buffer;
  page: number;
  width: number;
  height: number;
}

export interface PdfImageResult {
  /** 按"页顺序 → 页内对象号顺序"排好序（文本标记的 #N 就按这个顺序） */
  images: PdfImageHit[];
  /** 跳过的图像对象数 */
  skipped: number;
  /** 跳过原因 → 次数（便于排查"为什么这份 PDF 一张图都没抽到"） */
  reasons: Record<string, number>;
}

/** 极简对象扫描（与 doc-pdf 同策略：FlateDecode 已 inflate；其余 filter 保留原始字节） */
function scanObjects(buf: Buffer): Map<number, PdfObj> {
  const raw = buf.toString('latin1');
  const objs = new Map<number, PdfObj>();
  for (const m of raw.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
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
        stream = Buffer.from(data);          // DCTDecode 等：原样保留（JPEG 字节就在这里）
      }
    }
    if (!objs.has(num)) objs.set(num, { num, body, stream });
  }
  return objs;
}

// ---------- PNG 编码（8 位灰度/真彩；够用即止） ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(b: Buffer): number {
  let c = -1;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
/** 原始像素（逐行紧密排列）→ PNG 字节；colorType 0=灰度 2=真彩 */
function encodePng(width: number, height: number, colorType: 0 | 2, pixels: Buffer): Buffer {
  const channels = colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                                   // 每行 filter = None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, Math.min((y + 1) * stride, pixels.length));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 反预测（PDF 的 Predictor：2＝TIFF 水平差分；10-15＝PNG 系列）。
 *  ★ 2026-10-16 实测踩到：PNG 系列**每一行都以 1 字节 filter type 开头**（Predictor 10-14 时该字节恒等于
 *    Predictor-10，Predictor 15 时逐行可变）——只在 15 时才消耗它，会让整幅图按 stride 错位（灰度 2×2 会解成垃圾）。
 *    这里用**流长度**判定有没有 filter 字节（`(stride+1)*height` 精确匹配 ⇒ 有），比猜内容可靠。 */
function undoPredictor(data: Buffer, width: number, height: number, channels: number, predictor: number): Buffer | null {
  const stride = width * channels;
  if (predictor === 2) {
    if (data.length < stride * height) return null;
    const out = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const off = y * stride;
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? out[off + x - channels]! : 0;
        out[off + x] = (data[off + x]! + left) & 0xff;
      }
    }
    return out;
  }
  if (data.length >= (stride + 1) * height) return pngUnfilter(data, stride, height, channels, predictor, true);
  if (data.length >= stride * height) return pngUnfilter(data, stride, height, channels, predictor, false);
  return null;
}

/** PNG 行内反预测；hasFt 表示每行是否有 1 字节 filter type */
function pngUnfilter(data: Buffer, stride: number, height: number, channels: number, predictor: number, hasFt: boolean): Buffer | null {
  const out = Buffer.alloc(stride * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    let ft = predictor - 10;
    if (hasFt) {
      if (p >= data.length) return null;
      ft = data[p++]!;
      if (ft > 4) { if (predictor >= 15) return null; ft = predictor - 10; }   // 异常标记 ⇒ 按 Predictor 指定类型
    }
    if (p + stride > data.length) return null;
    const off = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawV = data[p + x]!;
      const left = x >= channels ? out[off + x - channels]! : 0;
      const up = y > 0 ? out[prev + x]! : 0;
      const ul = (y > 0 && x >= channels) ? out[prev + x - channels]! : 0;
      let v = rawV;
      if (ft === 1) v = rawV + left;
      else if (ft === 2) v = rawV + up;
      else if (ft === 3) v = rawV + ((left + up) >> 1);
      else if (ft === 4) {
        const pa = Math.abs(up - ul); const pb = Math.abs(left - ul); const pc = Math.abs(left + up - 2 * ul);
        const pr = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : ul);
        v = rawV + pr;
      }
      out[off + x] = v & 0xff;
    }
    p += stride;
  }
  return out;
}

/** 读整数键（`/Width 120`），也认缩写 `/W` `/H` */
function intKey(body: string, key: string): number {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(body);
  return m ? Number(m[1]) : 0;
}

/** ICCBased 色彩空间的通道数（`/ColorSpace [/ICCBased 12 0 R]` → 去解 `/N 3`） */
function iccChannels(body: string, objs: Map<number, PdfObj>): number {
  const ref = /\/ICCBased\s+(\d+)\s+\d+\s+R/.exec(body)?.[1];
  if (!ref) return 0;
  return intKey(objs.get(Number(ref))?.body ?? '', 'N');
}

/** 单个图像对象 → {mediaType, bytes} 或 {skip: 原因} */
function decodeImageObject(o: PdfObj, objs: Map<number, PdfObj>): { mediaType: string; bytes: Buffer } | { skip: string } {
  const body = o.body;
  if (!o.stream || !o.stream.length) return { skip: 'stream 为空' };
  if (/\/ImageMask\s+true/.test(body)) return { skip: 'ImageMask（1 位掩码，不是可视图片）' };
  // ① JPEG：原样
  if (/\/DCTDecode/.test(body)) return { mediaType: 'image/jpeg', bytes: o.stream };
  if (/\/JPXDecode/.test(body)) return { skip: 'JPXDecode（JPEG2000）' };
  if (/\/CCITTFaxDecode/.test(body)) return { skip: 'CCITTFaxDecode（传真压缩）' };
  if (/\/JBIG2Decode/.test(body)) return { skip: 'JBIG2Decode' };
  if (/\/LZWDecode/.test(body)) return { skip: 'LZWDecode' };
  if (/\/RunLengthDecode/.test(body)) return { skip: 'RunLengthDecode' };
  if (!/\/FlateDecode/.test(body)) return { skip: '未知/无 filter' };
  // ② FlateDecode：原始像素 → PNG
  const bpc = intKey(body, 'BitsPerComponent') || 8;
  if (bpc !== 8) return { skip: `BitsPerComponent=${bpc}（只支持 8 位）` };
  const width = intKey(body, 'Width') || intKey(body, 'W');
  const height = intKey(body, 'Height') || intKey(body, 'H');
  if (!width || !height) return { skip: '缺 Width/Height' };
  const cs = /\/ColorSpace\s*\/(\w+)/.exec(body)?.[1] ?? '';
  let channels = 0;
  let colorType: 0 | 2 | -1 = -1;
  if (/\/DeviceRGB/.test(body) || cs === 'RGB') { channels = 3; colorType = 2; }
  else if (/\/DeviceGray/.test(body) || cs === 'Gray' || cs === 'G') { channels = 1; colorType = 0; }
  else if (/\/ICCBased/.test(body)) {
    const n = iccChannels(body, objs);
    if (n === 3) { channels = 3; colorType = 2; }
    else if (n === 1) { channels = 1; colorType = 0; }
  }
  if (colorType === -1) return { skip: `色彩空间不支持（${cs || '未知'}）` };
  // 预测器
  const pred = Number(/\/Predictor\s+(\d+)/.exec(body)?.[1] ?? 1);
  let pixels = o.stream;
  if (Number.isFinite(pred) && pred > 1) {
    if (pred !== 2 && (pred < 10 || pred > 15)) return { skip: `未知 Predictor=${pred}` };
    const fixed = undoPredictor(o.stream, width, height, channels, pred);
    if (!fixed) return { skip: `Predictor=${pred} 反预测失败/长度不符` };
    pixels = fixed;
  }
  if (pixels.length < width * height * channels) return { skip: `像素长度不足（${pixels.length} < ${width * height * channels}）` };
  return { mediaType: 'image/png', bytes: encodePng(width, height, colorType, pixels) };
}

/**
 * 抽出 PDF 里的内嵌图片（按"页顺序 → 页内出现顺序"编号）。
 * 未被任何页引用的图像对象排在最后（page=0）。
 */
export function extractPdfImages(buf: Buffer): PdfImageResult {
  const objs = scanObjects(buf);
  const reasons: Record<string, number> = {};
  const bump = (r: string): void => { reasons[r] = (reasons[r] ?? 0) + 1; };
  if (objs.size === 0) return { images: [], skipped: 0, reasons };

  // 页顺序（与 doc-pdf 同策略：Catalog → Pages → Kids 树；退化到文件顺序）
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
  for (const o of objs.values()) {
    if (/\/Type\s*\/Catalog\b/.test(o.body)) {
      const r = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(o.body)?.[1];
      if (r) walk(Number(r));
    }
  }
  if (!pageNums.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.body)) pageNums.push(o.num);

  // 页 → 引用到的图像对象（/Resources 里的 /XObject 字典；Resources 可能是间接引用）
  const objToPage = new Map<number, number>();
  const pageOrder: number[] = [];
  pageNums.forEach((pn, i) => {
    const page = objs.get(pn);
    if (!page) return;
    let res = page.body;
    const indirect = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(page.body)?.[1];
    if (indirect) res = objs.get(Number(indirect))?.body ?? '';
    const xoBlock = /\/XObject\s*<<([\s\S]*?)>>/.exec(res)?.[1] ?? '';
    for (const m of xoBlock.matchAll(/\/([A-Za-z0-9#+.]+)\s+(\d+)\s+\d+\s+R/g)) {
      const num = Number(m[2]);
      if (!objToPage.has(num)) objToPage.set(num, i + 1);        // 取第一次被引用的页
      if (!pageOrder.includes(num)) pageOrder.push(num);
    }
  });

  // 抽出可解码的图
  const hits: PdfImageHit[] = [];
  let skipped = 0;
  const pushHit = (o: PdfObj, page: number): void => {
    const r = decodeImageObject(o, objs);
    if ('skip' in r) { skipped++; bump(r.skip); return; }
    hits.push({
      objNum: o.num, mediaType: r.mediaType, bytes: r.bytes, page,
      width: intKey(o.body, 'Width') || intKey(o.body, 'W'),
      height: intKey(o.body, 'Height') || intKey(o.body, 'H'),
    });
  };
  for (const num of pageOrder) {
    const o = objs.get(num);
    if (o && /\/Subtype\s*\/Image/.test(o.body)) pushHit(o, objToPage.get(num) ?? 0);
    else if (o) { skipped++; bump('被页引用但不是 /Image 对象'); }
  }
  for (const o of objs.values()) {
    if (objToPage.has(o.num)) continue;
    if (/\/Subtype\s*\/Image/.test(o.body)) pushHit(o, 0);
  }
  return { images: hits, skipped, reasons };
}
