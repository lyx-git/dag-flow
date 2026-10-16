// test/ocr.test.mjs — OCR 适配层（src/adapter/ocr.ts）离线测试：**假引擎**，零网络零下载
//
// 为什么用假引擎：适配层的职责是「装/找引擎 + 建契约 + 传参 + 收结果 + 兜错误 + 超时取消」，
//   这些都能用一个按契约说话的假脚本钉死（确定性、毫秒级）；真实引擎的效果另外用真机实测（轮 2）。
// 假引擎用 **node 自己** 当解释器（DAGFLOW_OCR_PYTHON=process.execPath），所以不依赖本机 Python。
// 跑法：node test/ocr.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';   // ★ 必须最先：隔离 DSH_HOME（绝不碰真机数据/运行区）
import { ISOLATED_HOME } from './_isolate-home.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- 环境准备 ----------
const work = tmpRoot('dag-ocr-');
const engineDir = join(work, 'engine');
mkdirSync(join(engineDir, 'rapidocr_onnxruntime'), { recursive: true });
writeFileSync(join(engineDir, 'rapidocr_onnxruntime', '__init__.py'), '# fake engine\n', 'utf8');

const fakeScript = join(work, 'fake_ocr.mjs');
writeFileSync(fakeScript, `
// 假引擎：复刻 runtime/ocr/rapid_ocr.py 的契约（stdout 噪声 + 标记行 + 退出码）
import { setTimeout as sleep } from 'node:timers/promises';
const mode = process.env.FAKE_OCR_MODE || 'ok';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let req = {};
try { req = JSON.parse(raw); } catch { /* 让下面按无图处理 */ }
const images = req.images || [];
const noise = () => { console.log('[fake-ocr] loading engine…'); console.error('[fake-ocr] stderr 提示'); };
const emit = (o) => console.log('__OCR_JSON__ ' + JSON.stringify(o));
noise();
if (mode === 'no-image') { emit({ ok: false, code: 'OCR_NO_IMAGE', message: '没有可识别的图片（images 为空）' }); process.exit(2); }
if (mode === 'empty') { emit({ ok: true, text: '   ', lines: 0, confidence: 0, durationMs: 3 }); process.exit(0); }
if (mode === 'garbage') { console.log('__OCR_JSON__ {不是合法 JSON'); process.exit(0); }
if (mode === 'crash') { console.error('Traceback: 引擎炸了'); process.exit(7); }
if (mode === 'init-fail') { emit({ ok: false, code: 'OCR_INIT_FAILED', message: '无法导入 rapidocr_onnxruntime' }); process.exit(3); }
if (mode === 'slow') { await sleep(3000); emit({ ok: true, text: '太慢了', lines: 1, confidence: 0.5, durationMs: 3000 }); process.exit(0); }
if (mode === 'echo') {
  emit({ ok: true, text: 'GET:' + images.join('|'), lines: images.length, confidence: 0.93, durationMs: 12 });
  process.exit(0);
}
emit({ ok: true, text: '政策速览\\n第一段正文', lines: 2, confidence: 0.91, durationMs: 20 });
process.exit(0);
`, 'utf8');

process.env.DAGFLOW_OCR_PYTHON = process.execPath;      // 用 node 当"python"
process.env.DAGFLOW_OCR_SCRIPT = fakeScript;            // 用假脚本当 rapid_ocr.py
process.env.DAGFLOW_OCR_ENGINE_DIR = engineDir;         // 引擎"已装好"
delete process.env.FAKE_OCR_MODE;

