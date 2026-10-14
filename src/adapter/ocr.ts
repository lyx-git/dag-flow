// src/adapter/ocr.ts — 图片 OCR 适配层（2026-10-11 轮 1：**零侵入内核**，尚未接进任何节点）
//
// 目标：把「图片 → 文本」这件事做成**可测的库**，再谈接到 doc_parse 上（轮 2）。
//
// ★ 引擎与落点（与 python / MinGit / uv 同一套分发规矩）：
//   <plugin>/runtime/rapidocr/<版本>/<平台>/        ← **首选**：随插件内置（与 runtime/python、runtime/bash 并列）
//   <DSH_HOME>/runtime/rapidocr/<版本>/<平台>/      ← 兜底：插件目录不可写时按需下载到这里
//   <DSH_HOME>/runtime/ocr-cache/                   ← 安装时的 uv 缓存/python 目录（显式钉住，不污染用户目录）
//   <plugin>/runtime/ocr/rapid_ocr.py               ← 随插件分发的小脚本（图片→JSON，见该文件头）
//   ★ win-x64 已内置（2026-10-11 实测 249.3 MB / 3588 文件）；其它平台首次用会自动下载（约 250MB，仅首次）。
// ★ 为什么走「脚本 + stdin JSON」而不是 `python -c`：命令行长、转义坑多，且这样能离线单测。
// ★ 为什么需要脚本回一条带标记的 JSON：OCR 库自己会往 stdout 打日志，标记行保证只认我们要的那行。
//
// ★ 逃生舱（也用于测试，全部在调用时读取，便于隔离环境）：
//   DAGFLOW_OCR_PYTHON     指定解释器（默认用内置 Python）
//   DAGFLOW_OCR_SCRIPT     指定 rapid_ocr.py 路径
//   DAGFLOW_OCR_ENGINE_DIR 指定引擎目录（默认 <DSH_HOME>/runtime/rapidocr/<版本>/<平台>）
//   DAGFLOW_PYPI_MIRROR    首选 PyPI 镜像（默认官方源，失败自动回落清华 / 阿里源）
//
// ★ 错误码（轮 2 接进 doc_parse 时登记进 docs/ERROR_REFERENCE.md）：
//   OCR_ENGINE_MISSING / OCR_DOWNLOAD_FAILED / OCR_INIT_FAILED / OCR_FAILED / OCR_TIMEOUT / OCR_NO_TEXT / OCR_NO_IMAGE
//   （取消复用既有的 RUN_CANCELLED）
//
// 本文件不依赖 ctx，可被单测直接调用（见 test/ocr.test.mjs）。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHome } from './dsh-home.js';
import { detectPlatform, resolvePython, resolveUv, type Platform } from './runtime.js';
import { ensureTool } from './runtime-ensure.js';

export const RAPIDOCR_VERSION = '1.4.4';
/** 引擎依赖（**全部钉版本**，别用 latest）：
 *  ★ onnxruntime 必须钉 **1.19.2**——2026-10-11 实测：内置 Python 3.12.14（python-build-standalone）上
 *    `onnxruntime 1.31.0` 导入即**原生崩溃**（0xC0000005），`1.22.1` 报「DLL 初始化例程失败」(WinError 1114)，
 *    只有 1.19.2 能正常 `import onnxruntime`。钉它是可复现构建的前提。
 *  ★ opencv 用 headless 版（RapidOCR 只用 cv2 的图像运算、不用 GUI；体积与普通版基本一致，2026-10-11 实测同 112MB）。 */
export const OCR_ENGINE_PACKAGES = ['rapidocr-onnxruntime==1.4.4', 'onnxruntime==1.19.2', 'opencv-python-headless', 'pypdfium2==5.14.0'];
export const OCR_DEFAULT_TIMEOUT_MS = 120_000;
/** 扫描版 PDF 的默认超时（逐页栅格化 + 识别，页多时慢；可用 ocrTimeoutMs 覆盖） */
export const OCR_PDF_DEFAULT_TIMEOUT_MS = 300_000;
export const OCR_DEFAULT_MAX_PAGES = 20;
/** 脚本回传 JSON 的行标记（前面可能混着 OCR 库自己的日志） */
export const OCR_MARK = '__OCR_JSON__';

type OcrMode = 'off' | 'auto' | 'force';

