// src/registry/nodes/script.ts — python / bash 两个脚本节点
// 运行时解析 resolvePython/resolveBash（../../adapter/runtime）+ 缺失自动下载 ensureTool（runtime-ensure）；
// 取消语义：abort → SIGKILL 子进程 + RUN_CANCELLED（2026-10-08）。拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NodeDefinition, NodeResult } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { resolvePython, resolveBash } from '../../adapter/runtime.js';
import { ensureTool } from '../../adapter/runtime-ensure.js';
import { startedEnded, finish, resolveCodePath } from './shared.js';

/**
 * 构造脚本子进程 env（2026-10-02 修复 bash 节点 127：ls/wc/head command not found）。
 * 根因：MinGit 的外部命令全在 <runtime>/usr/bin/ 下，宿主 PATH 不含它——bash 只能用
 * shell 内建，所有外部命令 127。把 exe 所在目录插到子进程 PATH 最前，MinGit 工具链
 * （ls/wc/head/cat/grep/sed/awk/find…）全部可用；补 HOME 兜底（MinGit sh 的 ~ 展开）。
 * 仅作用于本次 spawn 的子进程，不碰系统环境变量。
 */
function scriptEnv(exe: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const sep = process.platform === 'win32' ? ';' : ':';
  env.PATH = `${dirname(exe)}${sep}${env.PATH ?? ''}`;
  if (!env.HOME) env.HOME = env.USERPROFILE ?? env.HOMEPATH ?? '';
  // ★ 2026-10-11：禁止 python 往磁盘写 .pyc —— `runtime/` 是**被 git 跟踪**的目录，Python 每次
  //   导入标准库（csv / xml.etree / json …）都可能重写 `Lib/**/__pycache__/*.pyc`，把仓库弄脏
  //   （实测：跑一次采集/解析子工作流，git status 就出现若干 modified 的 .pyc）。
  //   只影响本次 spawn 的子进程；已编译的 stdlib 缓存仍在 runtime 里，导入速度不受影响。
  env.PYTHONDONTWRITEBYTECODE = '1';
  return env;
}

/** ★ 2026-10-11 用户拍板：python/bash 节点的**默认执行目录 = `<DSH_HOME>/.dag-flow`**（dag-flow 数据根），
 *  **不再继承宿主 `process.cwd()`**（= 启动 dsh web 的目录）——脚本写相对路径会落进数据根，跟其它
 *  dag-flow 数据同处一地（与「dag-flow 创建的文件默认放 <DSH_HOME>/.dag-flow」这条存储锚点一致）。
 *  显式 `params.cwd` **完全覆盖**；取数据根失败时回退 `undefined`（= 继承宿主 cwd），
 *  绝不因为取不到目录就让节点跑不起来。
 *  ★ 注意：`dagFlowDir` 是**函数内动态 import**（见 shared.ts 的 resolveCodePath，同款做法）——
 *  避免模块级循环依赖，运行时才取。 */
async function scriptCwd(p: { cwd?: string }, runDir?: string): Promise<string | undefined> {
  if (p.cwd) return p.cwd;
  // ★ 2026-10-18 用户要求「本次运行的文件都在 tmp 下的独立目录、节点之间也在那儿互相读」：
  //   本次运行的临时目录优先于数据根（显式 params.cwd 仍然完全覆盖）。
  const rd = String(runDir ?? '').trim();
  if (rd) return rd;
  try {
    const { dagFlowDir } = await import('../../adapter/workspace.js');
    return await dagFlowDir();
  } catch { return undefined; }
}

/** ★ 2026-10-18：把本次运行的临时目录注入子进程环境（脚本里 `os.environ['DAGFLOW_RUN_DIR']` 可直接取） */
function withRunDir(env: NodeJS.ProcessEnv, runDir?: string): NodeJS.ProcessEnv {
  const rd = String(runDir ?? '').trim();
  if (rd) env.DAGFLOW_RUN_DIR = rd;
  return env;
}

/** ★ 2026-10-18 用户选择「全部落盘」：python/bash 的 stdout/stderr 各存一份到
 *  `<runDir>/nodes/<节点id>.out|.err`（失败也落）。运行记录里节点输出有长度裁剪（约 1200 字），
 *  完整输出只有这里能看到；这些文件随「最新 5 条运行目录」一起被清。
 *  写失败一律静默——落盘是增强，绝不能影响节点结果。 */
