// test/doc-extract.test.mjs — 文档文本抽取内核逐格式测试（PDF/Office/文本）
//   内核：src/registry/doc-extract.ts（零依赖、纯函数）
//   fixture 全部**内存生成**：zip 用自己写的 store/deflate 打包器，PDF 手工拼最小对象表
//   （含 ToUnicode CMap 的中文用例、Flate 压缩流、无文本层用例）。
//   跑法：node test/doc-extract.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { deflateRawSync, inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

// ---------- 载入内核（esbuild 即时打包，与 yaml-lite 测试同款） ----------
const ROOT = resolve(import.meta.dirname, '..');
const dirTmp = tmpRoot('df-doc-extract-');
const OUT = join(dirTmp, 'doc-extract.mjs');
await build({ entryPoints: [join(ROOT, 'src/registry/doc-extract.ts')], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { extractDocument, htmlToText, readZip, DocError, DOC_MAX_BYTES } = await import(pathToFileURL(OUT).href);

// ---------- fixture：zip 打包器（store / deflate） ----------
const CRC_TABLE = (() => {
  const tb = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c; }
  return tb;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ -1) >>> 0;
}
function makeZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, data, useDeflate] of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = useDeflate ? deflateRawSync(raw) : raw;
    const method = useDeflate ? 8 : 0;
    const nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nb, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14); cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nb.length, 28);
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nb);
    offset += lh.length + nb.length + comp.length;
  }
  const cdb = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdb.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdb, eocd]);
}

// ---------- fixture：最小 PDF ----------
// ★ 必须用 Buffer 拼接（不能把二进制流塞进模板串：Buffer→utf8 会把压缩流改成无效字节）
function makePdf(objects) {
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const [num, body] of objects) {
    parts.push(Buffer.from(`${num} 0 obj\n`, 'latin1'));
    parts.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'latin1'));
    parts.push(Buffer.from('\nendobj\n', 'latin1'));
  }
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}
const CJK_CMAP = 'begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n2 beginbfchar\n<0001> <4F60>\n<0002> <597D>\nendbfchar\nendcmap';
function pdfCjk(flate) {
  const content = 'BT /F1 12 Tf 72 720 Td <00010002> Tj ET';
  const cbuf = Buffer.from(content, 'latin1');
  const body = flate ? Buffer.concat([Buffer.from(`<< /Length ${cbuf.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), deflateRawSync(cbuf), Buffer.from('\nendstream', 'latin1')]) : Buffer.from(`<< /Length ${cbuf.length} >>\nstream\n${content}\nendstream`, 'latin1');
  const cmapBuf = Buffer.from(`<< /Length ${CJK_CMAP.length} >>\nstream\n${CJK_CMAP}\nendstream`, 'latin1');
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type0 /BaseFont /NotoSans /Encoding /Identity-H /ToUnicode 5 0 R >>'],
    [5, cmapBuf],
    [6, body],
  ]);
}
function pdfLatin() {
  const content = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj T* (second line) Tj ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ]);
}
// ★ 真实文件（W3C dummy.pdf）踩过的坑：`Td dx 0` 是「相对行原点横向平移」，同一行的文字被拆成好几段
//   —— 必须当成**同一行**（不能换行）；`Td 0 -20` 这种纵向位移才是真换行。
function pdfTdRuns() {
  const content = 'BT /F1 16 Tf 56 758 Td (Dumm) Tj 20 0 Td (y) Tj 30 0 Td (PDF) Tj 0 -20 Td (next line) Tj ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ]);
}
// ★ 真实文件（pdfobject sample.pdf）踩过的坑：一个 TJ 数组里塞多个字符串，必须**各自独立解码**再拼接；
//   攒成一个大字符串再解只会剥掉最外层括号 → 抽出 `Lor)(em)( )(ipsum)`。中文 PDF 常把一个 TJ 拆成多个十六进制串。
function pdfTjArray() {
  const content = 'BT /F1 12 Tf 72 720 Td [ (Lor) 17 (em) -91 ( ) -35 (ipsum) ] TJ ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ]);
}
// 加密 PDF：trailer 带 /Encrypt ⇒ 必须报 DOC_ENCRYPTED（而不是"没有文本层/扫描版"）
function pdfEncrypted() {
  const content = 'BT /F1 12 Tf 72 720 Td (secret) Tj ET';
  const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
  parts.push(Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'));
  parts.push(Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'));
  parts.push(Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n', 'latin1'));
  parts.push(Buffer.from('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 'latin1'));
  parts.push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`, 'latin1'));
  parts.push(Buffer.from('trailer\n<< /Size 6 /Root 1 0 R /Encrypt 9 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}
function pdfNoText() {
  const content = 'q 100 0 0 100 50 600 cm /Im1 Do Q';   // 只有图片绘制，没有 BT/ET
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>'],
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [7, '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\u0000\nendstream'],
  ]);
}

// ---------- fixture：带内嵌图片的 PDF（2026-10-16 第二轮：PDF 抽图） ----------
// 假 JPEG：解析器只认 /DCTDecode 后**原样**取字节，不校验 JPEG 结构（所以能构造确定性 fixture）
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 0x5a), Buffer.from([0xff, 0xd9])]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pdfStreamObj(dict, data) {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
}
/** 正向 PNG Up 预测（filter=2，逐行减上一行）——用来验证内核的反预测 */
function pngUpPredict(pixels, width, channels, height) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      out[y * (stride + 1) + 1 + x] = (cur - up) & 0xff;
    }
  }
  return out;
}
/** 极简 PNG 解码（校验 CRC + 还原像素），用于证明"现场编码的 PNG 内容正确" */
function pngDecode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const chunks = [];
  let p = 8, crcOk = true;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    const crc = buf.readUInt32BE(p + 8 + len);
    if (crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) !== crc) crcOk = false;
    chunks.push({ type, data });
    p += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR')?.data;
  if (!ihdr) return null;
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), colorType = ihdr[9];
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const channels = colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let filtersOk = true;
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) filtersOk = false;
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, colorType, bits: ihdr[8], pixels, crcOk, filtersOk, types: chunks.map((c) => c.type) };
}
const LATIN_FONT = [4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
/** 1 页带文本 + 1 张 DCTDecode(JPEG) 图的 PDF */
function pdfWithJpeg() {
  const content = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET q 100 0 0 100 50 600 cm /Im1 Do Q';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [7, pdfStreamObj('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', FAKE_JPEG)],
  ]);
}
/** 1 页 + 1 张 DCTDecode 图，但 `/Filter` 写成**数组**（2026-10-17 收窄判据的夹具）：
 *  `inner` 传 `/DCTDecode`＝合法单元素数组（应抽出）；传 `/ASCII85Decode /DCTDecode`＝复合 filter（应跳过）。 */