/** 带错误码的 OCR 异常（码与 message 都是中文可读的，见文件头） */
export class OcrError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
  }
}

interface OcrOptions {
  /** 超时（可传字符串/空值，内部统一收敛） */
  timeoutMs?: unknown;
  signal?: AbortSignal;
}

interface OcrPdfOptions extends OcrOptions {
  /** 最多识别几页（可传字符串/空值，内部收敛到 [1,200]，默认 20） */
  maxPages?: unknown;
  /** 栅格化倍率（1–5，默认 2 ≈ 150dpi） */
  scale?: number;
}

interface OcrPdfResult {
  text: string;
  /** PDF 总页数 */
  pages: number;
  /** 实际识别了几页 */
  ocrPages: number;
  /** 是否因为 ocrMaxPages 只识别了前几页 */
  truncated: boolean;
  confidence: number;
  perPage: { page: number; lines: number; chars: number }[];
  engine: string;
  durationMs: number;
}

interface OcrText {
  text: string;
  lines: number;
  confidence: number;
  engine: string;
  durationMs: number;
}

interface OcrEngineState {
  ready: boolean;
  installedNow?: boolean;
  engineDir: string;
  scriptPath: string;
  scriptFound: boolean;
  pythonExe: string;
  pythonSource: string;
  /** 引擎目录候选（按优先级：插件自带 → DSH_HOME 兜底） */
  candidates: string[];
}

// ==================== 参数容错（面板写的是字符串！见 lesson「面板参数形态」） ====================

/** 把面板/JSON/模板传进来的任意值收敛成三档。未知值一律当 `off`（不改变既有行为、不偷偷下载引擎）。
 *  ★ 凡"表示开启但没明说强制"的值（true / '1' / 'on' / 'yes'）都收敛成 **auto**：
 *    auto 的语义是"有原生文本就用文本，没有才 OCR"，比 force 安全（不会白花几十秒）。强制要明说 `force` / `强制`。 */
export function normalizeOcrMode(v: unknown): OcrMode {
  if (v === true) return 'auto';
  if (v === false || v == null) return 'off';
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? 'auto' : 'off';
  const s = String(v).trim().toLowerCase();
  if (!s) return 'off';
  if (s === 'force' || s === '强制') return 'force';
  if (s === 'auto' || s === '自动' || s === 'true' || s === '1' || s === 'on' || s === 'yes' || s === 'y' || s === '是') return 'auto';
  return 'off';
}

/** 页数上限：面板可能给字符串/空串/负数，一律收敛到 [1, 200] */
export function clampMaxPages(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return OCR_DEFAULT_MAX_PAGES;
  return Math.min(Math.floor(n), 200);
}

/** 超时（毫秒）：收敛到 [1000, 1800000]，默认 120s */
export function clampTimeout(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return OCR_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(n), 1_000), 1_800_000);
}

// ==================== 路径 ====================

/** 插件根目录（含 runtime/ 的那一层）：dist/adapter/ocr.js → 上两级；dist/ocr.js → 上一级 */
function pluginRoot(): string {
  let here = '';
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { here = __dirnameFallback(); }
  const candidates = [path.resolve(here, '..', '..'), path.resolve(here, '..'), here];
  for (const c of candidates) if (existsSync(path.join(c, 'runtime'))) return c;
  return candidates[0]!;
}

/** 插件自带运行区：<plugin>/runtime/rapidocr/<版本>/<平台>（**与 runtime/python、runtime/bash 并列**） */
function bundledEngineDir(platform: Platform): string {
  return path.join(pluginRoot(), 'runtime', 'rapidocr', RAPIDOCR_VERSION, platform);
}

/** 兜底：<DSH_HOME>/runtime/rapidocr/<版本>/<平台>（插件目录不可写的安装形态用） */
function cachedEngineDir(platform: Platform): string {
  return path.join(dshHome(), 'runtime', 'rapidocr', RAPIDOCR_VERSION, platform);
}

/** 引擎目录候选（**按优先级**）：插件自带 → DSH_HOME 兜底；设了 DAGFLOW_OCR_ENGINE_DIR 时只用它 */
export function ocrEngineCandidates(platform: Platform = detectPlatform()): string[] {
  const override = (process.env.DAGFLOW_OCR_ENGINE_DIR ?? '').trim();
  if (override) return [override];
  return [bundledEngineDir(platform), cachedEngineDir(platform)];
}

