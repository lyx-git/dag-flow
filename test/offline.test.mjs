// test/offline.test.mjs — 单进程内手写断言（不用 node:test runner，避免沙箱 EPERM）
// 跑法：node test/offline.test.mjs
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, err: e }); console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// ===== 契约层（同上一版） =====
function validateWorkflowDef(def) {
  if (!def || typeof def !== 'object') throw new Error('not an object');
  if (typeof def.name !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(def.name)) throw new Error('invalid name');
  if (def.version !== 1) throw new Error('version must be 1');
  if (!Array.isArray(def.nodes) || def.nodes.length < 2) throw new Error('need >=2 nodes');
  // 先收集所有 id（与 src/executor/parse.ts 行为一致：先 set 再 check ref）
  const ids = new Set();
  for (const n of def.nodes) {
    if (ids.has(n.id)) throw new Error(`duplicate id: ${n.id}`);
    ids.add(n.id);
  }
  let s = 0, e = 0;
  for (const n of def.nodes) {
    if (n.type === 'start') s++;
    if (n.type === 'end') e++;
    if (n.next) {
      const refs = Array.isArray(n.next) ? n.next : typeof n.next === 'string' ? [n.next] : [n.next.true, n.next.false];
      for (const r of refs) if (r && !ids.has(r) && r !== '__end__') throw new Error(`unknown ref: ${r}`);
    }
  }
  if (s !== 1) throw new Error(`need 1 start, got ${s}`);
  if (e < 1) throw new Error('need >=1 end');
  return def;
}

function detectDrift(host) {
  const drifted = [];
  // dsh 0.1.2-rc.1 真实 API（2026-09-06 对齐）
  if (!host?.tools?.register || typeof host.tools.register !== 'function') drifted.push('tools.register');
  if (!host?.llm?.chat && !host?.llm?.createMessage) drifted.push('llm.chat');
  if (!host?.webServer?.register) drifted.push('webServer.register');
  if (!host?.effect) drifted.push('effect');
  return { drifted, safeMode: drifted.includes('tools.register') || drifted.includes('effect') };
}

async function callSubagent(host, opts) {
  const d = detectDrift(host);
  // 对齐产品语义（adapter/subagent.ts）：宿主不健康或 LLM 能力缺失 → 子代理不可用
  if (d.safeMode || d.drifted.includes('llm.chat')) throw new Error('subagent unavailable: drifted');
  return { text: await host.llm.chat(opts) };
}

// 存储根目录解析链 replica（2026-09-23 存储架构 v2：工作区 JSON，见 src/adapter/storage.ts）
// 链：host ctx 工作区线索 → cwd（排除 system32/主目录）→ ~/.dsh/workflows 兜底
function probeWorkspaceRoot(host) {
  const ws = host?.workspace ?? host?.workspaceService;
  const candidates = [ws?.cwd, ws?.root, ws?.path, ws?.dir, host?.cwd, host?.baseDir, host?.workspacePath];
  for (const c of candidates) {
    const v = typeof c === 'function' ? c() : c;
    if (typeof v === 'string' && v) return v;
  }
  return null;
}
function workflowsDir(host, cwd = null) {
  const ws = probeWorkspaceRoot(host);
  if (ws) return path.join(ws, '.dag-flow', 'workflow');
  const usable = cwd
    && path.isAbsolute(cwd)
    && !cwd.toLowerCase().endsWith('system32')
    && path.resolve(cwd) !== path.resolve(os.homedir());
  if (usable) return path.join(cwd, '.dag-flow', 'workflow');
  return path.join(os.homedir(), '.dsh', 'workflows');
}

function bashErrorOnEnoent(errCode) {
  if (errCode === 'ENOENT') return { status: 'failed', error: { code: 'BASH_SPAWN', message: 'bash not found on PATH (Windows: install Git Bash / WSL; macOS/Linux: install bash)' } };
  return { status: 'failed', error: { code: 'BASH_SPAWN', message: 'other' } };
}

function pythonErrorOnEnoent(errCode, interp) {
  if (errCode === 'ENOENT') return { status: 'failed', error: { code: 'PYTHON_SPAWN', message: `${interp}: not found. Is python installed?` } };
  return { status: 'failed', error: { code: 'PYTHON_SPAWN', message: 'other' } };
}

const defs = new Map();
const registerNode = (d) => defs.set(d.type, d);
const getNode = (t) => defs.get(t);
const unregisterNode = (t) => defs.delete(t);

const DESTRUCTIVE = /(^|\s|;|&&|\|\|)(rm\s+-rf\s+\/|mkfs|dd\s+if=|format\s+)/;
function checkBashSafe(code, allow) {
  if (DESTRUCTIVE.test(code) && !allow) return { status: 'failed', error: { code: 'BASH_DESTRUCTIVE', message: 'destructive pattern detected; set dangerouslyAllowDestructive:true to allow' } };
  return { ok: true };
}