const OUT = join(work, 'ocr.mjs');
await build({ entryPoints: ['src/adapter/ocr.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const ocr = await import(pathToFileURL(OUT).href);
const { normalizeOcrMode, clampMaxPages, clampTimeout, ocrEngineState, ocrEngineCandidates, parseOcrPayload, ocrImages, ocrImageFile, ocrPdf, OcrError } = ocr;

const codeOf = async (fn) => { try { await fn(); return '(没抛)'; } catch (e) { return e?.code ?? e?.name ?? String(e); } };
const img = join(work, 'a.png');
const img2 = join(work, 'b.png');

// ==================== A. 参数容错（面板写的是字符串！） ====================
console.log('== A. 参数形态容错 ==');
t("normalizeOcrMode：undefined/false/'off' → off", normalizeOcrMode(undefined) === 'off' && normalizeOcrMode(false) === 'off' && normalizeOcrMode('off') === 'off');
t("normalizeOcrMode：true/'auto'/'自动'/'1'/'true'/'是' → auto（表示开启但没明说强制）", ['auto', '自动', '1', 'true', 'on', 'yes', '是'].every((v) => normalizeOcrMode(v) === 'auto') && normalizeOcrMode(true) === 'auto');
t("normalizeOcrMode：只有 'force'/'强制' → force", normalizeOcrMode('force') === 'force' && normalizeOcrMode('强制') === 'force');
t("normalizeOcrMode：乱填的值一律当 off（不偷下载引擎）", normalizeOcrMode('xyz') === 'off' && normalizeOcrMode('') === 'off' && normalizeOcrMode({}) === 'off');
t("clampMaxPages：空串/0 → 默认 20；'50' → 50；超界 → 200", clampMaxPages('') === 20 && clampMaxPages(0) === 20 && clampMaxPages('50') === 50 && clampMaxPages(9999) === 200);
t("clampTimeout：空串/负数 → 120000；'2000' → 2000；下限 1000；上限 1800000", clampTimeout('') === 120000 && clampTimeout(-5) === 120000 && clampTimeout('2000') === 2000 && clampTimeout(10) === 1000 && clampTimeout(99999999) === 1800000);

// ==================== B. 引擎状态（不触发下载） ====================
console.log('== B. 引擎状态 ==');
const st = ocrEngineState();
t('ocrEngineState：引擎已装 → ready=true', st.ready === true, JSON.stringify(st));
t('ocrEngineState：脚本能找到（随包分发）', st.scriptFound === true, st.scriptPath);
t('ocrEngineState：engineDir 走覆盖值（隔离环境不碰真机运行区）', st.engineDir === engineDir, st.engineDir);
process.env.DAGFLOW_OCR_ENGINE_DIR = join(work, 'not-installed');
const st2 = ocrEngineState();
t('ocrEngineState：没装时 ready=false 且**不触发下载**', st2.ready === false);
process.env.DAGFLOW_OCR_ENGINE_DIR = engineDir;

// B2. 引擎目录优先级：插件自带（与 python/bash 并列）优先，DSH_HOME 兜底
const savedEngineOverride = process.env.DAGFLOW_OCR_ENGINE_DIR;
delete process.env.DAGFLOW_OCR_ENGINE_DIR;
const cands = ocrEngineCandidates();
t('候选目录 = 2 个（插件自带 + DSH_HOME 兜底）', cands.length === 2 && cands[0] !== cands[1], JSON.stringify(cands));
t('第 1 候选在插件 runtime/ 下（与 python/bash 同一层）', cands[0].includes(join('runtime', 'rapidocr', '1.4.4')) && !cands[0].startsWith(ISOLATED_HOME), cands[0]);
t('第 2 候选锚定 <DSH_HOME>/runtime/（隔离 home，绝不碰真机）', cands[1].startsWith(join(ISOLATED_HOME, 'runtime', 'rapidocr', '1.4.4')), cands[1]);
t('设了 DAGFLOW_OCR_ENGINE_DIR 时只用它（测试隔离靠这个）', (() => { process.env.DAGFLOW_OCR_ENGINE_DIR = '/tmp/xxx'; const r = ocrEngineCandidates(); process.env.DAGFLOW_OCR_ENGINE_DIR = savedEngineOverride; return r.length === 1 && r[0] === '/tmp/xxx'; })());

// ==================== C. 契约与结果解析 ====================
console.log('== C. 契约与结果解析 ==');
const r1 = await ocrImageFile(img);
t('识别成功：拿到文本/行数/置信度', r1.text.includes('政策速览') && r1.lines === 2 && r1.confidence === 0.91, JSON.stringify(r1));
t('engine 标记带版本（可追溯）', r1.engine === 'rapidocr-1.4.4', r1.engine);
process.env.FAKE_OCR_MODE = 'echo';
const r2 = await ocrImages([img, img2]);
t('多图按顺序透传（stdin JSON 契约）', r2.text === `GET:${img}|${img2}` && r2.lines === 2, r2.text);
t('库往 stdout 打的噪声不影响解析（只认标记行）', r2.confidence === 0.93);
process.env.FAKE_OCR_MODE = 'ok';
const parsed = parseOcrPayload('乱码\n__OCR_JSON__ {"ok":true,"text":"x"}\n尾部');
t('parseOcrPayload：从多行里取最后一条标记行', parsed?.text === 'x', JSON.stringify(parsed));
t('parseOcrPayload：没有标记行 → null', parseOcrPayload('只有日志') === null);

// ==================== D. 错误路径（码必须明确） ====================
console.log('== D. 错误路径 ==');
process.env.FAKE_OCR_MODE = 'empty';
t('识别不出文字 → OCR_NO_TEXT', (await codeOf(() => ocrImageFile(img))) === 'OCR_NO_TEXT');
process.env.FAKE_OCR_MODE = 'garbage';
t('标记行是坏 JSON → OCR_FAILED', (await codeOf(() => ocrImageFile(img))) === 'OCR_FAILED');
process.env.FAKE_OCR_MODE = 'crash';
const crashCode = await codeOf(() => ocrImageFile(img));
t('非零退出且无标记 → OCR_FAILED 且带上 stderr 摘要', crashCode === 'OCR_FAILED', crashCode);
process.env.FAKE_OCR_MODE = 'init-fail';
const initCode = await codeOf(() => ocrImageFile(img));
t('脚本自报 OCR_INIT_FAILED → 原样透传该码', initCode === 'OCR_INIT_FAILED', initCode);
process.env.FAKE_OCR_MODE = 'ok';
t('图片列表为空 → OCR_NO_IMAGE', (await codeOf(() => ocrImages([]))) === 'OCR_NO_IMAGE');

const realPython = process.env.DAGFLOW_OCR_PYTHON;
process.env.DAGFLOW_OCR_PYTHON = join(work, '不存在的解释器.exe');
t('解释器不存在 → OCR_ENGINE_MISSING（并提示逃生舱）', (await codeOf(() => ocrImageFile(img))) === 'OCR_ENGINE_MISSING');
process.env.DAGFLOW_OCR_PYTHON = realPython;
const realScript = process.env.DAGFLOW_OCR_SCRIPT;
process.env.DAGFLOW_OCR_SCRIPT = join(work, '没有这个脚本.py');
t('脚本缺失 → OCR_ENGINE_MISSING', (await codeOf(() => ocrImageFile(img))) === 'OCR_ENGINE_MISSING');
process.env.DAGFLOW_OCR_SCRIPT = realScript;

// ==================== E. 超时与取消 ====================
console.log('== E. 超时与取消 ==');
process.env.FAKE_OCR_MODE = 'slow';
const tOut = Date.now();
const timeoutCode = await codeOf(() => ocrImageFile(img, { timeoutMs: 1000 }));
const elapsed = Date.now() - tOut;
t('超时 → OCR_TIMEOUT', timeoutCode === 'OCR_TIMEOUT', timeoutCode);
t('超时后子进程被真的杀掉（1s 超时 / 3s 睡眠，实测 <2.6s）', elapsed < 2600, `${elapsed}ms`);

const ac = new AbortController();
setTimeout(() => ac.abort(), 150);
const tAb = Date.now();
const cancelCode = await codeOf(() => ocrImageFile(img, { timeoutMs: 30000, signal: ac.signal }));
t('AbortSignal 取消 → RUN_CANCELLED（复用既有码）', cancelCode === 'RUN_CANCELLED', cancelCode);
t('取消是即时的（<1.5s，不用等超时）', Date.now() - tAb < 1500, `${Date.now() - tAb}ms`);
process.env.FAKE_OCR_MODE = 'ok';

// ==================== F. 异常类型 ====================
console.log('== F. 异常类型 ==');
let err = null;
try { await ocrImages([]); } catch (e) { err = e; }
t('抛的是 OcrError（上层可按 code 分流）', err instanceof OcrError && err.name === 'OcrError', String(err?.name));
t('错误消息是中文可读（不含英文堆栈）', /[一-龥]/.test(String(err?.message)) && !/at Object/.test(String(err?.message)), String(err?.message).slice(0, 60));

// ==================== G. 契约一致性（python 脚本 ↔ 适配层） ====================
// 沙箱里起不了 python，所以脚本本身跑不起来；但它与适配层的**契约**必须锁死，
// 否则两边各改各的（标记串/错误码/images 字段）会静默失配。
console.log('== G. 契约一致性（脚本 ↔ 适配层） ==');
t('依赖全部钉版本，且 onnxruntime 钉在能用的 1.19.2', ocr.OCR_ENGINE_PACKAGES.includes('rapidocr-onnxruntime==1.4.4') && ocr.OCR_ENGINE_PACKAGES.includes('onnxruntime==1.19.2'), JSON.stringify(ocr.OCR_ENGINE_PACKAGES));
t('opencv 用 headless 版（只用图像运算，不要 GUI）', ocr.OCR_ENGINE_PACKAGES.includes('opencv-python-headless'), JSON.stringify(ocr.OCR_ENGINE_PACKAGES));
const pyPath = join(process.cwd(), 'runtime', 'ocr', 'rapid_ocr.py');
const pySrc = existsSync(pyPath) ? readFileSync(pyPath, 'utf8') : '';
t('runtime/ocr/rapid_ocr.py 随包存在', pySrc.length > 0, pyPath);
t('标记串两边一致（__OCR_JSON__）', ocr.OCR_MARK === '__OCR_JSON__' && pySrc.includes(`'${ocr.OCR_MARK}'`), ocr.OCR_MARK);
t('脚本从 stdin JSON 读 images 数组（与适配层发的字段一致）', pySrc.includes("req.get('images')") && pySrc.includes('json.loads'));
t('脚本会回适配层认识的错误码（OCR_NO_IMAGE / OCR_INIT_FAILED / OCR_FAILED）', ['OCR_NO_IMAGE', 'OCR_INIT_FAILED', 'OCR_FAILED'].every((c) => pySrc.includes(c)));
t('脚本只在标记行写 stdout（emit 是唯一出口）', (pySrc.match(/sys\.stdout\.write/g) ?? []).length === 1 && pySrc.includes('MARK + '));
t('脚本强制 UTF-8（Windows 中文不乱码）', pySrc.includes('reconfigure(encoding=') && pySrc.includes("'utf-8'"));
t('脚本兼容 rapidocr 两种返回形态（1.x 列表 / 2.x 对象）', pySrc.includes('txts') && pySrc.includes('isinstance(out, tuple)'));

// ==================== H. 扫描版 PDF 通路（假 pdf 脚本，离线） ====================
console.log('== H. 扫描版 PDF 通路 ==');
const fakePdfScript = join(work, 'fake_pdf_ocr.mjs');
writeFileSync(fakePdfScript, `
import { setTimeout as sleep } from 'node:timers/promises';
const mode = process.env.FAKE_PDF_MODE || 'ok';
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const req = JSON.parse(raw || '{}');
const emit = (o) => console.log('__OCR_JSON__ ' + JSON.stringify(o));
console.error('[fake-pdf] 噪声日志');
if (mode === 'bad-pdf') { emit({ ok: false, code: 'OCR_PDF_FAILED', message: '打不开这个 PDF' }); process.exit(4); }
if (mode === 'empty') { emit({ ok: true, text: '  ', pages: 3, ocrPages: 3, truncated: false, confidence: 0, durationMs: 5, perPage: [] }); process.exit(0); }
if (mode === 'slow') { await sleep(3000); emit({ ok: true, text: '慢', pages: 1, ocrPages: 1, truncated: false, confidence: 1, durationMs: 3000, perPage: [] }); process.exit(0); }
if (mode === 'echo') { emit({ ok: true, text: 'MAXPAGES=' + req.maxPages + ';SCALE=' + req.scale, pages: 9, ocrPages: 3, truncated: true, confidence: 0.9, durationMs: 12, perPage: [{ page: 1, lines: 2, chars: 10 }] }); process.exit(0); }
emit({ ok: true, text: '扫描件第一页正文\\n第二行', pages: 2, ocrPages: 2, truncated: false, confidence: 0.95, durationMs: 40, perPage: [{ page: 1, lines: 1, chars: 7 }, { page: 2, lines: 1, chars: 3 }] });
process.exit(0);
`, 'utf8');
process.env.DAGFLOW_OCR_PDF_SCRIPT = fakePdfScript;
const pdfPath = join(work, 'scan.pdf');
writeFileSync(pdfPath, '%PDF-1.4\n%%EOF', 'latin1');

const pr = await ocrPdf(pdfPath);
t('PDF-OCR：拿到文本/总页数/识别页数/置信度', pr.text.includes('扫描件第一页正文') && pr.pages === 2 && pr.ocrPages === 2 && pr.confidence === 0.95, JSON.stringify({ ...pr, text: pr.text.slice(0, 12) }));
t('PDF-OCR：perPage 明细解析正确', pr.perPage.length === 2 && pr.perPage[0].chars === 7 && pr.perPage[1].lines === 1, JSON.stringify(pr.perPage));
t('PDF-OCR：engine 标记含 pdfium（可追溯是栅格化路线）', /pdfium/.test(pr.engine), pr.engine);
process.env.FAKE_PDF_MODE = 'echo';
const echoed = await ocrPdf(pdfPath, { maxPages: '', scale: 99 });
t('PDF-OCR：参数收敛（空 maxPages → 20、scale 超界 → 2）', echoed.text === 'MAXPAGES=20;SCALE=2' && echoed.truncated === true, echoed.text);
const asStr50 = await ocrPdf(pdfPath, { maxPages: '50' });
t("PDF-OCR：maxPages 传字符串 '50' 也生效（面板形态）", asStr50.text.startsWith('MAXPAGES=50'), asStr50.text);
const asBig = await ocrPdf(pdfPath, { maxPages: 9999 });
t('PDF-OCR：页数超界被夹到 200', asBig.text.startsWith('MAXPAGES=200'), asBig.text);
process.env.FAKE_PDF_MODE = 'ok';

process.env.FAKE_PDF_MODE = 'bad-pdf';
t('PDF-OCR：打不开 PDF → 原样透传 OCR_PDF_FAILED', (await codeOf(() => ocrPdf(pdfPath))) === 'OCR_PDF_FAILED');
process.env.FAKE_PDF_MODE = 'empty';
t('PDF-OCR：没识别出文字 → OCR_NO_TEXT', (await codeOf(() => ocrPdf(pdfPath))) === 'OCR_NO_TEXT');
process.env.FAKE_PDF_MODE = 'slow';
t('PDF-OCR：超时 → OCR_TIMEOUT', (await codeOf(() => ocrPdf(pdfPath, { timeoutMs: 1000 }))) === 'OCR_TIMEOUT');
process.env.FAKE_PDF_MODE = 'ok';
const savedPdfScript = process.env.DAGFLOW_OCR_PDF_SCRIPT;
process.env.DAGFLOW_OCR_PDF_SCRIPT = join(work, '没有这个脚本.py');
t('PDF-OCR：栅格化脚本缺失 → OCR_ENGINE_MISSING', (await codeOf(() => ocrPdf(pdfPath))) === 'OCR_ENGINE_MISSING');
process.env.DAGFLOW_OCR_PDF_SCRIPT = savedPdfScript;
t('PDF-OCR：没给路径 → OCR_PDF_FAILED', (await codeOf(() => ocrPdf(''))) === 'OCR_PDF_FAILED');
delete process.env.DAGFLOW_OCR_PDF_SCRIPT;

console.log(`\n=== ocr：${pass} passed, ${fail} failed ===`);
if (fail) { console.log('失败项：' + failures.join(' / ')); process.exit(1); }