/** 实际用哪个：优先已装好的那个候选；都没装则取第一候选（= 安装目标） */
export function ocrEngineDir(platform: Platform = detectPlatform()): string {
  const list = ocrEngineCandidates(platform);
  return list.find((d) => isEngineReady(d)) ?? list[0]!;
}

/** 目录可写探测（决定装到插件自带区还是 DSH_HOME 兜底区） */
function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    writeFileSync(probe, 'x');
    rmSync(probe, { force: true });
    return true;
  } catch { return false; }
}

/** 随插件分发的 OCR 脚本路径（可用 DAGFLOW_OCR_SCRIPT 覆盖）。tsc 形态与 esbuild 形态都要能找。 */
export function ocrScriptPath(): string {
  return ocrScriptFile('rapid_ocr.py', 'DAGFLOW_OCR_SCRIPT');
}

/** 扫描版 PDF 用的脚本（栅格化 + OCR）；可用 DAGFLOW_OCR_PDF_SCRIPT 覆盖 */
export function ocrPdfScriptPath(): string {
  return ocrScriptFile('pdf_ocr.py', 'DAGFLOW_OCR_PDF_SCRIPT');
}

function ocrScriptFile(fileName: string, envKey: string): string {
  const override = (process.env[envKey] ?? '').trim();
  if (override) return override;
  const byRoot = path.join(pluginRoot(), 'runtime', 'ocr', fileName);
  if (existsSync(byRoot)) return byRoot;
  let here = '';
  try { here = path.dirname(fileURLToPath(import.meta.url)); } catch { here = __dirnameFallback(); }
  const candidates = [
    path.resolve(here, '..', '..', 'runtime', 'ocr', fileName),   // dist/adapter/ocr.js（tsc）
    path.resolve(here, '..', 'runtime', 'ocr', fileName),         // dist/ocr.js（打包后同层）
    path.resolve(here, 'runtime', 'ocr', fileName),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return byRoot;
}

function __dirnameFallback(): string {
  try { return path.dirname(process.argv[1] ?? process.cwd()); } catch { return process.cwd(); }
}

async function resolvePythonExe(signal?: AbortSignal): Promise<string> {
  const override = (process.env.DAGFLOW_OCR_PYTHON ?? '').trim();
  if (override) {
    if (!existsSync(override)) throw new OcrError('OCR_ENGINE_MISSING', `DAGFLOW_OCR_PYTHON 指向的解释器不存在：${override}`);
    return override;
  }
  // ★ 2026-10-11 用户要求：读不到就自动下载（并验兼容性——OCR 轮子是 cp312，必须是 3.12.x）
  try {
    const r = await ensureTool('python', { log: (m) => console.info(m) });
    if (signal?.aborted) throw new OcrError('RUN_CANCELLED', '安装 Python 期间运行被取消');
    return r.exe;
  } catch (e) {
    if (e instanceof OcrError) throw e;
    const err = e as { code?: string; message?: string };
    throw new OcrError(err.code ?? 'OCR_ENGINE_MISSING', `OCR 需要一份可用的 Python 运行时：${err.message ?? String(e)}`);
  }
}

/** 装完立刻验"真的能导入"——下载就能用，不留"装上了但跑不起来"的雷 */
function verifyEngineImport(engineDir: string, pyExe: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return runProcess(pyExe, ['-c', 'import rapidocr_onnxruntime, pypdfium2; print("ok")'], {
    env: { ...env, PYTHONPATH: engineDir }, cwd: dshHome(), timeoutMs: 120_000,
  }).then((r) => r.code === 0 && /ok/.test(r.stdout));
}

/** 引擎是否已装好：只要 rapidocr_onnxruntime 包在（含模型）就算好 */
function isEngineReady(engineDir: string): boolean {
  return existsSync(path.join(engineDir, 'rapidocr_onnxruntime', '__init__.py'));
}

/** 当前状态（供面板/节点给"要不要下载"的提示；**不触发任何下载**） */
export function ocrEngineState(): OcrEngineState {
  const engineDir = ocrEngineDir();
  const scriptPath = ocrScriptPath();
  let pythonExe = '';
  let pythonSource = 'missing';
  try { const py = resolvePython(); pythonExe = py.exe; pythonSource = py.source; } catch { /* 保持 missing */ }
  const override = (process.env.DAGFLOW_OCR_PYTHON ?? '').trim();
  if (override) { pythonExe = override; pythonSource = existsSync(override) ? 'override' : 'missing'; }
  const candidates = ocrEngineCandidates();
  return {
    ready: candidates.some((d) => isEngineReady(d)),
    engineDir,
    scriptPath,
    scriptFound: existsSync(scriptPath),
    pythonExe,
    pythonSource,
    candidates,
  };
}

// ==================== 进程 ====================

interface RunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean; spawnError?: string }