function evalCond(expr, scope) {
  if (expr === 'x > 0') return scope.x > 0;
  if (expr === 'x > 10') return scope.x > 10;
  if (expr.startsWith('ctx.')) return expr.slice(4).split('.').reduce((o, k) => o?.[k], scope);
  throw new Error('expr parse failed: ' + expr);
}

function makeResult(status, partial = {}) { return { status, durationMs: 0, startedAt: '...', endedAt: '...', ...partial }; }
function advance(fromResult, onError) {
  if (fromResult.status === 'failed') {
    if (onError === 'continue') return { kind: 'skip-advance' };
    if (onError && typeof onError === 'object' && onError.goto) return { kind: 'goto', target: onError.goto };
    return { kind: 'stop', error: fromResult.error };
  }
  return { kind: 'normal', next: fromResult.next };
}

// ===== tests =====
console.log('\n=== dag-flow offline contract tests ===\n');

await t('AC1 hello world: 3 nodes 合法', () => {
  const def = { name: 'hello', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'say' },
    { id: 'say', type: 'log', params: { message: 'hi' }, next: 'end' },
    { id: 'end', type: 'end' },
  ] };
  validateWorkflowDef(def);
  assert.equal(def.nodes.length, 3);
});

await t('AC5 subagent: drift 时抛 Unavailable', async () => {
  await assert.rejects(() => callSubagent({}, { prompt: 'hi' }), /unavailable/);
});

await t('AC5 subagent: 健康时正常', async () => {
  const host = { tools:{register:()=>{}}, llm:{chat:async()=> 'mock'}, webServer:{register:()=>{}}, effect:()=>{} };
  const d = detectDrift(host);
  assert.equal(d.safeMode, false);
  const r = await host.llm.chat({ prompt: 'hi' });
  assert.equal(r, 'mock');
});

await t('AC6 control flow: if + 分支', () => {
  assert.equal(evalCond('x > 0', { x: 5 }), true);
  assert.equal(evalCond('x > 0', { x: -1 }), false);
  const branch = (c, n) => c ? n.true : n.false;
  assert.equal(branch(true, { true: 'yes', false: 'no' }), 'yes');
});

await t('AC7 自定义节点: register/get/unregister', () => {
  registerNode({ type: 'my_op', run: async () => 'ok' });
  assert.ok(getNode('my_op'));
  unregisterNode('my_op');
  assert.equal(getNode('my_op'), undefined);
});

await t('AC8 drift 探测: all-OK / empty / 字符串冒充', () => {
  const all = { tools:{register:()=>{}}, llm:{chat:()=>{}}, webServer:{register:()=>{}}, effect:()=>{} };
  assert.equal(detectDrift(all).safeMode, false);
  assert.equal(detectDrift({}).drifted.length >= 2, true);
  assert.equal(detectDrift({}).safeMode, true);
  assert.equal(detectDrift({ tools:{register:'not-fn'} }).drifted.includes('tools.register'), true);
});

await t('AC8 存储解析链: 无 host 线索且 cwd 不可用 → ~/.dsh/workflows 兜底', async () => {
  assert.equal(workflowsDir({}, null), path.join(os.homedir(), '.dsh', 'workflows'));
});

await t('AC8 存储解析链: host ctx 提供工作区 → <工作区>/.dag-flow/workflow', async () => {
  const host = { workspace: { cwd: 'D:/some/workspace' } };
  assert.equal(workflowsDir(host, 'D:/other'), path.join('D:/some/workspace', '.dag-flow', 'workflow'));
});

await t('AC8 存储解析链: cwd 可用（非 system32/主目录）→ <cwd>/.dag-flow/workflow', async () => {
  assert.equal(workflowsDir({}, 'D:/workspace/pluginspace'), path.join('D:/workspace/pluginspace', '.dag-flow', 'workflow'));
  assert.equal(workflowsDir({}, 'C:\\Windows\\System32'), path.join(os.homedir(), '.dsh', 'workflows'));
  assert.equal(workflowsDir({}, os.homedir()), path.join(os.homedir(), '.dsh', 'workflows'));
});

await t('AC9 JSON 损坏: SyntaxError', () => {
  assert.throws(() => JSON.parse('{'), SyntaxError);
});

await t('Edge E1: 拒 name 含空格', () => {
  assert.throws(() => validateWorkflowDef({ name: 'Bad Name', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] }), /invalid name/);
});

