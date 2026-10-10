// @ts-nocheck
// src/registry/builtin.ts — 20 个内置节点
// ★ 所有节点 run 必须返回 NodeResult，不得抛非受控异常（用 safeNodeRun 包）

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import type { Context, NodeDefinition, NodeResult, JsonValue } from '../types.js';
import {
  WorkflowNodeRegistry,
  ctxToScope,
  makeResult,
  safeNodeRun,
} from './external.js';
import { evaluateBool, evaluateExpr } from './expr.js';
import { runSubagentNode } from '../adapter/subagent.js';
import { resolvePython, resolveBash, detectPlatform } from '../adapter/runtime.js';
import { readSessionContent } from '../adapter/sessions.js';
import { saveAsset, downloadAsset } from '../adapter/assets.js';
import { runWebSearch, runWebFetch } from '../adapter/search.js';
import { humanizeFetchError } from '../adapter/fetch-errors.js';
import { waitForManual } from '../executor/awaiting.js';
import { resolveParams } from '../executor/dataflow.js';

// ---------- helpers ----------
function startedEnded(): { startedAt: string; t0: number } {
  return { startedAt: new Date().toISOString(), t0: Date.now() };
}

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
  return env;
}

/** codePath 解析（2026-10-02 用户需求「写格式化的代码文件，引入执行」）：
 *  相对路径锚定 <DSH_HOME>/.dag-flow/（如 'scripts/hello.py'）；绝对路径原样使用。
 *  此前直接 readFile(p.codePath) 是相对 host 进程 cwd 的——真机上根本找不到用户以为的文件。 */
