// test/undo-stack.test.mjs — 自建撤销栈单测（2026-10-16 用户拍板方案 B）
//   背景：FlowGram 自带 history 在本项目用不上（位移走自建拖拽引擎绕过 operationService；
//         且每次 def→fromJSON 都触发 onReload→clear），按钮恒灰 ⇒ 用户报「撤销和重做没反应」。
//   契约：快照栈 = def 的 JSON；连续编辑合并；redo 分支丢弃；上限；回放不入栈；undo/redo 交 applier。
//   手段：esbuild 即时打包 src/client/undo-stack.ts → 临时 mjs → 断言（纯逻辑，无 React/无 IO/无 CDP）
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = tmpRoot('df-undo-stack-');
const OUT = join(dir, 'undoStack.mjs');
await build({ entryPoints: ['src/client/undo-stack.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const U = await import(pathToFileURL(OUT).href);
const {
  observeDef, resetUndo, undo, redo, undoCan, redoCan, undoStats,
  setUndoApplier, diffKeyOf, MAX_STEPS, COALESCE_MS, APPLY_QUIET_MS,
} = U;

// def 夹具：两个节点 + layout（位置是 def.layout[nodeId]，见 util/flowDef.ts 的布局持久化）
const mkDef = (opts = {}) => ({
  nodes: [
    { id: 'a', type: 'py', label: 'A', params: { code: 'print(1)' } },
    { id: 'b', type: 'ai', label: 'B', params: { prompt: 'hello' } },
  ],
  edges: [{ from: 'a', to: 'b' }],
  layout: { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
  ...opts,
});
const moved = (id, x, y) => {
  const d = mkDef();
  d.layout[id] = { x, y };
  return d;
};
/** 在 base 之上只改一个节点的位置（"接着上一个状态继续"用）——`moved()` 每次都从基线出发，
 *  会让"换节点拖动"变成两个节点同时动，diffKey 就不是 `pos:单个节点` 了 */
const withPos = (base, id, x, y) => {
  const d = JSON.parse(JSON.stringify(base));
  d.layout[id] = { x, y };
  return d;
};

console.log('== A. diffKeyOf：变化归类（决定能否合并）==');
{
  eq(diffKeyOf(mkDef(), mkDef()), '', 'A1. 完全没变 ⇒ 空 key');
  eq(diffKeyOf(mkDef(), moved('a', 50, 50)), 'pos:a', 'A2. 只有 layout 变 ⇒ "pos:<节点id>"（同一节点的连续位移可合并；换节点则分条）');
  const param = mkDef();
  param.nodes[0] = { ...param.nodes[0], params: { code: 'print(2)' } };
  eq(diffKeyOf(mkDef(), param), 'node:a', 'A3. 只有节点 a 的内容变 ⇒ "node:a"（连续打字可合并）');
  eq(diffKeyOf(mkDef(), { ...mkDef(), edges: [] }), 'struct:edges', 'A4. 连线变了 ⇒ "struct:edges"（结构性，每次独立记）');
  const two = mkDef();
  two.nodes[0] = { ...two.nodes[0], label: 'A2' };
  two.nodes[1] = { ...two.nodes[1], label: 'B2' };
  eq(diffKeyOf(mkDef(), two), 'struct:nodes', 'A5. 两个节点同时变 ⇒ "struct:nodes"');
}

console.log('== B. 观察与栈行为 ==');
{
  // applier：记下最后一次被应用的目标
  let applied = null;
  setUndoApplier((d) => { applied = d; });

  resetUndo(mkDef());
  eq(undoCan(), false, 'B1. 刚载入（基线）不能撤销');
  eq(redoCan(), false, 'B2. 也不能重做');

  observeDef(moved('a', 100, 100));
  eq(undoCan(), true, 'B3. 拖动位移后可以撤销');
  eq(undoStats().size, 2, 'B4. 栈里是 基线 + 1 条位移');

  // 合并：紧接着再来一次"只有位置变"（< 窗口）⇒ 覆盖栈顶，不新增
  observeDef(moved('a', 150, 150));
  eq(undoStats().size, 2, `B5. ${COALESCE_MS}ms 内的连续位移合并成一条（不撑爆栈）`);

  // ★ 同一节点的位移**不看时间窗**：慢拖（每步间隔超过窗口）也必须只算一次拖动
  //   （真机/CDP 实测：拖动 15 步、每步 CDP 往返 100ms+ ⇒ 中途多次落定，按时间窗会记成好几条，
  //    结果第一下撤销只退回"拖动中途"的一步 —— 这正是本用例抓出来的 bug）
  await new Promise((r) => setTimeout(r, COALESCE_MS + 120));
  observeDef(moved('a', 170, 170));
  eq(undoStats().size, 2, `B5b. ★慢拖（间隔 > ${COALESCE_MS}ms 的同一节点位移）仍合并成一条`);

  // 换一个节点再拖（只动 b）⇒ key 变了（pos:b）⇒ 独立成条
  observeDef(withPos(moved('a', 170, 170), 'b', 300, 300));
  eq(undoStats().size, 3, 'B5c. 换节点拖动 ⇒ 独立记一条（撤销不会一下退回两次拖动）');
  // 再拖 a（b 留在 300,300）⇒ key 变回 pos:a ⇒ 又是一条
  const twoDrags = withPos(withPos(moved('a', 170, 170), 'b', 300, 300), 'a', 210, 210);
  observeDef(twoDrags);
  eq(undoStats().size, 4, 'B5d. 再动 a ⇒ 又是一条（与 b 的位移不同 key）');

  // 改参数：不同 key ⇒ 新条目
  const p = JSON.parse(JSON.stringify(twoDrags));
  p.nodes[0] = { ...p.nodes[0], params: { code: 'print(3)' } };
  observeDef(p);
  eq(undoStats().size, 5, 'B6. 换一种编辑（改参数）⇒ 新记一条');

  // 撤销：applier 收到上一份 def（位置回到 150,150 那版）
  const target = {};  // 占位（下一段用）

  eq(undo(), true, 'B7. undo() 返回 true');
  eq(applied?.layout?.a?.x, 210, 'B8. ★撤销把位移回退（applier 收到上一份 def 的 layout.x=210）');
  eq(undoCan(), true, 'B9. 还能继续撤销（回到基线）');
  eq(redoCan(), true, 'B10. 现在可以重做');
  eq(redo(), true, 'B11. redo() 返回 true');
  eq(applied?.nodes?.[0]?.params?.code, 'print(3)', 'B12. ★重做把参数改回 print(3)');
  void target;
}

console.log('== C. 回放不入栈（撤销本身不能被记成新历史）==');
{
  setUndoApplier(() => { /* 回放：FlowPanel 会 setDef ⇒ def 变化 ⇒ 又被 observeDef 看到 */ });
  resetUndo(mkDef());
  observeDef(moved('a', 10, 10));
  const sizeBefore = undoStats().size;
  undo();
  // 模拟 setDef 之后的 def 变化：正好等于被应用回去的那份快照
  observeDef(moved('a', 0, 0));
  eq(undoStats().size, sizeBefore, 'C1. ★撤销回放（def 变成目标快照）**不产生新历史**');
  eq(redoCan(), true, 'C2. 回放后重做分支仍在（撤销不会把 redo 冲掉）');
  // ★ 回放涟漪（CDP 实测）：画布回抛的 def 会被归一化（与目标快照只差 edges/nodes）
  //   —— 它必须被吸收进当前条目，否则 `slice(0, index+1)` 会切掉 redo 分支（重做按钮变灰）
  const rippled = moved('a', 0, 0);
  rippled.nodes[0] = { ...rippled.nodes[0], params: { code: 'print(1)' }, note: 'normalized' };
  observeDef(rippled);
  eq(undoStats().size, sizeBefore, 'C3. ★回放涟漪（归一化导致的 nodes 差异）不新增条目');
  eq(redoCan(), true, 'C4. ★涟漪之后重做分支仍在（这正是"撤销后重做按钮还是灰的"那个 bug）');
}

console.log('== D. 新编辑丢弃 redo 分支 ==');
{
  setUndoApplier(() => {});
  resetUndo(mkDef());
  observeDef(moved('a', 10, 10));      // 基线 → 位移
  observeDef({ ...mkDef(), edges: [] }); // 结构性编辑
  undo();
  eq(redoCan(), true, 'D1. 撤销后能重做');
  // 静默期内（回放涟漪窗口）的编辑被吸收：不新增条目、也不切掉 redo 分支（这是挡住涟漪的代价）
  const duringQuiet = mkDef();
  duringQuiet.nodes[1] = { ...duringQuiet.nodes[1], params: { prompt: 'q' } };
  observeDef(duringQuiet);
  eq(redoCan(), true, `D1b. 静默期（${APPLY_QUIET_MS}ms）内的编辑不切 redo 分支（涟漪保护）`);
  await new Promise((r) => setTimeout(r, APPLY_QUIET_MS + 120));
  const p = mkDef();
  p.nodes[0] = { ...p.nodes[0], params: { code: 'print(9)' } };
  observeDef(p);
  eq(redoCan(), false, 'D2. ★静默期过后产生新编辑 ⇒ redo 分支被丢弃');
}

console.log('== E. 栈上限 ==');
{
  resetUndo(mkDef());
  for (let i = 1; i <= MAX_STEPS + 20; i++) {
    // 每次换一个**键名**（`marker<i>`）⇒ key 各不相同 ⇒ 不会被合并掉（同 key 的连续变更才合并）
    observeDef({ ...mkDef(), [`marker${i}`]: i });
  }
  eq(undoStats().size, MAX_STEPS, `E1. 栈深被限制在 MAX_STEPS=${MAX_STEPS}（超出丢最旧）`);
  eq(undoCan(), true, 'E2. 超限后仍可撤销');
}

console.log(`\n结果：${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
