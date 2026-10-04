// test/flow-def.test.mjs — 画布 ⇄ def 往返契约（2026-10-04 轮 5）
//   背景：toRF/fromRF 是"5 个视图共享状态的真相源"，画布上任何一次编辑都会走
//   handleRFChange → fromRF(def, nodes, edges) → 用重建后的 nodes **整组替换** def.nodes。
//   2026-10-04 轮 5 修掉的真 bug：旧 fromRF 用**字段白名单**重建节点，于是 `tolerate`
//   （面板上的「忽略失败」）在一次画布编辑后就被静默抹掉。本文件把"往返不丢字段"钉死。
// 手段：esbuild 即时打包 src/client/util/flowDef.ts（纯模块，无 React/DOM）→ 断言
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-flowdef-'));
const OUT = join(dir, 'flowDef.mjs');
await build({ entryPoints: ['src/client/util/flowDef.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { toRF, fromRF } = await import(pathToFileURL(OUT).href);

console.log('== A. def → 画布 → def：字段不丢 ==');
{
  const def = {
    name: 'w', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'a', label: '开始' },
      { id: 'a', type: 'log', params: { level: 'info', message: 'hi' }, next: 'end', tolerate: true, onError: 'continue', label: '日志A' },
      { id: 'b', type: 'python', params: { code: 'print(1)' }, onError: { goto: 'a' } },
      { id: 'end', type: 'end', params: {} },
    ],
    edges: [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
    layout: { start: { x: 1, y: 2 }, a: { x: 3, y: 4 } },
  };
  const { nodes: rf, edges: rfe } = toRF(def);
  const back = fromRF(def, rf, rfe);
  const a = back.nodes.find((n) => n.id === 'a');
  const b = back.nodes.find((n) => n.id === 'b');
  eq(a.tolerate, true, 'A1. ★tolerate 往返保留（旧实现会丢——这是本轮修的 bug）');
  eq(a.onError, 'continue', 'A2. onError 往返保留');
  eq(a.label, '日志A', 'A3. label 往返保留');
  eq(a.params, { level: 'info', message: 'hi' }, 'A4. params 往返保留');
  eq(b.onError, { goto: 'a' }, 'A5. onError:{goto} 往返保留');
  eq(back.name, 'w', 'A6. 工作流级字段（name）不丢');
  ok(back.nodes.length === 4, 'A7. 节点数不变');
}

console.log('== B. 未知/未来字段也要保留（不再用白名单）==');
{
  const def = {
    name: 'w2', version: 1,
    nodes: [{ id: 'start', type: 'start', params: {}, next: 'end' }, { id: 'end', type: 'end' }],
    edges: [{ from: 'start', to: 'end' }],
  };
  // 模拟"将来给 Node 加了字段"：往返后必须还在
  def.nodes[0].futureField = { keep: 'me' };
  const { nodes: rf, edges: rfe } = toRF(def);
  const back = fromRF(def, rf, rfe);
  eq(back.nodes.find((n) => n.id === 'start').futureField, { keep: 'me' }, 'B1. ★未登记的新字段也保留（白名单模式会丢）');
}

console.log('== C. 结构变更仍然生效（不能因为"保留"而变粘）==');
{
  const def = {
    name: 'w3', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'a' },
      { id: 'a', type: 'log', params: { message: 'x' } },
      { id: 'end', type: 'end' },
    ],
    edges: [{ from: 'start', to: 'a' }],
  };
  const { nodes: rf, edges: rfe } = toRF(def);
  // 画布上把 start 的出边改指到 end（旧的 next 必须被丢掉，而不是留着指 a）
  const rfe2 = [{ id: 'e1', source: 'start', target: 'end' }];
  const back = fromRF(def, rf, rfe2);
  eq(back.nodes.find((n) => n.id === 'start').next, 'end', 'C1. 连线改动写回 next（旧 next 被替换）');
  eq(back.edges, [{ from: 'start', to: 'end' }], 'C2. edges 同步');
  eq(back.nodes.find((n) => n.id === 'a').next, undefined, 'C3. 失去入边的节点不再残留旧 next');
}

console.log('== D. 显式假值原样保留（不静默改写用户数据）==');
{
  const def = {
    name: 'w4', version: 1,
    nodes: [{ id: 'start', type: 'start', params: {}, next: 'end', tolerate: false }, { id: 'end', type: 'end' }],
    edges: [{ from: 'start', to: 'end' }],
  };
  const { nodes: rf, edges: rfe } = toRF(def);
  const back = fromRF(def, rf, rfe);
  // 说明：面板写入时沿用「取消勾选=删键」，所以 UI 不会产出 false；这里锁的是"手写/旧数据里的
  // tolerate:false 不会被画布往返悄悄抹掉"（引擎按 tolerate === true 判定，false 等价于未设置）。
  eq(back.nodes.find((n) => n.id === 'start').tolerate, false, 'D1. tolerate:false 原样保留（引擎只认 === true，行为等同未设置；但数据不被静默改写）');
}

console.log(`\n=== flowDef 往返契约：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