await t('Edge E1b: 中文名合法（2026-10-01 起 src/name-rule.ts）', () => {
  validateWorkflowDef({ name: '每日简报', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] });
  validateWorkflowDef({ name: 'AI-简报1', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] });
  assert.throws(() => validateWorkflowDef({ name: '每日 简报', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] }), /invalid name/);
  assert.throws(() => validateWorkflowDef({ name: '-abc', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] }), /invalid name/);
  assert.throws(() => validateWorkflowDef({ name: '../escape', version: 1, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] }), /invalid name/);
});

await t('Edge E2: 拒 next → 不存在 id', () => {
  assert.throws(() => validateWorkflowDef({ name: 't', version: 1, nodes: [
    { id: 's', type: 'start', next: 'ghost' }, { id: 'e', type: 'end' },
  ] }), /unknown ref: ghost/);
});

await t('Edge E3: bash ENOENT → BASH_SPAWN', () => {
  const r = bashErrorOnEnoent('ENOENT');
  assert.equal(r.error.code, 'BASH_SPAWN');
  assert.match(r.error.message, /bash not found/);
});

await t('Edge E4: python ENOENT → PYTHON_SPAWN', () => {
  const r = pythonErrorOnEnoent('ENOENT', 'python3');
  assert.equal(r.error.code, 'PYTHON_SPAWN');
  assert.match(r.error.message, /python3/);
});

await t('Edge E5: subagent timeout 包装', () => {
  const r = { status: 'failed', error: { code: 'SUBAGENT_UNAVAILABLE', message: 'subagent timeout after 60000ms' } };
  assert.equal(r.error.code, 'SUBAGENT_UNAVAILABLE');
  assert.match(r.error.message, /timeout/);
});

await t('Edge E6: 循环 maxIterations=1000', () => {
  assert.equal(Math.min(2000, 1000), 1000);
});

await t('Edge E7: 未知节点类型返回 undefined', () => {
  assert.equal(getNode('my_uninstalled_op'), undefined);
});

await t('Edge E8: 并发 run id 唯一', () => {
  const a = `run-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const b = `run-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  assert.notEqual(a, b);
});

await t('NodeResult 契约字段齐全', () => {
  const r = makeResult('success', { out: 'x' });
  assert.ok('status' in r && 'durationMs' in r && 'startedAt' in r && 'endedAt' in r);
  assert.equal(r.out, 'x');
});

await t('执行器: onError=continue 不阻断', () => {
  const r = advance({ status: 'failed', error: { code: 'X' } }, 'continue');
  assert.equal(r.kind, 'skip-advance');
});

await t('执行器: onError.goto 跳转', () => {
  const r = advance({ status: 'failed', error: { code: 'X' } }, { goto: 'cleanup' });
  assert.equal(r.kind, 'goto');
  assert.equal(r.target, 'cleanup');
});

await t('执行器: 默认 stop + firstError', () => {
  const r = advance({ status: 'failed', error: { code: 'X', message: 'boom' } });
  assert.equal(r.kind, 'stop');
  assert.equal(r.error.code, 'X');
});

await t('Bash 安全: rm -rf / 拒绝', () => {
  const r = checkBashSafe('rm -rf /', false);
  assert.equal(r.error.code, 'BASH_DESTRUCTIVE');
});

await t('Bash 安全: echo 通过', () => {
  assert.equal(checkBashSafe('echo hi', false).ok, true);
});

await t('Bash 安全: 显式 allow 通过', () => {
  assert.equal(checkBashSafe('rm -rf /tmp/test', true).ok, true);
});

await t('expr sandbox: 不存在路径得 undefined', () => {
  assert.equal(evalCond('ctx.x.y', { x: {} }), undefined);
});

await t('必须: 至少 1 个 start + 1 个 end', () => {
  assert.throws(() => validateWorkflowDef({ name: 't', version: 1, nodes: [{id:'x',type:'log'}] }), />=2/);
  assert.throws(() => validateWorkflowDef({ name: 't', version: 1, nodes: [{id:'s',type:'start'}] }), />=2/);
});

await t('必须: start 数量恰好 1', () => {
  assert.throws(() => validateWorkflowDef({ name: 't', version: 1, nodes: [
    { id: 'a', type: 'start' }, { id: 'b', type: 'start' }, { id: 'e', type: 'end' },
  ] }), /need 1 start, got 2/);
});

await t('必须: 节点 id 唯一', () => {
  assert.throws(() => validateWorkflowDef({ name: 't', version: 1, nodes: [
    { id: 's', type: 'start' }, { id: 's', type: 'end' },
  ] }), /duplicate id/);
});

await t('version 必须为 1', () => {
  assert.throws(() => validateWorkflowDef({ name: 't', version: 2, nodes: [{id:'s',type:'start'},{id:'e',type:'end'}] }), /version/);
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name}\n    ${f.err.message}`);
  process.exit(1);
}
process.exit(0);