function runProcess(bin: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number; signal?: AbortSignal; stdin?: string }): Promise<RunResult> {
  return new Promise((resolve) => {
    const result: RunResult = { code: null, stdout: '', stderr: '', timedOut: false, aborted: false };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, args, { env: opts.env, cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    } catch (e) {
      result.spawnError = (e as Error).message;
      resolve(result);
      return;
    }
    let done = false;
    const finish = (code: number | null, spawnError?: string): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      result.code = code;
      if (spawnError) result.spawnError = spawnError;
      resolve(result);
    };
    const kill = (): void => { try { child.kill(); } catch { /* 已经退了 */ } };
    const timer = setTimeout(() => { result.timedOut = true; kill(); }, Math.max(200, opts.timeoutMs));
    const onAbort = (): void => { result.aborted = true; kill(); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    child.stdout.on('data', (d: Buffer) => { result.stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { result.stderr += d.toString('utf8'); });
    child.on('error', (e: Error) => finish(null, e.message));
    child.on('close', (code: number | null) => finish(code));
    try {
      if (opts.stdin !== undefined) child.stdin.write(opts.stdin, 'utf8');
      child.stdin.end();
    } catch { /* stdin 写失败就让脚本自己报错 */ }
  });
}

function tailText(s: string, max = 400): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

/** 从 stdout 里取最后一条带标记的 JSON（OCR 库/警告会混在其它行里） */
export function parseOcrPayload(stdout: string): Record<string, unknown> | null {
  const lines = (stdout ?? '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith(OCR_MARK)) continue;
    try {
      const obj = JSON.parse(line.slice(OCR_MARK.length).trim()) as unknown;
      return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
    } catch { return null; }
  }
  return null;
}

// ==================== 引擎安装（按需下载到插件运行区） ====================

let installLock: Promise<{ engineDir: string; installedNow: boolean }> | null = null;

/** 确保引擎可用：已装 → 直接返回；没装 → 用内置 uv 装（**优先插件自带 runtime/**，不可写才落 DSH_HOME；官方源失败自动回落镜像）。 */
export async function ensureEngine(opts: { signal?: AbortSignal } = {}): Promise<{ engineDir: string; installedNow: boolean }> {
  const existing = ocrEngineDir();
  if (isEngineReady(existing)) return { engineDir: existing, installedNow: false };
  if (installLock) return installLock;
  installLock = (async () => {
    const pyExe = await resolvePythonExe(opts.signal);      // ★ 缺失即自动下载（并验 3.12 兼容）
    // uv 同理：读不到就自动下载；下不来也不硬失败 —— 退回 `python -m pip`（引擎装得上就行）
    let uvExe = resolveUv().exe;
    if (!uvExe) {
      try { uvExe = (await ensureTool('uv', { log: (m) => console.info(m) })).exe; }
      catch (e) { console.info(`[dag-flow] uv 不可用，改用 python -m pip 安装 OCR 引擎：${(e as Error)?.message ?? e}`); }
    }
    // 装到哪：插件自带区优先（与 python/bash 并列），不可写则落 <DSH_HOME>/runtime 兜底
    const candidates = ocrEngineCandidates();
    const engineDir = candidates.find((d) => canWriteDir(d)) ?? candidates[0]!;
    const cacheDir = path.join(dshHome(), 'runtime', 'ocr-cache');
    try { mkdirSync(cacheDir, { recursive: true }); } catch { /* 建不出来就让 uv 自己报错 */ }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UV_CACHE_DIR: cacheDir,
      UV_PYTHON_INSTALL_DIR: path.join(cacheDir, 'python'),
      UV_NO_CONFIG: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
    };
    const pkg = OCR_ENGINE_PACKAGES.join(' ');
    // 镜像兜底（2026-10-11 实测：`pypi.npmmirror.com` 是**死域名**（ENOTFOUND），换成本机实测可达的国内源）
    const mirrors: (string | null)[] = [
      process.env.DAGFLOW_PYPI_MIRROR || null,
      'https://pypi.tuna.tsinghua.edu.cn/simple',
      'https://mirrors.aliyun.com/pypi/simple/',
    ];
    let lastErr = '';
    for (const mirror of mirrors) {
      if (opts.signal?.aborted) throw new OcrError('RUN_CANCELLED', '安装 OCR 引擎期间运行被取消');
      const useUv = !!uvExe && existsSync(uvExe);
      const bin = useUv ? uvExe : pyExe;
      const args = useUv
        ? ['pip', 'install', '--python', pyExe, '--target', engineDir, pkg, ...(mirror ? ['--index-url', mirror] : [])]
        : ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', engineDir, pkg, ...(mirror ? ['--index-url', mirror] : [])];
      const r = await runProcess(bin, args, { env, cwd: cacheDir, timeoutMs: 600_000, signal: opts.signal });
      if (r.aborted) throw new OcrError('RUN_CANCELLED', '安装 OCR 引擎期间运行被取消');
      if (r.code === 0 && isEngineReady(engineDir)) {
        // ★ 装完必须**验导入**：避免"包装上了但依赖不全/ABI 不匹配，跑起来才炸"
        if (await verifyEngineImport(engineDir, pyExe, env)) return { engineDir, installedNow: true };
        lastErr = '引擎文件已就位，但 import rapidocr_onnxruntime / pypdfium2 失败（依赖不完整或 ABI 不匹配）';
        continue;
      }
      lastErr = r.timedOut
        ? '安装超时（10 分钟）——网络太慢或源不可达'
        : (tailText(r.stderr) || tailText(r.stdout) || `退出码 ${r.code}`);
    }
    throw new OcrError('OCR_DOWNLOAD_FAILED', `OCR 引擎安装失败：${lastErr}。可手动安装：uv pip install --target "${engineDir}" ${pkg}`);
  })();
  try { return await installLock; } finally { installLock = null; }
}