function pdfWithBracketFilter(inner) {
  const content = 'BT /F1 12 Tf 72 720 Td (Bracket) Tj ET q /ImB Do Q';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /ImB 7 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [7, pdfStreamObj(`/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [${inner}]`, FAKE_JPEG)],
  ]);
}
/** 1 页 FlateDecode 灰度图（带 /Predictor 12 ⟺ PNG Up） */
function pdfWithFlateGray() {
  const px = Buffer.from([0, 85, 170, 255]);              // 2×2 灰度
  const data = deflateRawSync(pngUpPredict(px, 2, 1, 2));
  const content = 'BT /F1 12 Tf 72 720 Td (Gray fig) Tj ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [7, pdfStreamObj('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Colors 1 /BitsPerComponent 8 /Columns 2 >>', data)],
  ]);
}
/** 2 页（每页各 1 图）+ 1 张 FlateDecode RGB 无预测图，用来验证"标记落在对应页文本后" */
function pdfTwoPagesWithImages() {
  const c1 = 'BT /F1 12 Tf 72 720 Td (Page one) Tj ET q /ImA Do Q';
  const c2 = 'BT /F1 12 Tf 72 720 Td (Page two) Tj ET q /ImB Do Q';
  const rgb = Buffer.from([255, 0, 0, 0, 255, 0]);         // 2×1 真彩
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /ImA 9 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`],
    [6, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /ImB 10 0 R >> >> /Contents 7 0 R >>'],
    [7, `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`],
    [9, pdfStreamObj('/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', deflateRawSync(rgb))],
    [10, pdfStreamObj('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', FAKE_JPEG)],
  ]);
}
/** 各种"明确不支持"的图像对象：必须只计数不产出（避免落盘一堆打不开的文件） */
function pdfUnsupportedImages() {
  const content = 'BT /F1 12 Tf 72 720 Td (Skip me) Tj ET';
  const mk = (num, dict, body) => [num, pdfStreamObj(dict, body)];
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /A 7 0 R /B 8 0 R /C 9 0 R /D 10 0 R /E 11 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    mk(7, '/Type /XObject /Subtype /Image /Width 4 /Height 4 /Filter /JPXDecode', Buffer.from([1, 2, 3])),
    mk(8, '/Type /XObject /Subtype /Image /Width 4 /Height 4 /Filter /CCITTFaxDecode', Buffer.from([1, 2, 3])),
    [9, '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ImageMask true /BitsPerComponent 1 /Length 1 >>\nstream\n\u0000\nendstream'],
    mk(10, '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode', deflateRawSync(Buffer.from([0]))),
    mk(11, '/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /LZWDecode', Buffer.from([1, 2, 3])),
  ]);
}
/** Predictor 10（PNG None）但流里**没有** filter 字节（部分生成器如此）⇒ 靠流长度判定，照样还原 */
function pdfFlateNoFilterByte() {
  const px = Buffer.from([10, 20, 30, 40]);              // 2×2 灰度
  const content = 'BT /F1 12 Tf 72 720 Td (NoFt) Tj ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [7, pdfStreamObj('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 10 /Colors 1 /BitsPerComponent 8 /Columns 2 >>', deflateRawSync(px))],
  ]);
}
/** 正向 PNG 预测（逐行按 filters 指定 filter type）——覆盖 None/Sub/Up/Average/Paeth 五个分支 */
function pngPredict(pixels, width, channels, height, filters) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const ft = filters[y % filters.length];
    out[y * (stride + 1)] = ft;
    const off = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[off + x];
      const left = x >= channels ? pixels[off + x - channels] : 0;
      const up = y > 0 ? pixels[prev + x] : 0;
      const ul = (y > 0 && x >= channels) ? pixels[prev + x - channels] : 0;
      let pred = 0;
      if (ft === 1) pred = left;
      else if (ft === 2) pred = up;
      else if (ft === 3) pred = (left + up) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        pred = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : ul);
      }
      out[y * (stride + 1) + 1 + x] = (cur - pred) & 0xff;
    }
  }
  return out;
}
/** 5 行 RGB 图，逐行 filter = None/Sub/Up/Average/Paeth + /Predictor 15 ⇒ 反预测五个分支都要走对 */
function pdfPredictor15() {
  const W = 4, H = 5, CH = 3;
  const px = Buffer.alloc(W * H * CH);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 0xff;       // 有梯度、有重复，能咬出预测错误
  const data = deflateRawSync(pngPredict(px, W, CH, H, [0, 1, 2, 3, 4]));
  const content = 'BT /F1 12 Tf 72 720 Td (Pred15) Tj ET';
  return {
    pdf: makePdf([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>'],
      LATIN_FONT,
      [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
      [7, pdfStreamObj('/Type /XObject /Subtype /Image /Width 4 /Height 5 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 4 >>', data)],
    ]),
    pixels: px,
  };
}
/** 图像对象存在但没有任何页引用它 ⇒ page=0，标记挂文末（保证落盘的图在文本里都有出处） */function pdfOrphanImage() {
  const content = 'BT /F1 12 Tf 72 720 Td (Orphan) Tj ET';
  return makePdf([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'],
    LATIN_FONT,
    [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [9, pdfStreamObj('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', FAKE_JPEG)],
  ]);
}

// ==================== 1. 纯文本 / HTML ====================
console.log('== 1. 纯文本与 HTML ==');
{
  const r1 = extractDocument(Buffer.from('\uFEFF你好\r\n世界\n', 'utf8'), 'a.txt');
  t('txt：去 BOM、CRLF→LF', r1.text === '你好\n世界\n' && r1.format === 'text', JSON.stringify(r1.text));
  t('txt：chars/meta 正确', r1.chars === r1.text.length && r1.meta.bytes === Buffer.byteLength('\uFEFF你好\r\n世界\n'), JSON.stringify(r1.meta));

  const md = extractDocument(Buffer.from('# 标题\n正文', 'utf8'), 'note.md');
  t('md：格式名 markdown 且原样保留', md.format === 'markdown' && md.text.includes('# 标题'), md.format);

  const csv = extractDocument(Buffer.from('a,b\n1,2\n', 'utf8'), 't.csv');
  t('csv：原样保留（不解析列）', csv.format === 'csv' && csv.text === 'a,b\n1,2\n', csv.format);

  const html = extractDocument(Buffer.from('<html><head><title>政策速览</title><style>p{color:red}</style></head><body><script>x()</script><h1>标题</h1><p>第一段&amp;更多</p><ul><li>条目一</li><li>条目二</li></ul></body></html>', 'utf8'), 'p.html');
  t('html：剥掉 script/style', !/x\(\)|color:red/.test(html.text), html.text.slice(0, 80));
  t('html：块级标签转换行、实体解码', /标题\n第一段&更多/.test(html.text), JSON.stringify(html.text));
  t('html：li 转换行', /条目一\n条目二/.test(html.text), JSON.stringify(html.text));
  t('html：提出 title 进 meta', html.meta.title === '政策速览', String(html.meta.title));
  t('html：htmlToText 可单独调用', htmlToText('<p>a</p><p>b</p>').text === 'a\nb');

  const trunc = extractDocument(Buffer.from('x'.repeat(100), 'utf8'), 'a.txt', { maxChars: 10 });
  t('maxChars 截断：text 长度 10 且 truncated=true', trunc.text.length === 10 && trunc.truncated === true && trunc.chars === 10, JSON.stringify({ l: trunc.text.length, tr: trunc.truncated }));
  t('DOC_MAX_BYTES 常量存在（100MB）', DOC_MAX_BYTES === 100 * 1024 * 1024);
}

// ==================== 2. docx ====================
console.log('== 2. docx ==');
{
  const documentXml = [
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>',
    '<w:p><w:r><w:t>第一段</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>第二</w:t></w:r><w:r><w:t>段</w:t></w:r></w:p>',
    '<w:p/>',
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '<w:p><w:r><w:t>结尾&amp;实体</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join('');
  const docx = makeZip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', documentXml, true],   // ★ 这一条用 deflate，顺便验证压缩条目
    ['word/styles.xml', '<styles/>'],
  ]);
  t('zip 读取：能列出条目', readZip(docx).size === 3);
  const r = extractDocument(docx, '报告.docx');
  t('docx：格式识别', r.format === 'docx', r.format);
  t('docx：段落文本与换行', /第一段\n第二段/.test(r.text), JSON.stringify(r.text));
  t('docx：同一段多个 run 会拼起来', r.text.includes('第二段'), JSON.stringify(r.text));
  t('docx：表格内容也取到', /甲/.test(r.text) && /乙/.test(r.text), JSON.stringify(r.text));
  t('docx：实体解码', r.text.includes('结尾&实体'), JSON.stringify(r.text));
  t('docx：meta.paragraphs 计数', Number(r.meta.paragraphs) >= 5, JSON.stringify(r.meta));
  t('docx：deflate 条目被正确解压（能读到正文）', r.chars > 10, String(r.chars));
}

// ==================== 3. xlsx ====================
console.log('== 3. xlsx ==');
{
  const wb = '<?xml version="1.0"?><workbook><sheets><sheet name="汇总" sheetId="1" r:id="rId1"/><sheet name="明细" sheetId="2" r:id="rId2"/></sheets></workbook>';
  const ss = '<sst><si><t>北京</t></si><si><t>上海</t></si><si><t>合计</t></si></sst>';
  const sheet1 = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2"><v>42</v></c><c r="C2" t="s"><v>2</v></c></row>'
    + '</sheetData></worksheet>';
  const sheet2 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>内联</t></is></c></row></sheetData></worksheet>';
  const xlsx = makeZip([
    ['xl/workbook.xml', wb],
    ['xl/sharedStrings.xml', ss],
    ['xl/worksheets/sheet1.xml', sheet1],
    ['xl/worksheets/sheet2.xml', sheet2],
  ]);
  const r = extractDocument(xlsx, '数据.xlsx');
  t('xlsx：格式识别 + 工作表数', r.format === 'xlsx' && r.meta.sheets === 2, JSON.stringify(r.meta));
  t('xlsx：共享字符串解析', r.text.includes('北京') && r.text.includes('上海'), r.text.slice(0, 80));
  t('xlsx：数字单元格', /42/.test(r.text), r.text);
  t('xlsx：稀疏列用制表符对齐（B 列缺失 → 42\\t\\t合计）', /42\t+合计/.test(r.text), JSON.stringify(r.text));
  t('xlsx：工作表名进正文', r.text.includes('## 汇总') && r.text.includes('## 明细'), r.text.slice(0, 60));
  t('xlsx：内联字符串', r.text.includes('内联'), r.text);
  t('xlsx：meta.rows 计数', Number(r.meta.rows) === 3, JSON.stringify(r.meta));
}

// ==================== 4. pptx ====================
console.log('== 4. pptx ==');
{
  const slide = (title, body) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p>${body ? `<a:p><a:r><a:t>${body}</a:t></a:r></a:p>` : ''}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const pptx = makeZip([
    ['ppt/slides/slide2.xml', slide('第二页标题', '正文二')],   // ★ 故意先放 slide2，验证按序号排序
    ['ppt/slides/slide1.xml', slide('第一页标题', '正文一')],
    ['ppt/presentation.xml', '<presentation/>'],
  ]);
  const r = extractDocument(pptx, '讲稿.pptx');
  t('pptx：格式识别 + 幻灯片数', r.format === 'pptx' && r.meta.slides === 2, JSON.stringify(r.meta));
  const i1 = r.text.indexOf('第一页标题'); const i2 = r.text.indexOf('第二页标题');
  t('pptx：按 slide 序号排序（不是 zip 顺序）', i1 >= 0 && i2 > i1, JSON.stringify(r.text));
  t('pptx：页标题与正文都在', r.text.includes('正文一') && r.text.includes('正文二'), r.text);
  t('pptx：页分隔标题', /## 第 1 页/.test(r.text) && /## 第 2 页/.test(r.text), r.text.slice(0, 40));
}

// ==================== 4b. 内嵌图片抽取（2026-10-16 doc_parse 抽图落统一目录） ====================
console.log('== 4b. 内嵌图片抽取 ==');
{
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const EMF = Buffer.from([1, 0, 0, 0, 9, 9, 9]);
  const docXml = '<w:document><w:body>'
    + '<w:p><w:r><w:t>正文甲</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>'
    + '<w:p><w:r><w:t>正文乙</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:r></w:p>'
    + '<w:p><w:r><w:t>正文丙</w:t></w:r><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>'
    + '</w:body></w:document>';
  const rels = '<Relationships>'
    + '<Relationship Id="rId5" Type="image" Target="media/image1.png"/>'
    + '<Relationship Id="rId7" Type="image" Target="media/logo.emf"/>'
    + '</Relationships>';
  const docx = makeZip([
    ['word/document.xml', docXml],
    ['word/_rels/document.xml.rels', rels],
    ['word/media/image1.png', PNG],
    ['word/media/logo.emf', EMF],
  ]);
  const r = extractDocument(docx, '带图报告.docx');
  t('docx 抽图：png 被抽出 1 张', r.images.length === 1, JSON.stringify(r.images.map((i) => i.source)));
  t('docx 抽图：字节原样（png 魔数在）', r.images[0]?.bytes.equals(PNG) === true);
  t('docx 抽图：mediaType 由扩展名推出', r.images[0]?.mediaType === 'image/png', String(r.images[0]?.mediaType));
  t('docx 抽图：source 记录容器内位置', r.images[0]?.source === 'word/media/image1.png', String(r.images[0]?.source));
  t('★ docx 文本：图片位置就地标注 [图片 #1]', r.text.includes('正文甲 [图片 #1]'), JSON.stringify(r.text));
  t('★ docx 文本：同一张图被引用两次只标一次', r.text.includes('正文丙 [图片 #1]'), JSON.stringify(r.text));
  t('docx 抽图：非白名单格式（emf）跳过并计数', r.meta.skippedImages === 1, JSON.stringify(r.meta));
  t('docx 抽图：meta.images 记数', r.meta.images === 1, JSON.stringify(r.meta));
  const plain = extractDocument(makeZip([['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>纯文字</w:t></w:r></w:p></w:body></w:document>']]), '纯文字.docx');
  t('★ 无图文档：文本与改动前一致（不含 [图片）', plain.text.includes('纯文字') && !plain.text.includes('[图片'), JSON.stringify(plain.text));
  t('无图文档：images 为空数组', Array.isArray(plain.images) && plain.images.length === 0);
}
{
  const XPNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 6]);
  const xlsx = makeZip([
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'],
    ['xl/media/image1.png', XPNG],
  ]);
  const r = extractDocument(xlsx, '带图表.xlsx');
  t('xlsx 抽图：从 xl/media 收到 1 张', r.images.length === 1 && r.images[0]?.source === 'xl/media/image1.png', JSON.stringify(r.images.map((i) => i.source)));
  t('★ xlsx 文本：图片标记附在文末', /\[图片 #1\]\s*$/.test(r.text.trim()), JSON.stringify(r.text));
}
{
  const PPNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]);
  const slide1 = '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>一页文字</a:t></a:r></a:p></p:txBody></p:sp>'
    + '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>';
  const pptx = makeZip([
    ['ppt/slides/slide1.xml', slide1],
    ['ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId2" Type="image" Target="../media/image1.png"/></Relationships>'],
    ['ppt/media/image1.png', PPNG],
  ]);
  const r = extractDocument(pptx, '带图讲稿.pptx');
  t('pptx 抽图：`../media` 相对路径被归一化后取到 1 张', r.images.length === 1 && r.images[0]?.source === 'ppt/media/image1.png', JSON.stringify(r.images.map((i) => i.source)));
  t('★ pptx 文本：图片标记在该页文本下方', /一页文字[\s\S]*\[图片 #1\]/.test(r.text), JSON.stringify(r.text));
}

// ==================== 5. pdf ====================
console.log('== 5. pdf ==');
{
  const r1 = extractDocument(pdfCjk(true), '公文.pdf');
  t('pdf：格式识别', r1.format === 'pdf', r1.format);
  t('pdf：FlateDecode 流 + ToUnicode CMap → 中文', r1.text.includes('你好'), JSON.stringify(r1.text));
  t('pdf：meta.pages', r1.meta.pages === 1, JSON.stringify(r1.meta));

  const r2 = extractDocument(pdfCjk(false), '公文-未压缩.pdf');
  t('pdf：未压缩流同样可读（中文）', r2.text.includes('你好'), JSON.stringify(r2.text));

  const r3 = extractDocument(pdfLatin(), 'latin.pdf');
  t('pdf：无 CMap 时按 Latin-1 兜底', r3.text.includes('Hello PDF'), JSON.stringify(r3.text));
  t('pdf：T* 换行被识别为两行', /Hello PDF\nsecond line/.test(r3.text), JSON.stringify(r3.text));

  // ★ 真实文件踩过的两个坑（W3C dummy.pdf / orimi 加密件）
  const r4 = extractDocument(pdfTdRuns(), 'td-runs.pdf');
  t('pdf：同行的 Td dx 分段不换行（Dummy 不会被拆成多行）', r4.text.includes('DummyPDF'), JSON.stringify(r4.text));
  t('pdf：Td 纵向位移才换行', /DummyPDF\nnext line/.test(r4.text), JSON.stringify(r4.text));
  let enc = null;  try { extractDocument(pdfEncrypted(), '加密.pdf'); } catch (e) { enc = e; }
  t('pdf：带 /Encrypt → DOC_ENCRYPTED（不是"没有文本层"）', enc instanceof DocError && enc.code === 'DOC_ENCRYPTED', String(enc?.code));
  t('pdf：加密提示引导去密码另存', /密码/.test(String(enc?.message)), String(enc?.message));

  let noText = null;
  try { extractDocument(pdfNoText(), '扫描件.pdf'); } catch (e) { noText = e; }
  t('pdf：无文本层 → DOC_NO_TEXT_LAYER（明确不做 OCR）', noText instanceof DocError && noText.code === 'DOC_NO_TEXT_LAYER', String(noText?.code));
  t('pdf：无文本层的提示提到"扫描/OCR"', /扫描|OCR/.test(String(noText?.message)), String(noText?.message));

  const r5 = extractDocument(pdfTjArray(), 'tj-array.pdf');
  t('pdf：TJ 数组里多个字符串各自解码后拼接（无 ) ( 残渣）', r5.text.trim() === 'Lorem ipsum', JSON.stringify(r5.text));
}

// ==================== 5b. PDF 内嵌图片（2026-10-16 第二轮） ====================
console.log('== 5b. PDF 内嵌图片 ==');
{
  // ① DCTDecode ⇒ 原样取 JPEG（零转换、零重编码）
  const r = extractDocument(pdfWithJpeg(), '带图.pdf');
  t('pdf 抽图：DCTDecode 抽出 1 张', r.images.length === 1, JSON.stringify(r.images.map((i) => i.source)));
  t('pdf 抽图：JPEG 字节**逐字节原样**（含 FFD8 头 / FFD9 尾）', r.images[0]?.bytes.equals(FAKE_JPEG) === true, String(r.images[0]?.bytes.length));
  t('pdf 抽图：mediaType=image/jpeg', r.images[0]?.mediaType === 'image/jpeg', String(r.images[0]?.mediaType));
  t('pdf 抽图：index 从 1 开始且与标记一致', r.images[0]?.index === 1);
  t('pdf 抽图：source 注明页号与对象号', r.images[0]?.source === '第 1 页 (对象 7)', String(r.images[0]?.source));
  t('★ pdf 文本：图片标记落在该页文本之后', /Hello PDF\n\[图片 #1\]/.test(r.text), JSON.stringify(r.text));
  t('pdf 抽图：meta.images 记数', r.meta.images === 1, JSON.stringify(r.meta));
  t('pdf 抽图：本用例无跳过', r.meta.skippedImages === undefined, JSON.stringify(r.meta));

  // ①b ★ 2026-10-17 收窄（用户拍板）：`/Filter [/DCTDecode]` 是**合法单元素数组**、字节就是真 JPEG
  //   ⇒ 必须照抽（原来"是数组就跳过"会白丢一张图）；安全性由下面的 SOI(FF D8) 闸兜底。
  const single = extractDocument(pdfWithBracketFilter('/DCTDecode'), 'bracket-single.pdf');
  t('★ pdf 抽图：/Filter [/DCTDecode] 单元素数组仍抽出（不再白丢）', single.images.length === 1 && single.images[0]?.bytes.equals(FAKE_JPEG) === true, JSON.stringify(single.meta));
  t('pdf 抽图：单元素数组不计入 skipped', single.meta.skippedImages === undefined, JSON.stringify(single.meta));
  // ①c 复合 filter（外面还裹着别的编码）⇒ 仍然跳过（宁缺勿坏：原样写出就是打不开的坏图）
  const compound = extractDocument(pdfWithBracketFilter('/ASCII85Decode /DCTDecode'), 'bracket-compound.pdf');
  t('★ pdf 抽图：/Filter [/ASCII85Decode /DCTDecode] 仍跳过（未解码，不产出坏图）', compound.images.length === 0 && !!compound.meta.skippedImages, JSON.stringify(compound.meta));

  // ② FlateDecode 原始像素 ⇒ 现场编码 PNG；带 /Predictor 12（PNG Up）需反预测
  const g = extractDocument(pdfWithFlateGray(), '灰度图.pdf');
  const png = pngDecode(g.images[0]?.bytes);
  t('pdf 抽图：FlateDecode 灰度图 → PNG 容器', g.images[0]?.mediaType === 'image/png' && png !== null, String(g.images[0]?.mediaType));
  t('pdf 抽图：PNG 宽高取自 /Width /Height', png?.width === 2 && png?.height === 2, JSON.stringify(png && { w: png.width, h: png.height }));
  t('pdf 抽图：PNG colorType=0（灰度）8 位', png?.colorType === 0 && png?.bits === 8, JSON.stringify(png && { ct: png.colorType, b: png.bits }));
  t('★ pdf 抽图：Predictor 12 反预测后像素与原图逐字节相同', png?.pixels.equals(Buffer.from([0, 85, 170, 255])) === true, JSON.stringify(png?.pixels));
  t('pdf 抽图：PNG 三个 chunk 齐全且 CRC 全部正确', png?.types.join(',') === 'IHDR,IDAT,IEND' && png?.crcOk === true, JSON.stringify(png && { types: png.types, crc: png.crcOk }));
  t('pdf 抽图：PNG 每行 filter 为 0（解码器都能读）', png?.filtersOk === true);

  // ③ 两页各一图 ⇒ 标记落在**各自页**的文本后面（这就是用户要的"相应位置"）
  const m = extractDocument(pdfTwoPagesWithImages(), '两页.pdf');
  const iPage1 = m.text.indexOf('[图片 #1]'); const iPage2 = m.text.indexOf('[图片 #2]');
  t('pdf 抽图：两页各抽 1 张', m.images.length === 2, JSON.stringify(m.images.map((i) => i.source)));
  t('pdf 抽图：第 1 张属于第 1 页、第 2 张属于第 2 页', m.images[0]?.source.startsWith('第 1 页') && m.images[1]?.source.startsWith('第 2 页'), JSON.stringify(m.images.map((i) => i.source)));
  t('★ pdf 文本：标记顺序为 页1文本 → #1 → 页2文本 → #2', m.text.indexOf('Page one') >= 0 && iPage1 > m.text.indexOf('Page one') && iPage2 > m.text.indexOf('Page two') && iPage1 < m.text.indexOf('Page two'), JSON.stringify(m.text));
  t('pdf 抽图：RGB 无预测图同样现场编码 PNG', pngDecode(m.images[0]?.bytes)?.pixels.equals(Buffer.from([255, 0, 0, 0, 255, 0])) === true);
  t('pdf 抽图：第 2 页 JPEG 原样', m.images[1]?.bytes.equals(FAKE_JPEG) === true);

  // ④ 不支持的类型：只计数、不产出（JPX/CCITT/ImageMask/1 位/LZW）
  const s = extractDocument(pdfUnsupportedImages(), '怪图.pdf');
  t('pdf 抽图：不支持的类型一张都不产出', s.images.length === 0, JSON.stringify(s.images.map((i) => i.mediaType)));
  t('pdf 抽图：跳过 5 个都计入 skippedImages', s.meta.skippedImages === 5, JSON.stringify(s.meta));
  t('★ pdf 抽图：跳过原因清单可直接看出"为什么没抽到"', (() => {
    const keys = Object.keys(s.skippedImageReasons ?? {});
    return keys.length === 5
      && keys.some((k) => k.startsWith('JPXDecode'))
      && keys.some((k) => k.startsWith('CCITTFaxDecode'))
      && keys.some((k) => k.startsWith('LZWDecode'))
      && keys.some((k) => k.includes('ImageMask'))
      && keys.some((k) => k.includes('BitsPerComponent'));
  })(), JSON.stringify(s.skippedImageReasons));
  t('★ pdf 文本：没有产出图片时文本里不出现 [图片 标记', !s.text.includes('[图片'), JSON.stringify(s.text));

  // ⑤ 孤儿图像对象：page=0，标记挂文末（落盘的图在文本里一定有出处）
  const o = extractDocument(pdfOrphanImage(), '孤儿图.pdf');
  t('pdf 抽图：未被页引用的图仍被抽出（source 标注未引用）', o.images.length === 1 && o.images[0]?.source === '未引用对象 9', JSON.stringify(o.images.map((i) => i.source)));
  t('pdf 抽图：孤儿图标记附在文末', /Orphan\n\n\[图片 #1\]/.test(o.text), JSON.stringify(o.text));

  // ⑤b Predictor 声明了但流里没有 filter 字节（部分生成器）⇒ 长度判定兜底，不能把像素解错位
  const nf = pngDecode(extractDocument(pdfFlateNoFilterByte(), 'nf.pdf').images[0]?.bytes);
  t('pdf 抽图：Predictor 10 且无 filter 字节 ⇒ 按流长度兜底还原', nf?.pixels.equals(Buffer.from([10, 20, 30, 40])) === true, JSON.stringify(nf?.pixels));

  // ⑤c Predictor 15 + 逐行混合 filter（None/Sub/Up/Average/Paeth）⇒ 反预测五个分支全走对
  const p15 = pdfPredictor15();
  const d15 = pngDecode(extractDocument(p15.pdf, 'p15.pdf').images[0]?.bytes);
  t('★ pdf 抽图：Predictor 15 逐行混合 filter（含 Paeth/Average）像素逐字节还原', d15?.pixels.equals(p15.pixels) === true && d15?.width === 4 && d15?.height === 5 && d15?.colorType === 2, JSON.stringify(d15 && { w: d15.width, h: d15.height, ct: d15.colorType, same: d15.pixels.equals(p15.pixels) }));

  // ⑥ 无图片的 PDF：输出与改动前逐字一致（红线：不能影响现有功能）
  const plain = extractDocument(pdfLatin(), 'latin2.pdf');
  t('★ 无图 PDF：text 与纯文本解析逐字相同', plain.text === 'Hello PDF\nsecond line', JSON.stringify(plain.text));
  t('无图 PDF：images 为空数组、不写 skippedImages', plain.images.length === 0 && plain.meta.skippedImages === undefined, JSON.stringify(plain.meta));
  t('无图 PDF：不带 skippedImageReasons 字段（输出与改动前一致）', plain.skippedImageReasons === undefined);
  const cjk = extractDocument(pdfCjk(true), '公文2.pdf');
  t('★ 无图 PDF（中文）：text 与纯文本解析逐字相同', cjk.text === '你好', JSON.stringify(cjk.text));
}

// ==================== 6. 错误路径 ====================
console.log('== 6. 错误路径 ==');
{
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e1 = errOf(() => extractDocument(Buffer.from('x'), 'noext'));
  t('无扩展名 → DOC_UNSUPPORTED', e1?.code === 'DOC_UNSUPPORTED', String(e1?.code));
  const e2 = errOf(() => extractDocument(Buffer.from('x'), '旧稿.doc'));
  t('旧版 .doc → DOC_UNSUPPORTED 且提示另存为 docx', e2?.code === 'DOC_UNSUPPORTED' && /另存为.*docx/.test(String(e2?.message)), String(e2?.message));
  const e3 = errOf(() => extractDocument(Buffer.from('x'), '旧稿.xls'));
  t('旧版 .xls → 提示另存为 xlsx', e3?.code === 'DOC_UNSUPPORTED' && /xlsx/.test(String(e3?.message)), String(e3?.message));
  const e4 = errOf(() => extractDocument(Buffer.from('not a zip'), '坏.docx'));
  t('坏 zip → DOC_PARSE_FAILED', e4?.code === 'DOC_PARSE_FAILED', String(e4?.code));
  const e5 = errOf(() => extractDocument(makeZip([['a.txt', 'x']]), '缺正文.docx'));
  t('docx 缺 word/document.xml → DOC_PARSE_FAILED', e5?.code === 'DOC_PARSE_FAILED', String(e5?.code));
  const e6 = errOf(() => extractDocument(Buffer.from('zz'), 'x.rtf'));
  t('未知扩展名 → DOC_UNSUPPORTED 并列出支持的格式', e6?.code === 'DOC_UNSUPPORTED' && /pdf/.test(String(e6?.message)), String(e6?.message));
  t('错误都带 code 与中文消息', e1 instanceof DocError && /[\u4e00-\u9fa5]/.test(String(e1?.message)), String(e1?.message));
}

console.log(`\n=== doc-extract：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
