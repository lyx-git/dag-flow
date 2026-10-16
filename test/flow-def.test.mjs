// test/flow-def.test.mjs — 画布 ⇄ def 往返契约（2026-10-04 轮 5）
//   背景：toRF/fromRF 是"5 个视图共享状态的真相源"，画布上任何一次编辑都会走
//   handleRFChange → fromRF(def, nodes, edges) → 用重建后的 nodes **整组替换** def.nodes。
//   2026-10-04 轮 5 修掉的真 bug：旧 fromRF 用**字段白名单**重建节点，于是 `tolerate`
//   （面板上的「忽略失败」）在一次画布编辑后就被静默抹掉。本文件把"往返不丢字段"钉死。
// 手段：esbuild 即时打包 src/client/util/flowDef.ts（纯模块，无 React/DOM）→ 断言
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = tmpRoot('df-flowdef-');
const OUT = join(dir, 'flowDef.mjs');
await build({ entryPoints: ['src/client/util/flowDef.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { toRF, fromRF, canonicalizeDef, newNodeId, flowgramNodeIdentity } = await import(pathToFileURL(OUT).href);

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
  eq(back.nodes.find((n) => n.id === 'start').next, undefined, 'A8. ★写盘不再写 next（2026-10-08 用户拍板：统一到 edges）');
  eq(back.edges, [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }], 'A9. edges 原样保留（执行真相）');
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
  // 画布上把 start 的出边改指到 end（旧的连线必须被丢掉，而不是留着指 a）
  const rfe2 = [{ id: 'e1', source: 'start', target: 'end' }];
  const back = fromRF(def, rf, rfe2);
  eq(back.edges, [{ from: 'start', to: 'end' }], 'C1. ★连线改动写回 edges（旧边被替换）');
  eq(back.nodes.find((n) => n.id === 'start').next, undefined, 'C2. ★不再写 next（写盘统一到 edges）');
  eq(back.nodes.find((n) => n.id === 'a').next, undefined, 'C3. 失去入边的节点也不残留 next');
}

console.log('== C2. canonicalizeDef：写盘归一化（next 合并进 edges 并删除）==');
{
  // ① 只有 next（老文件/手写/AI 生成）→ 推出 edges 并删 next
  const onlyNext = {
    name: 'w5', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'a' },
      { id: 'a', type: 'if', params: { condition: 'true' }, next: { true: 'end', false: 'a2' } },
      { id: 'a2', type: 'log', params: { message: 'x' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
  const r1 = canonicalizeDef(onlyNext);
  eq(r1.changed, true, 'C2-1. 有 next → changed=true');
  eq(r1.def.nodes.find((n) => n.id === 'start').next, undefined, 'C2-2. next 已删除');
  ok(r1.def.edges.some((e) => e.from === 'start' && e.to === 'a'), 'C2-3. 普通 next 推成边');
  ok(r1.def.edges.some((e) => e.from === 'a' && e.to === 'end' && e.when === 'true'), 'C2-4. if 的 {true,false} 带 when 键');
  ok(r1.def.edges.some((e) => e.from === 'a' && e.to === 'a2' && e.when === 'false'), 'C2-5. if 的 false 支也带键');

  // ② 只有 edges → 不动（changed=false）
  const onlyEdges = { name: 'w6', version: 1, nodes: [{ id: 'start', type: 'start', params: {} }, { id: 'end', type: 'end' }], edges: [{ from: 'start', to: 'end' }] };
  const r2 = canonicalizeDef(onlyEdges);
  eq(r2.changed, false, 'C2-6. 只有 edges → 不动（changed=false）');
  eq(r2.def.edges, [{ from: 'start', to: 'end' }], 'C2-7. edges 原样');

  // ③ 两者都有且不一致 → **edges 优先**（引擎/画布同规则），只删 next
  const both = {
    name: 'w7', version: 1,
    nodes: [{ id: 'start', type: 'start', params: {}, next: 'a' }, { id: 'a', type: 'log', params: { message: 'x' } }, { id: 'end', type: 'end' }],
    edges: [{ from: 'start', to: 'end' }],
  };
  const r3 = canonicalizeDef(both);
  eq(r3.changed, true, 'C2-8. 两者都有 → changed=true');
  eq(r3.def.edges, [{ from: 'start', to: 'end' }], 'C2-9. ★冲突时 edges 优先（与引擎一致，绝不改执行语义）');
  eq(r3.def.nodes.find((n) => n.id === 'start').next, undefined, 'C2-10. next 删除');

  // ④ switch 的非对象 next → 恒激活 shim（与宿主 normalize.ts 的例外逐条对齐）
  const sw = {
    name: 'w8', version: 1,
    nodes: [{ id: 'start', type: 'start', params: {}, next: 'sw' }, { id: 'sw', type: 'switch', params: { value: 'x', cases: { a: 'end' } }, next: 'end' }, { id: 'end', type: 'end' }],
  };
  const r4 = canonicalizeDef(sw);
  ok(r4.def.edges.some((e) => e.from === 'sw' && e.to === 'end' && e.when === '*'), 'C2-11. ★switch 的非对象 next → when:"*"（恒激活，与宿主一致）');
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

console.log('== E. 显示名（label）与 `_label` 幽灵键（2026-10-15 修 bug）==');
{
  // 背景：右侧面板「显示名 (label)」过去把新名字当**普通参数**提交（`{_label: 新名}`），
  //   而 `_label` 全仓库零消费者 ⇒ ①改名静默无效（node.label 永不更新，画布卡片标题/失败详情
  //   里的「显示名_id」都看不到新名）②def 的 params 被污染（用户真实工作流 3 处已中招）。
  //   修法＝FlowPanel.handleNodeChange 抽出 `_label` 写**顶层 label**；fromRF 兜底剔除该键
  //   （画布→def 的唯一写出路径 ⇒ 动一次画布并保存，全图历史污染自动清掉）。
  //   本段锁"写出路径的净化 + 顶层 label 往返"，handleNodeChange 的行为面在 CDP `label-rename`。
  const def = {
    name: 'w9', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'a' },
      { id: 'a', type: 'log', params: { message: 'x', _label: '日报配置' }, label: '日志A' },
      { id: 'end', type: 'end' },
    ],
    edges: [{ from: 'start', to: 'a' }],
  };
  const { nodes: rf, edges: rfe } = toRF(def);
  eq(rf.find((n) => n.id === 'a').data.label, '日志A', 'E1. 顶层 label 进画布 data.label（画布卡片标题读的就是它）');
  const back = fromRF(def, rf, rfe);
  const a = back.nodes.find((n) => n.id === 'a');
  eq(a.label, '日志A', 'E2. label 往返后仍落在**顶层字段**（不是 params）');
  eq('_label' in (a.params || {}), false, 'E3. ★params 里的历史幽灵键 `_label` 被剔除（不再落盘）');
  eq(a.params, { message: 'x' }, 'E4. 剔除幽灵键不影响其它参数');
}

console.log('== F. ★新节点身份生成器（2026-10-16 收口：唯一入口 + 合法性自带）==');
{
  // 背景：FlowGram 的 `createWorkflowNodeByType` 在 `json.id === undefined` 时兜底 `` `1${nanoid()}` ``
  //   （**必然数字开头**）⇒ 撞 WORKFLOW_SCHEMA 的 `^[a-zA-Z]…` ⇒ 引擎解析拦下、运行/定时全失败。
  //   两条建节点路径（面板拖拽 / 拖线快选）曾**各自拼 id**，其中一条漏给 ⇒ 事故。
  //   本段钉死「生成器一定产出合法 id」（纯函数层）；"两条路径真的把它传给了 FlowGram" 由
  //   CDP `test-palette-drag.mjs` / `test-line-drop-panel.mjs` 的 id 合法性断言覆盖。
  const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
  const ids = [];
  for (let i = 0; i < 200; i++) ids.push(newNodeId());
  ok(ids.every((x) => ID_RE.test(x)), `F1. newNodeId() 产出合法 id（200 次全过；样例 ${ids[0]}）`);
  ok(ids.every((x) => /^[a-z0-9]{4}$/.test(x.slice(x.lastIndexOf('_') + 1))), 'F2. 后缀恒为 4 位 [a-z0-9]（字符集天然落在合法集内）');

  const a = flowgramNodeIdentity('python', 'Python');
  ok(ID_RE.test(a.id), `F3. flowgramNodeIdentity 的 id 合法（${a.id}）`);
  ok(a.id.startsWith('python_'), 'F4. 以节点类型为前缀（便于人读）');
  ok(a.label === `Python_${a.id.slice('python_'.length)}`, 'F5. ★label 与 id 共用同一后缀（报错里的「显示名_id」能对上）');

  // 阳性对照：即便调用方传了非法前缀，生成器也必须兜住（否则红线又交回给调用方）
  const bad = flowgramNodeIdentity('9bad type', 'X');
  ok(ID_RE.test(bad.id) && bad.id.startsWith('node_'), `F6. ★非法前缀被归一化为 node_（阳性对照：${bad.id}）`);
}

console.log(`\n=== flowDef 往返契约：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