// ==================== 识别 ====================

/** 识别一张或多张图片（按顺序拼接文本），返回文本与行数/平均置信度。 */
export async function ocrImages(imagePaths: string[], opts: OcrOptions = {}): Promise<OcrText> {
  const images = (imagePaths ?? []).filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());
  if (!images.length) throw new OcrError('OCR_NO_IMAGE', '没有可识别的图片（图片列表为空）');
  const script = ocrScriptPath();
  if (!existsSync(script)) throw new OcrError('OCR_ENGINE_MISSING', `OCR 脚本缺失：${script}——插件安装可能不完整（应随包分发 runtime/ocr/rapid_ocr.py）`);
  const pyExe = await resolvePythonExe(opts.signal);
  const timeoutMs = clampTimeout(opts.timeoutMs ?? OCR_DEFAULT_TIMEOUT_MS);
  const { engineDir } = await ensureEngine({ signal: opts.signal });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: [engineDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  const t0 = Date.now();
  const r = await runProcess(pyExe, [script], {
    env,
    cwd: dshHome(),
    timeoutMs,
    signal: opts.signal,
    stdin: JSON.stringify({ images }),
  });
  if (r.aborted || opts.signal?.aborted) throw new OcrError('RUN_CANCELLED', '识别期间运行被取消');
  if (r.spawnError) throw new OcrError('OCR_INIT_FAILED', `无法启动 OCR 进程（${pyExe}）：${r.spawnError}`);
  if (r.timedOut) throw new OcrError('OCR_TIMEOUT', `OCR 超时（${timeoutMs}ms，${images.length} 张图）——可加大超时，或用页数上限限制张数`);
  const payload = parseOcrPayload(r.stdout);
  if (!payload) throw new OcrError('OCR_FAILED', `OCR 引擎没有返回可解析的结果（退出码 ${r.code}）：${tailText(r.stderr) || tailText(r.stdout) || '(无输出)'}`);
  if (payload.ok === false) throw new OcrError(String(payload.code ?? 'OCR_FAILED'), String(payload.message ?? 'OCR 失败（未给原因）'));
  const text = String(payload.text ?? '');
  const lines = Number(payload.lines);
  const conf = Number(payload.confidence);
  if (!text.trim()) throw new OcrError('OCR_NO_TEXT', `${images.length} 张图都没识别出文字——可能是纯图形/只有表格线，或图片过于模糊`);
  return {
    text,
    lines: Number.isFinite(lines) && lines > 0 ? lines : text.split('\n').filter(Boolean).length,
    confidence: Number.isFinite(conf) ? conf : 0,
    engine: `rapidocr-${RAPIDOCR_VERSION}`,
    durationMs: Date.now() - t0,
  };
}