async function resolveCodePath(p: string): Promise<string> {
  if (isAbsolute(p)) return p;
  const { dagFlowDir } = await import('../adapter/workspace.js');
  return join(await dagFlowDir(), p);
}
function finish(t0: number, startedAt: string, r: Partial<NodeResult>): NodeResult {
  return { ...makeResult('success', r), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
}

// ---------- 1. start ----------
const startDef: NodeDefinition = {
  type: 'start',
  schema: { type: 'object', additionalProperties: false, properties: {} },
  run: async (_ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    return finish(t0, startedAt, { out: (params as unknown as JsonValue | null) ?? null });
  },
  describe: () => ({ label: '开始', category: 'control' }),
};

// ---------- 2. end ----------
const endDef: NodeDefinition = {
  type: 'end',
  schema: { type: 'object', additionalProperties: false, properties: { outputs: { type: 'object' } } },
  run: async (ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    const outputs = (params?.['outputs'] as Record<string, JsonValue> | undefined) ?? {};
    return finish(t0, startedAt, { out: { ...ctx.vars, ...(outputs as Record<string, JsonValue>) } });
  },
  describe: () => ({ label: '结束', category: 'control' }),
};

// ---------- 3. python ----------
interface PythonParams { code?: string; codePath?: string; timeoutMs?: number; cwd?: string; requirements?: string[]; packages?: string[] }

/** 旧版：直接调 python3。已废弃，保留注释以便 diff。
function pickPython(interpreter: PythonParams['interpreter']): string {
  if (interpreter) return interpreter;
  return process.platform === 'win32' ? 'py' : 'python3';
} */

async function runPython(p: PythonParams, signal?: AbortSignal): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // ★ codePath（文件引用）优先于内联 code——明确引用了文件就以文件为准（内联 code 是
  //   另一录入途径的残留，不应悄悄压过文件引用；2026-10-02 语义定档）
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), 'utf8') : (p.code ?? '');
  if (!code) return { ...makeResult('failed', { error: { code: 'PYTHON_NO_CODE', message: 'code/codePath 为空——填写要执行的 Python 代码' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };

  // R3: 优先用插件内置/下载的 python；都不可用才报错（不再回退系统）
  const { exe, source } = resolvePython();
  if (!exe) {
    return { ...makeResult('failed', { error: { code: 'PYTHON_UNAVAILABLE', message: `Python 运行时未找到。执行：node scripts/download-runtime.mjs --platform=${detectPlatform()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 30_000;

  return new Promise<NodeResult>((resolve) => {
    let settled = false;
    const settle = (r: NodeResult) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(exe, ['-c', code], {
        cwd: p.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // ★ 强制 Python 以 UTF-8 写 stdout/stderr——中文 Windows 下管道默认用系统代码页（GBK），
        //   Node 按 UTF-8 解码会得到乱码（2026-10-02 用户实测「你好」变乱码）
        env: { ...scriptEnv(exe), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (e) {
      settle({ ...makeResult('failed', { error: { code: 'PYTHON_SPAWN', message: `${exe}: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
      return;
    }
    let out = ''; let err = '';
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

const pythonDef: NodeDefinition<PythonParams> = {
  type: 'python',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string' },
      codePath: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
      cwd: { type: 'string' },
      requirements: { type: 'array', items: { type: 'string' } },
      packages: { type: 'array', items: { type: 'string' } },
    },
    anyOf: [{ required: ['code'] }, { required: ['codePath'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runPython(p, ctx.signal)),
  describe: () => ({ label: 'Python', category: 'script' }),
};

// ---------- 4. bash ----------
interface BashParams { code?: string; codePath?: string; timeoutMs?: number; cwd?: string; dangerouslyAllowDestructive?: boolean }

const DESTRUCTIVE = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+)/;

async function runBash(p: BashParams, signal?: AbortSignal): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // ★ codePath 优先于内联 code（与 python 同语义，2026-10-02 定档）
  const code = p.codePath ? await readFile(await resolveCodePath(p.codePath), 'utf8') : (p.code ?? '');
  if (!code) return { ...makeResult('failed', { error: { code: 'BASH_NO_CODE', message: 'code/codePath 为空——填写要执行的 Bash 脚本' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (DESTRUCTIVE.test(code) && !p.dangerouslyAllowDestructive) {
    return { ...makeResult('failed', { error: { code: 'BASH_DESTRUCTIVE', message: '检测到高危命令——如确认要执行，请在节点参数中设置 dangerouslyAllowDestructive: true' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  // R3: 优先用插件内置/下载的 bash；都不可用才报错（Windows 不再 fallback 系统 bash）
  const { exe, source } = resolveBash();
  if (!exe) {
    return { ...makeResult('failed', { error: { code: 'BASH_UNAVAILABLE', message: `bash 运行时未找到。执行：node scripts/download-runtime.mjs --platform=${detectPlatform()}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const timeoutMs = p.timeoutMs ?? 30_000;
  return new Promise<NodeResult>((resolve) => {
    let settled = false;
    const settle = (r: NodeResult) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(exe, ['-c', code], { cwd: p.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: scriptEnv(exe) });
    } catch (e) {
      settle({ ...makeResult('failed', { error: { code: 'BASH_SPAWN', message: `${exe}: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });
      return;
    }
    let out = ''; let err = '';
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
      cwd: { type: 'string' },
      dangerouslyAllowDestructive: { type: 'boolean' },
    },
    anyOf: [{ required: ['code'] }, { required: ['codePath'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runBash(p, ctx.signal)),
  describe: () => ({ label: 'Bash', category: 'script' }),
};

// ---------- 5. subagent ----------
interface SubagentParams { prompt: string; model?: string; isolated?: boolean; agentPreset?: string; timeoutMs?: number; system?: string }
const subagentDef: NodeDefinition<SubagentParams> = {
  type: 'subagent',
  schema: {
    type: 'object',
    required: ['prompt', 'model'],
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1 },
      model: { type: 'string', description: '必填：dsh 已配置的模型 id（如 dsh:glm-5.3-flash），缺模型节点不执行' },
      isolated: { type: 'boolean' },
      agentPreset: { type: 'string' },
      system: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
    },
  },
  run: async (_ctx, p) => safeNodeRun(async () => {
    // 模型必选：未选执行模型 → 不调 LLM，明确失败（上层 UI 已拦截，此处为执行层兜底）
    if (!String(p.model ?? '').trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult('failed', { error: { code: 'MODEL_REQUIRED', message: '未选择执行模型——在节点配置的「选择模型」中选择 dsh 已配置的模型后重试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    // 留空不执行：prompt 为空（未填或上游引用解析为空）→ 节点失败并中断流程（默认 stop 语义），
    // 避免拿着空提示词浪费一次 LLM 调用、生成无意义内容
    if (!String(p.prompt ?? '').trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult('failed', { error: { code: 'SUBAGENT_EMPTY_PROMPT', message: 'prompt 为空——AI 节点未执行，流程已在此中断。检查上游输出是否为空，或填入提示词后重试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return runSubagentNode(p);
  }),
  describe: () => ({ label: 'AI 子代理', category: 'ai' }),
};

// ---------- 5b. session_input（会话输入） ----------
interface SessionInputParams { sessionId: string; limit?: number; workspace?: string }
async function runSessionInput(p: SessionInputParams): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!p.sessionId) {
    return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_NO_ID', message: 'sessionId 为空——请选择要读取的会话' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const limit = Math.max(1, Math.min(500, p.limit ?? 10));
  try {
    const content = await readSessionContent(p.sessionId, limit, p.workspace);
    if (content === null) {
      return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_NOT_FOUND', message: `会话不存在: ${p.sessionId}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return finish(t0, startedAt, { out: content });
  } catch (e) {
    return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_READ', message: `读取会话失败: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}

const sessionInputDef: NodeDefinition<SessionInputParams> = {
  type: 'session_input',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionId: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      workspace: { type: 'string' },
    },
  },
  run: async (_ctx, p) => safeNodeRun(() => runSessionInput(p)),
  describe: () => ({ label: '会话输入', category: 'ai' }),
};

// ---------- 6. http ----------
interface HttpParams { method?: string; url: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
async function runHttp(p: HttpParams): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const timeoutMs = p.timeoutMs ?? 30_000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(p.url, {
      method: p.method ?? 'GET',
      headers: p.headers,
      body: p.body,
      signal: ac.signal,
    });
    const text = await r.text();
    let body: JsonValue = text;
    try { body = JSON.parse(text) as JsonValue; } catch { /* keep text */ }
    return finish(t0, startedAt, { out: { status: r.status, body } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ...makeResult('failed', { error: { code: 'HTTP_TIMEOUT', message: `请求超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'HTTP_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}
const httpDef: NodeDefinition<HttpParams> = {
  type: 'http',
  schema: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: {
      method: { enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      url: { type: 'string', minLength: 1 },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      body: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
    },
  },
  run: async (_ctx, p) => safeNodeRun(() => runHttp(p)),
  describe: () => ({ label: 'HTTP', category: 'io' }),
};

// ---------- 7. set_var ----------
interface SetVarParams { vars: Record<string, JsonValue> }
const setVarDef: NodeDefinition<SetVarParams> = {
  type: 'set_var',
  schema: {
    type: 'object', required: ['vars'], additionalProperties: false,
    properties: { vars: { type: 'object', additionalProperties: true } },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    Object.assign(ctx.vars, p.vars);
    return finish(t0, startedAt, { out: { ...p.vars } });
  },
  describe: () => ({ label: '设置变量', category: 'data' }),
};

// ---------- 8. if ----------
interface IfParams { condition: string }
const ifDef: NodeDefinition<IfParams> = {
  type: 'if',
  schema: { type: 'object', required: ['condition'], additionalProperties: false, properties: { condition: { type: 'string', minLength: 1 } } },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const v = evaluateBool(p.condition, ctxToScope(ctx));
    return finish(t0, startedAt, { out: v });
  },
  describe: () => ({ label: '条件分支', category: 'control' }),
};

// ---------- 9. switch ----------
interface SwitchParams { value: string; cases: Record<string, string> }
const switchDef: NodeDefinition<SwitchParams> = {
  type: 'switch',
  schema: {
    type: 'object', required: ['value', 'cases'], additionalProperties: false,
    properties: {
      value: { type: 'string', minLength: 1 },
      cases: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    // ★ value 兼容两种写法（2026-10-02 用户反馈「无法按条件分支」）：表达式（'"b"'、'{{x}}'）
    //   与裸字面量（'A' 直接当值匹配）。此前裸字面量经 evaluateExpr 求值为 undefined →
    //   matched='' → 所有分支都不激活且无报错。现：求值失败/undefined → 回退原始字符串字面量。
    let v: unknown;
    try {
      v = evaluateExpr(p.value, ctxToScope(ctx));
    } catch { v = undefined; }
    const matched = v === undefined || v === null ? String(p.value ?? '') : String(v);
    const target = p.cases[matched] ?? p.cases['*'] ?? null;
    return finish(t0, startedAt, { out: { matched, target } });
  },
  describe: () => ({ label: '多路分支', category: 'control' }),
};

// ---------- 10. loop ----------
/** 循环体规格（2026-10-03 用户拍板方案 A：子工作流当循环体） */
interface LoopBodySpec { workflowName?: string; inputs?: Record<string, JsonValue> }
interface LoopParams {
  count?: number; while?: string; over?: JsonValue[]; maxIterations?: number;
  dangerouslyAllowInfinite?: boolean; dangerouslyAllowDestructive?: boolean;
  body?: LoopBodySpec;
  /** 某轮循环体失败时的策略：stop（默认，整节点失败但保留已完成轮次）/ continue（该轮写占位继续跑） */
  onIterationError?: 'stop' | 'continue';
}
// 防无限嵌套：loop 节点内部不再"递归调用自身 run"（旧实现 def.run 会无限递归爆炸）。
// ★ 2026-10-03：支持 body=子工作流当循环体——只扩本节点 run、复用 subflow 的调用机制，
//   不动 topoSort/DAG、不需要画布回边。每轮结果依次进 out.items，下游写法与无 body 时完全一致。
async function runLoop(p: LoopParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const maxIter = Math.min(p.maxIterations ?? 1_000, 100_000);
  const iterations: unknown[] = [];

  if (Array.isArray(p.over)) {
    // 数组迭代（A6-lite）：over 经 {{u.out.items}} 引用上游数组，逐项收集
    const n = Math.min(p.over.length, maxIter);
    for (let i = 0; i < n; i++) iterations.push(p.over[i]);
  } else if (typeof p.count === 'number') {
    const n = Math.max(0, Math.min(Math.floor(p.count), maxIter));
    for (let i = 0; i < n; i++) iterations.push(i);
  } else if (typeof p.while === 'string') {
    let i = 0;
    while (i < maxIter) {
      const keepGoing = evaluateBool(p.while, ctxToScope(ctx));
      if (!keepGoing) break;
      iterations.push(i);
      i++;
      if (i >= maxIter && !p.dangerouslyAllowInfinite) {
        return { ...makeResult('failed', { error: { code: 'LOOP_MAX_ITER', message: `达到最大迭代次数 ${maxIter}——如确认要继续，设置 dangerouslyAllowInfinite: true` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      }
    }
  } else {
    return { ...makeResult('failed', { error: { code: 'LOOP_NO_BOUND', message: '缺少循环边界——count / while / over 至少配置一个' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }

  const body = p.body;
  // 无循环体：保持原语义——只产出迭代序列 {count, items}
  if (!body?.workflowName) return finish(t0, startedAt, { out: { count: iterations.length, items: iterations } });

  // —— 循环体：逐轮调用子工作流（方案 A）——
  const depth = (ctx as Context & { _depth?: number })._depth ?? 0;
  if (depth >= MAX_SUBFLOW_DEPTH) {
    return { ...makeResult('failed', { error: { code: 'SUBFLOW_DEPTH', message: `子工作流嵌套超过 ${MAX_SUBFLOW_DEPTH} 层上限` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const { createStorage } = await import('../adapter/storage.js');
  const { createLogger } = await import('../adapter/logger.js');
  const { runWorkflow } = await import('../executor/run.js');
  const sub = await createStorage().readWorkflow(String(body.workflowName));
  if (!sub) {
    return { ...makeResult('failed', { error: { code: 'WORKFLOW_NOT_FOUND', message: `循环体子工作流不存在: ${body.workflowName}（先在工作流面板保存，或检查名称）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const myId = String((ctx as Context & { currentNodeId?: string }).currentNodeId ?? 'loop');
  const outputs: JsonValue[] = [];
  for (let i = 0; i < iterations.length; i++) {
    if (ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    // 当轮上下文：注入 {{vars.loopItem}} / {{vars.loopIndex}}，供 body.inputs 引用（也可引用上游 {{节点id.out.x}}）
    const iterCtx = { ...ctx, vars: { ...(ctx.vars ?? {}), loopItem: iterations[i] as JsonValue, loopIndex: i } } as Context;
    let inputs: Record<string, JsonValue>;
    try {
      inputs = resolveParams((body.inputs ?? {}) as Record<string, JsonValue>, iterCtx, myId);
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'DATAFLOW_REF', message: `循环体第 ${i + 1} 轮输入解析失败: ${(e as Error).message}` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    const { summary } = await runWorkflow(sub, { logger: createLogger(), cwd: process.cwd(), inputs, _depth: depth + 1, signal: ctx.signal });
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = (endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null) as JsonValue;
    if (summary.status !== 'success' && p.onIterationError !== 'continue') {
      // 默认 stop：整节点失败，但把已完成轮次留在 out.items 里便于排查
      return { ...makeResult('failed', { error: { code: 'LOOP_BODY_FAILED', message: `第 ${i + 1}/${iterations.length} 轮循环体「${sub.name}」以 ${summary.status} 结束——已完成 ${outputs.length} 轮，结果保留在 out.items 里（要跳过失败轮请设 onIterationError: "continue"）` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    outputs.push(summary.status === 'success'
      ? endOut
      : ({ error: { code: 'SUBFLOW_FAILED', message: `第 ${i + 1} 轮失败` }, output: endOut } as JsonValue));
  }
  return finish(t0, startedAt, { out: { count: outputs.length, items: outputs } });
}
const loopDef: NodeDefinition<LoopParams> = {
  type: 'loop',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      count: { type: 'integer', minimum: 0 },
      while: { type: 'string' },
      over: { type: 'array' },
      maxIterations: { type: 'integer', minimum: 1, maximum: 100_000 },
      dangerouslyAllowInfinite: { type: 'boolean' },
      // ★ 循环体（方案 A）：每轮调用该子工作流；inputs 里用 {{vars.loopItem}} / {{vars.loopIndex}}
      body: {
        type: 'object', additionalProperties: false,
        properties: { workflowName: { type: 'string', minLength: 1 }, inputs: { type: 'object', additionalProperties: true } },
        required: ['workflowName'],
      },
      onIterationError: { enum: ['stop', 'continue'] },
    },
    anyOf: [{ required: ['count'] }, { required: ['while'] }, { required: ['over'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runLoop(p as never, ctx)),
  describe: () => ({ label: '循环', category: 'control' }),
};

// ---------- 11. log ----------
interface LogParams { level?: 'info' | 'warn' | 'error'; message: string }
const logDef: NodeDefinition<LogParams> = {
  type: 'log',
  schema: {
    type: 'object', required: ['message'], additionalProperties: false,
    properties: { level: { enum: ['info', 'warn', 'error'] }, message: { type: 'string' } },
  },
  run: async (_ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const line = `[workflow] ${p.message}`;
    if (p.level === 'error') console.error(line);
    else if (p.level === 'warn') console.warn(line);
    else console.info(line);
    return finish(t0, startedAt, { out: p.message });
  },
  describe: () => ({ label: '日志', category: 'misc' }),
};

// ---------- 12. manual ----------
interface ManualParams { prompt: string; schema?: object }
const manualDef: NodeDefinition<ManualParams> = {
  type: 'manual',
  schema: {
    type: 'object', required: ['prompt'], additionalProperties: false,
    properties: { prompt: { type: 'string' }, schema: { type: 'object' } },
  },
  // 人工确认（2026-10-03 用户拍板「真暂停 + 恢复」）：
  //   交互式运行（HTTP /run）→ 登记挂起并等 POST /run/resume；确认后 out.value = 用户备注。
  //   非交互路径（CLI /workflow 工具、subflow 子工作流内部）→ 无人可点，自动通过 + warning 留痕
  //   （旧实现是 v0.1 空壳：任何场景都立即返回 success，用户反馈「人工确认节点没作用」）。
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const prompt = String(p.prompt ?? '');
    const nodeId = (ctx as Context & { currentNodeId?: string }).currentNodeId ?? '';
    const confirmedAt = new Date().toISOString();
    if (!ctx.interactive || !ctx.runId) {
      ctx.logger?.warn('manual 节点在非交互环境自动通过（无人可确认）', { nodeId, prompt: prompt.slice(0, 120) });
      return finish(t0, startedAt, { out: { prompt, confirmed: true, autoPassed: true, value: '', confirmedAt } });
    }
    ctx.onAwaiting?.({ runId: ctx.runId, nodeId, prompt });
    try {
      const r = await waitForManual({ runId: ctx.runId, nodeId, prompt, createdAt: confirmedAt }, ctx.signal);
      return finish(t0, startedAt, {
        out: { prompt, confirmed: true, value: r.value, confirmedAt: new Date().toISOString() },
      });
    } catch (e) {
      // 用户点「取消本次运行」→ 挂起被 reject（不抛异常，转显式失败结果）
      return {
        ...makeResult('failed', { error: { code: 'MANUAL_CANCELLED', message: `人工确认未完成：${(e as Error).message}` } }),
        durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString(),
      };
    }
  },
  describe: () => ({ label: '手动确认', category: 'control' }),
};

// ---------- 13. merge（#A5：并行分支合流） ----------
const mergeDef: NodeDefinition = {
  type: 'merge',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      keys: { type: 'array', items: { type: 'string' }, description: '可选：输出键名列表（按上游顺序）；缺省用上游节点 id' },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const my = (ctx as Context & { currentNodeId?: string }).currentNodeId ?? '';
    const upstreams = (ctx as Context & { upstreams?: Record<string, string[]> }).upstreams?.[my] ?? [];
    if (upstreams.length < 2) {
      return { ...makeResult('failed', { error: { code: 'MERGE_NO_UPSTREAM', message: `merge 需要至少 2 条上游连线（当前 ${upstreams.length} 条）——把多个分支的输出连入 merge 节点` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const out: Record<string, JsonValue> = {};
    upstreams.forEach((uid, i) => {
      const key = (p as { keys?: string[] })?.keys?.[i] ?? uid;
      out[key] = ctx.results[uid]?.out ?? null;
    });
    return finish(t0, startedAt, { out });
  },
  describe: () => ({ label: '合流', category: 'control' }),
};

// ---------- 14. subflow（#A7：子工作流调用） ----------
const MAX_SUBFLOW_DEPTH = 5;
const subflowDef: NodeDefinition = {
  type: 'subflow',
  schema: {
    type: 'object', required: ['workflowName'], additionalProperties: false,
    properties: {
      workflowName: { type: 'string', minLength: 1 },
      inputs: { type: 'object', additionalProperties: true },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const q = p as { workflowName?: string; inputs?: Record<string, JsonValue> };
    const depth = (ctx as Context & { _depth?: number })._depth ?? 0;
    if (depth >= MAX_SUBFLOW_DEPTH) {
      return { ...makeResult('failed', { error: { code: 'SUBFLOW_DEPTH', message: `子工作流嵌套超过 ${MAX_SUBFLOW_DEPTH} 层上限` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    if (ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const { createStorage } = await import('../adapter/storage.js');
    const { createLogger } = await import('../adapter/logger.js');
    const { runWorkflow } = await import('../executor/run.js');
    const sub = await createStorage().readWorkflow(String(q.workflowName ?? ''));
    if (!sub) {
      return { ...makeResult('failed', { error: { code: 'WORKFLOW_NOT_FOUND', message: `子工作流不存在: ${q.workflowName}（先在工作流面板保存，或检查名称）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const { summary } = await runWorkflow(sub, {
      logger: createLogger(),
      cwd: process.cwd(),
      inputs: (q.inputs ?? {}) as Record<string, JsonValue>,
      _depth: depth + 1,
      signal: ctx.signal,
    });
    // 收集子流程 end 节点输出作为本节点输出
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null;
    return finish(t0, startedAt, {
      out: { workflow: sub.name, status: summary.status, totalDurationMs: summary.totalDurationMs, output: endOut, failedCount: summary.failedCount },
      ...(summary.status !== 'success' ? { error: { code: 'SUBFLOW_FAILED', message: `子工作流 "${sub.name}" 以 ${summary.status} 状态结束` } } : {}),
    } as Partial<NodeResult>);
  },
  describe: () => ({ label: '子工作流', category: 'control' }),
};

// ---------- 15. image_generate（#多模态：图片生成，OpenAI images 兼容） ----------
interface ImageGenParams {
  prompt: string; baseURL: string; model?: string; apiKey?: string; apiKeyEnv?: string;
  size?: string; n?: number; filenamePrefix?: string; timeoutMs?: number;
}
/** 从 JsonValue 按点路径取值（'output.task_id'） */
function getPath(v: unknown, dotPath: string): unknown {
  let cur: unknown = v;
  for (const k of dotPath.split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
async function runImageGen(p: ImageGenParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!p.prompt?.trim()) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_PROMPT', message: 'prompt 为空——填入画面描述后再试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (!p.baseURL?.trim()) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_BASEURL', message: 'baseURL 为空——填图片 API 地址（如 https://dashscope.aliyuncs.com/compatible-mode/v1）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || '' : '');
  if (!apiKey) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_KEY', message: '缺少 API Key——填 apiKey，或填 apiKeyEnv 引用环境变量' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const ac = new AbortController();
  const timeoutMs = p.timeoutMs ?? 120_000;
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `${p.baseURL.replace(/\/+$/, '')}/images/generations`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: p.model ?? 'wanx-v1', prompt: p.prompt, size: p.size ?? '1024*1024', n: Math.min(p.n ?? 1, 4) }),
      signal: ac.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return { ...makeResult('failed', { error: { code: 'IMAGE_API_ERROR', message: `图片 API 错误（HTTP ${resp.status}）: ${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const data = JSON.parse(text) as { data?: { url?: string; b64_json?: string }[] };
    const items = data.data ?? [];
    if (items.length === 0) return { ...makeResult('failed', { error: { code: 'IMAGE_EMPTY', message: `API 未返回图片：${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const images: { url?: string; path: string; bytes: number }[] = [];
    const prefix = p.filenamePrefix ?? 'image';
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const fname = `${prefix}-${Date.now()}-${i}.png`;
      if (it.url) {
        const saved = await downloadAsset(it.url, fname);
        images.push({ url: it.url, path: saved.relativePath, bytes: saved.bytes });
      } else if (it.b64_json) {
        const saved = await saveAsset(fname, it.b64_json, 'base64');
        images.push({ path: saved.relativePath, bytes: saved.bytes });
      }
    }
    if (images.length === 0) return { ...makeResult('failed', { error: { code: 'IMAGE_SAVE_FAILED', message: 'API 返回的图片既无 url 也无 b64_json' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    void ctx;
    return finish(t0, startedAt, { out: { images, count: images.length } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ...makeResult('failed', { error: { code: 'IMAGE_TIMEOUT', message: `图片生成超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    return { ...makeResult('failed', { error: { code: 'IMAGE_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}
const imageGenDef: NodeDefinition<ImageGenParams> = {
  type: 'image_generate',
  schema: {
    type: 'object', required: ['prompt', 'baseURL'], additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1 },
      baseURL: { type: 'string', minLength: 1 },
      model: { type: 'string' },
      apiKey: { type: 'string' }, apiKeyEnv: { type: 'string' },
      size: { type: 'string' }, n: { type: 'integer', minimum: 1, maximum: 4 },
      filenamePrefix: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000 },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runImageGen(p as never, ctx)),
  describe: () => ({ label: '图片生成', category: 'media' }),
};

// ---------- 16. video_generate（#多模态：视频生成，通用异步任务模式） ----------
interface VideoGenParams {
  submitUrl: string; submitMethod?: string; submitHeaders?: Record<string, string>; submitBody?: Record<string, JsonValue>;
  taskIdPath?: string; pollUrl: string; pollHeaders?: Record<string, string>;
  pollIntervalMs?: number; maxWaitMs?: number;
  statusPath?: string; doneValue?: string;
  videoUrlPath?: string; filename?: string; apiKey?: string; apiKeyEnv?: string;
}
async function runVideoGen(p: VideoGenParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || '' : '');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(p.submitHeaders ?? {}) };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (!p.submitUrl?.trim()) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_SUBMIT', message: 'submitUrl 为空——填视频 API 的任务提交地址' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (!p.pollUrl?.trim()) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_POLL', message: 'pollUrl 为空——填任务查询地址（可含 {taskId} 占位）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const interval = Math.max(p.pollIntervalMs ?? 5_000, 1_000);
  const maxWait = Math.max(p.maxWaitMs ?? 600_000, interval);
  const statusPath = p.statusPath ?? 'output.task_status';
  const doneValue = p.doneValue ?? 'succeeded';
  const videoUrlPath = p.videoUrlPath ?? 'output.video_url';
  try {
    // 1. 提交任务
    const sr = await fetch(p.submitUrl, {
      method: p.submitMethod ?? 'POST', headers,
      body: JSON.stringify(p.submitBody ?? {}),
    });
    const stext = await sr.text();
    if (!sr.ok) return { ...makeResult('failed', { error: { code: 'VIDEO_SUBMIT_ERROR', message: `任务提交失败（HTTP ${sr.status}）: ${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const sjson = JSON.parse(stext) as unknown;
    const taskId = String(getPath(sjson, p.taskIdPath ?? 'output.task_id') ?? '');
    if (!taskId) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_TASK', message: `提交响应中未找到任务 ID（taskIdPath 不对？）：${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    // 2. 轮询（节点内循环，画布外避免环）
    const pollHeaders: Record<string, string> = { ...(p.pollHeaders ?? {}) };
    if (apiKey && !pollHeaders.authorization) pollHeaders.authorization = `Bearer ${apiKey}`;
    const deadline = Date.now() + maxWait;
    let lastStatus = '';
    let videoUrl = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (ctx.signal?.aborted) return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '视频轮询期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      const pollUrl = p.pollUrl.includes('{taskId}') ? p.pollUrl.replace('{taskId}', encodeURIComponent(taskId)) : p.pollUrl;
      const pr = await fetch(pollUrl, { headers: pollHeaders });
      const pj = await pr.json().catch(() => ({})) as unknown;
      lastStatus = String(getPath(pj, statusPath) ?? '');
      const vu = getPath(pj, videoUrlPath);
      if (typeof vu === 'string' && vu) videoUrl = vu;
      if (videoUrl || (lastStatus && lastStatus !== 'running' && lastStatus !== 'pending' && lastStatus !== 'PENDING' && lastStatus !== 'RUNNING' && lastStatus !== doneValue)) break;
    }
    if (!videoUrl) {
      return { ...makeResult('failed', { error: { code: 'VIDEO_NOT_READY', message: `轮询 ${Math.round(maxWait / 1000)}s 后仍未完成（最后状态：${lastStatus || 'unknown'}）。增大 maxWaitMs 或检查任务状态` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    // 3. 下载视频到 .dag-flow/ 产出目录
    const saved = await downloadAsset(videoUrl, p.filename ?? `video-${Date.now()}.mp4`);
    return finish(t0, startedAt, {
      out: { taskId, videoUrl, path: saved.relativePath, bytes: saved.bytes, waitedMs: Date.now() - t0 },
    });
  } catch (e) {
    return { ...makeResult('failed', { error: { code: 'VIDEO_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
const videoGenDef: NodeDefinition<VideoGenParams> = {
  type: 'video_generate',
  schema: {
    type: 'object', required: ['submitUrl', 'pollUrl'], additionalProperties: false,
    properties: {
      submitUrl: { type: 'string', minLength: 1 },
      submitMethod: { type: 'string' },
      submitHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      submitBody: { type: 'object', additionalProperties: true },
      taskIdPath: { type: 'string' },
      pollUrl: { type: 'string', minLength: 1 },
      pollHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      pollIntervalMs: { type: 'integer', minimum: 1000 },
      maxWaitMs: { type: 'integer', minimum: 1000 },
      statusPath: { type: 'string' }, doneValue: { type: 'string' },
      videoUrlPath: { type: 'string' }, filename: { type: 'string' },
      apiKey: { type: 'string' }, apiKeyEnv: { type: 'string' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runVideoGen(p as never, ctx)),
  describe: () => ({ label: '视频生成', category: 'media' }),
};

// ---------- 17. file_save（#多模态：内容/URL 落盘为 .dag-flow/ 下的产出文件） ----------
interface FileSaveParams { source?: 'text' | 'base64' | 'url'; content?: string; url?: string; filename: string }
const fileSaveDef: NodeDefinition<FileSaveParams> = {
  type: 'file_save',
  schema: {
    type: 'object', required: ['filename'], additionalProperties: false,
    properties: {
      source: { enum: ['text', 'base64', 'url'] },
      content: { type: 'string' },
      url: { type: 'string' },
      filename: { type: 'string', minLength: 1 },
    },
  },
  run: async (_ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const source = p.source ?? (p.url ? 'url' : 'text');
    try {
      if (source === 'url') {
        if (!p.url?.trim()) return { ...makeResult('failed', { error: { code: 'FILE_NO_URL', message: 'url 为空——填要下载的文件地址（可引用上游 {{u.out.url}}）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
        const saved = await downloadAsset(p.url, p.filename);
        return finish(t0, startedAt, { out: { path: saved.relativePath, ...saved, source: 'url' } });
      }
      if (source === 'base64' && !p.content) return { ...makeResult('failed', { error: { code: 'FILE_NO_CONTENT', message: 'base64 内容为空' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      if (source === 'text' && !p.content?.trim()) return { ...makeResult('failed', { error: { code: 'FILE_NO_CONTENT', message: 'content 为空——填文件内容（可引用上游 {{u.out.xxx}}）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      const saved = await saveAsset(p.filename, p.content ?? '', source === 'base64' ? 'base64' : 'utf8');
      return finish(t0, startedAt, { out: { path: saved.relativePath, ...saved, source, preview: source === 'text' ? String(p.content).slice(0, 200) : undefined } });
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'FILE_SAVE_ERROR', message: `${(e as Error).message}（检查 filename 是否含非法字符）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
  },
  describe: () => ({ label: '文件保存', category: 'media' }),
};

// ---------- 18. web_search（#搜索节点：宿主优先 + 内置免 key 引擎兜底） ----------
interface WebSearchParams {
  query: string;
  provider?: 'auto' | 'host' | 'bing' | 'ddg' | 'ddg-lite' | 'searxng' | 'anysearch';
  count?: number;
  lang?: string;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  searxngInstances?: string[];
}
async function runWebSearchNode(p: WebSearchParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // 留空不执行：query 为空（未填或上游引用解析为空）→ 节点失败并中断流程，不发网络请求
  if (!String(p.query ?? '').trim()) {
    return { ...makeResult('failed', { error: { code: 'SEARCH_EMPTY_QUERY', message: 'query 为空——搜索节点未执行，流程已在此中断。填入搜索词或检查上游输出' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  try {
    const outcome = await runWebSearch(
      { query: p.query, provider: p.provider, count: p.count, lang: p.lang, timeRange: p.timeRange, searxngInstances: p.searxngInstances },
      ctx.signal,
    );
    return finish(t0, startedAt, {
      out: { query: p.query, engine: outcome.engine, viaHost: outcome.viaHost, count: outcome.results.length, results: outcome.results },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg === '运行已被取消' || ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '搜索期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'SEARCH_FAILED', message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
const webSearchDef: NodeDefinition<WebSearchParams> = {
  type: 'web_search',
  schema: {
    type: 'object', required: ['query'], additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1 },
      provider: { enum: ['auto', 'host', 'bing', 'ddg', 'ddg-lite', 'searxng', 'anysearch'] },
      count: { type: 'integer', minimum: 1, maximum: 20 },
      lang: { type: 'string' },
      timeRange: { enum: ['day', 'week', 'month', 'year'] },
      searxngInstances: { type: 'array', items: { type: 'string' } },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runWebSearchNode(p as never, ctx)),
  describe: () => ({ label: '网页搜索', category: 'io' }),
};

// ---------- 19. web_fetch（#抓取节点：URL → 正文文本 / JSON） ----------
interface WebFetchNodeParams { url: string; maxChars?: number; timeoutMs?: number; raw?: boolean }
async function runWebFetchNode(p: WebFetchNodeParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!String(p.url ?? '').trim()) {
    return { ...makeResult('failed', { error: { code: 'FETCH_NO_URL', message: 'url 为空——抓取节点未执行，流程已在此中断。填入网址或引用上游 {{u.out.url}}' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  try {
    const r = await runWebFetch({ url: p.url, maxChars: p.maxChars, timeoutMs: p.timeoutMs, raw: p.raw }, ctx.signal);
    return finish(t0, startedAt, {
      out: { url: r.url, status: r.status, contentType: r.contentType, mode: r.mode, chars: r.chars, ...(r.mode === 'json' ? { json: r.json as never } : { text: r.text }) },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg === '运行已被取消' || ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '抓取期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    if ((e as Error).name === 'FetchTimeout') {
      return { ...makeResult('failed', { error: { code: 'FETCH_TIMEOUT', message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'FETCH_FAILED', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
const webFetchDef: NodeDefinition<WebFetchNodeParams> = {
  type: 'web_fetch',
  schema: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: {
      url: { type: 'string', minLength: 1 },
      maxChars: { type: 'integer', minimum: 200, maximum: 200_000 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
      raw: { type: 'boolean' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runWebFetchNode(p as never, ctx)),
  describe: () => ({ label: '网页抓取', category: 'io' }),
};

// 注册
export function registerBuiltinNodes(): void {
  for (const d of [startDef, endDef, pythonDef, bashDef, subagentDef, sessionInputDef, httpDef, setVarDef, ifDef, switchDef, loopDef, logDef, manualDef, mergeDef, subflowDef, imageGenDef, videoGenDef, fileSaveDef, webSearchDef, webFetchDef]) {
    WorkflowNodeRegistry.register(d as never);
  }
}