async function dumpNodeOutput(runDir?: string, nodeId?: string, out?: string, err?: string): Promise<void> {
  const rd = String(runDir ?? '').trim();
  if (!rd) return;
  const id = String(nodeId ?? '').trim().replace(/[^\w.-]/g, '_') || 'node';
  try {
    const dir = join(rd, 'nodes');
    await mkdir(dir, { recursive: true });
    if (typeof out === 'string' && out.length > 0) await writeFile(join(dir, `${id}.out`), out, 'utf8');
    if (typeof err === 'string' && err.length > 0) await writeFile(join(dir, `${id}.err`), err, 'utf8');
  } catch { /* 落盘失败不影响节点结果 */ }
}

async function runPython(p: PythonParams, signal?: AbortSignal, runDir?: string, nodeId?: string): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // ★ codePath（文件引用）优先于内联 code——明确引用了文件就以文件为准（内联 code 是
  //   另一录入途径的残留，不应悄悄压过文件引用；2026-10-02 语义定档）
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), 'utf8') : (p.code ?? '');
  if (!code) return { ...makeResult('failed', { error: { code: 'PYTHON_NO_CODE', message: 'code/codePath 为空——填写要执行的 Python 代码' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };

  // R3: 优先用插件内置/下载的 python；★ 2026-10-11 用户要求：读不到就**自动下载**（下载后立即验兼容性）
  let exe = '';
  try {
    const r = resolvePython();
    exe = r.exe;
    if (!exe) exe = (await ensureTool('python', { log: (m) => console.info(m) })).exe;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ...makeResult('failed', { error: { code: err.code ?? 'PYTHON_UNAVAILABLE', message: `Python 运行时不可用：${err.message ?? String(e)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (!exe) {
    return { ...makeResult('failed', { error: { code: 'PYTHON_UNAVAILABLE', message: 'Python 运行时未找到，且自动下载失败' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 30_000;
  const workDir = await scriptCwd(p, runDir);   // ★ 本次运行的临时目录优先（见 scriptCwd 注释）

  return new Promise<NodeResult>((resolve) => {
    let settled = false;
    let out = ''; let err = '';
    const settle = (r: NodeResult) => {
      if (!settled) {
        settled = true;
        // 等落盘完成再 resolve：调用方（含测试）拿到结果时 <runDir>/nodes/<id>.out 一定已就绪；
        // dumpNodeOutput 内部吞异常，finally 保证一定 resolve，绝不让落盘拖垮节点。
        void dumpNodeOutput(runDir, nodeId, out, err).finally(() => resolve(r));
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(exe, ['-c', code], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // ★ 强制 Python 以 UTF-8 写 stdout/stderr——中文 Windows 下管道默认用系统代码页（GBK），
        //   Node 按 UTF-8 解码会得到乱码（2026-10-02 用户实测「你好」变乱码）
        env: withRunDir({ ...scriptEnv(exe), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, runDir),
      });
    } catch (e) {
      settle({ ...makeResult('failed', { error: { code: 'PYTHON_SPAWN', message: `${exe}: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
      return;
    }
    child.stdout!.on('data', (b) => { out += b.toString(); });
    child.stderr!.on('data', (b) => { err += b.toString(); });
    const t = setTimeout(() => { child.kill('SIGKILL'); settle({ ...makeResult('failed', { error: { code: 'PYTHON_TIMEOUT', message: `执行超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() }); }, timeoutMs);
    // ★ 2026-10-08 用户拍板修「点取消没用」：python 节点此前**完全不接 ctx.signal** ✗ →
    //   取消要等脚本自己跑完（或撞 300s 超时）✗。现在 abort 即 SIGKILL 子进程并立刻以
    //   RUN_CANCELLED 收尾（与 subagent/http 等节点同码，取消永不算容错）。
    const onAbort = (): void => {
      clearTimeout(t);
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      settle({ ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      settle({ ...makeResult('failed', { error: { code: 'PYTHON_SPAWN', message: e.message } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) settle(finish(t0, startedAt, { out: out.replace(/\n$/, '') }));
      else settle({ ...makeResult('failed', { error: { code: 'PYTHON_EXIT', message: `退出码 ${code}（非零）: ${err.trim() || out.trim()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    });
  });
}

interface PythonParams { code?: string; codePath?: string; timeoutMs?: number; cwd?: string; requirements?: string[]; packages?: string[] }

/** 旧版：直接调 python3。已废弃，保留注释以便 diff。
function pickPython(interpreter: PythonParams['interpreter']): string {
  if (interpreter) return interpreter;
  return process.platform === 'win32' ? 'py' : 'python3';
} */

const pythonDef: NodeDefinition<PythonParams> = {
  type: 'python',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string' },
      codePath: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
      cwd: { type: 'string', description: '脚本执行目录；留空 = <DSH_HOME>/.dag-flow（dag-flow 数据根），脚本的相对路径产物落在那里；填了完全以它为准' },
      requirements: { type: 'array', items: { type: 'string' } },
      packages: { type: 'array', items: { type: 'string' } },
    },
    anyOf: [{ required: ['code'] }, { required: ['codePath'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runPython(p, ctx.signal, ctx.runDir, ctx.currentNodeId)),
  describe: () => ({ label: 'Python', category: 'script' }),
};

// ---------- bash ----------
interface BashParams { code?: string; codePath?: string; timeoutMs?: number; cwd?: string; dangerouslyAllowDestructive?: boolean }

const DESTRUCTIVE = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+)/;

async function runBash(p: BashParams, signal?: AbortSignal, runDir?: string, nodeId?: string): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // ★ codePath 优先于内联 code（与 python 同语义，2026-10-02 定档）
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), 'utf8') : (p.code ?? '');
  if (!code) return { ...makeResult('failed', { error: { code: 'BASH_NO_CODE', message: 'code/codePath 为空——填写要执行的 Bash 脚本' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (DESTRUCTIVE.test(code) && !p.dangerouslyAllowDestructive) {
    return { ...makeResult('failed', { error: { code: 'BASH_DESTRUCTIVE', message: '检测到高危命令——如确认要执行，请在节点参数中设置 dangerouslyAllowDestructive: true' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  // R3: 优先用插件内置/下载的 bash；★ 2026-10-11 用户要求：读不到就**自动下载**
  let exe = '';
  try {
    const r = resolveBash();
    exe = r.exe;
    if (!exe) exe = (await ensureTool('bash', { log: (m) => console.info(m) })).exe;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ...makeResult('failed', { error: { code: err.code ?? 'BASH_UNAVAILABLE', message: `bash 运行时不可用：${err.message ?? String(e)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (!exe) {
    return { ...makeResult('failed', { error: { code: 'BASH_UNAVAILABLE', message: 'bash 运行时未找到，且自动下载失败' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 30_000;
  const workDir = await scriptCwd(p, runDir);   // ★ 本次运行的临时目录优先（见 scriptCwd 注释）
  return new Promise<NodeResult>((resolve) => {
    let settled = false;
    let out = ''; let err = '';
    const settle = (r: NodeResult) => {
      if (!settled) {
        settled = true;
        // 等落盘完成再 resolve：调用方（含测试）拿到结果时 <runDir>/nodes/<id>.out 一定已就绪；
        // dumpNodeOutput 内部吞异常，finally 保证一定 resolve，绝不让落盘拖垮节点。
        void dumpNodeOutput(runDir, nodeId, out, err).finally(() => resolve(r));
      }
    };
    let child: ChildProcess;
    try {
      child = spawn(exe, ['-c', code], { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: withRunDir(scriptEnv(exe), runDir) });
    } catch (e) {
      settle({ ...makeResult('failed', { error: { code: 'BASH_SPAWN', message: `${exe}: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
      return;
    }
    child.stdout!.on('data', (b) => { out += b.toString(); });
    child.stderr!.on('data', (b) => { err += b.toString(); });
    const t = setTimeout(() => { child.kill('SIGKILL'); settle({ ...makeResult('failed', { error: { code: 'BASH_TIMEOUT', message: `执行超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() }); }, timeoutMs);
    // ★ 2026-10-08 与 python 同款：bash 也接 ctx.signal，取消即 kill 子进程 + RUN_CANCELLED
    const onAbort = (): void => {
      clearTimeout(t);
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      settle({ ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      const msg = (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'bash not found on PATH (Windows: install Git Bash / WSL; macOS/Linux: install bash)'
        : e.message;
      settle({ ...makeResult('failed', { error: { code: 'BASH_SPAWN', message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) settle(finish(t0, startedAt, { out: out.replace(/\n$/, '') }));
      else settle({ ...makeResult('failed', { error: { code: 'BASH_EXIT', message: `退出码 ${code}（非零）: ${err.trim() || out.trim()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
    });
  });
}

const bashDef: NodeDefinition<BashParams> = {
  type: 'bash',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string' }, codePath: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
      cwd: { type: 'string', description: '脚本执行目录；留空 = <DSH_HOME>/.dag-flow（dag-flow 数据根），脚本的相对路径产物落在那里；填了完全以它为准' },
      dangerouslyAllowDestructive: { type: 'boolean' },
    },
    anyOf: [{ required: ['code'] }, { required: ['codePath'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runBash(p, ctx.signal, ctx.runDir, ctx.currentNodeId)),
  describe: () => ({ label: 'Bash', category: 'script' }),
};

export { pythonDef, bashDef };