/** 单图便捷入口 */
export function ocrImageFile(imagePath: string, opts: OcrOptions = {}): Promise<OcrText> {
  return ocrImages([imagePath], opts);
}

/**
 * 扫描版 PDF：逐页栅格化（pypdfium2）后 OCR。**只在没有文本层、或用户明确强制时才该调用。**
 * 页数上限与超时都会收敛，避免一个几百页的扫描件把运行拖死。
 */
export async function ocrPdf(pdfPath: string, opts: OcrPdfOptions = {}): Promise<OcrPdfResult> {
  const target = String(pdfPath ?? '').trim();
  if (!target) throw new OcrError('OCR_PDF_FAILED', '没有可识别的 PDF 路径');
  const script = ocrPdfScriptPath();
  if (!existsSync(script)) {
    throw new OcrError('OCR_ENGINE_MISSING', `扫描版 PDF 需要栅格化脚本：${script}——插件安装可能不完整（应随包分发 runtime/ocr/pdf_ocr.py）`);
  }
  const pyExe = await resolvePythonExe(opts.signal);
  const timeoutMs = opts.timeoutMs === undefined || opts.timeoutMs === null || opts.timeoutMs === ''
    ? OCR_PDF_DEFAULT_TIMEOUT_MS
    : clampTimeout(opts.timeoutMs);
  const maxPages = clampMaxPages(opts.maxPages);
  const scale = Number.isFinite(opts.scale) && (opts.scale as number) >= 1 && (opts.scale as number) <= 5 ? (opts.scale as number) : 2;
  const { engineDir } = await ensureEngine({ signal: opts.signal });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: [engineDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  const t0 = Date.now();
  const r = await runProcess(pyExe, [script], {
    env,
    cwd: dshHome(),
    timeoutMs,
    signal: opts.signal,
    stdin: JSON.stringify({ pdf: target, maxPages, scale }),
  });
  if (r.aborted || opts.signal?.aborted) throw new OcrError('RUN_CANCELLED', '扫描件识别期间运行被取消');
  if (r.spawnError) throw new OcrError('OCR_INIT_FAILED', `无法启动 PDF-OCR 进程（${pyExe}）：${r.spawnError}`);
  if (r.timedOut) throw new OcrError('OCR_TIMEOUT', `扫描版 PDF 识别超时（${timeoutMs}ms，最多 ${maxPages} 页）——可加大超时，或把上限调小`);
  const payload = parseOcrPayload(r.stdout);
  if (!payload) throw new OcrError('OCR_FAILED', `PDF-OCR 没有返回可解析的结果（退出码 ${r.code}）：${tailText(r.stderr) || tailText(r.stdout) || '(无输出)'}`);
  if (payload.ok === false) throw new OcrError(String(payload.code ?? 'OCR_FAILED'), String(payload.message ?? 'PDF 识别失败（未给原因）'));
  const text = String(payload.text ?? '');
  if (!text.trim()) throw new OcrError('OCR_NO_TEXT', `这份 PDF 的 ${Number(payload.ocrPages ?? 0) || maxPages} 页里没识别出文字——可能是纯图形页、空白页，或扫描件过于模糊`);
  const perPageRaw = Array.isArray(payload.perPage) ? payload.perPage : [];
  const perPage = perPageRaw
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const item = p as Record<string, unknown>;
      return { page: Number(item.page ?? 0) || 0, lines: Number(item.lines ?? 0) || 0, chars: Number(item.chars ?? 0) || 0 };
    });
  const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    text,
    pages: num(payload.pages, perPage.length),
    ocrPages: num(payload.ocrPages, perPage.length),
    truncated: payload.truncated === true,
    confidence: num(payload.confidence, 0),
    perPage,
    engine: `rapidocr-${RAPIDOCR_VERSION}+pdfium`,
    durationMs: Date.now() - t0,
  };
}
