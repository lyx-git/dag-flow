// test/topo.test.mjs — 拓扑排序 + 环路检测单元测试
// 跑法：node test/topo.test.mjs
// （纯函数验证，不依赖 DSH 环境）

import { topoSort } from '../src/executor/topo.ts';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

function mkDef(nodes, edges) {
  return { name: 't', version: 1, nodes: nodes.map((id) => ({ id, type: id === 'start' ? 'start' : id === 'end' ? 'end' : 'log', params: {} })), edges };
}

console.log('== 1. 无环 DAG 拓扑 ==');
{
  const def = mkDef(['start', 'a', 'b', 'end'], [
    { from: 'start', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'end' },
  ]);
  const r = topoSort(def);
  assert(r.ok === true, 'ok=true');
  assert(r.order.join(',') === 'start,a,b,end', `order=${r.order}`);
  assert(r.layers.length === 4, `4 层，实际 ${r.layers.length}`);
  assert(r.unreachable.length === 0, '全部可达');
}

console.log('== 2. 并行分支 ==');
{
  const def = mkDef(['start', 'a', 'b', 'end'], [
    { from: 'start', to: 'a' },
    { from: 'start', to: 'b' },
    { from: 'a', to: 'end' },
    { from: 'b', to: 'end' },
  ]);
  const r = topoSort(def);
  assert(r.ok === true, 'ok=true');
  assert(r.layers.length === 3, `3 层（start | a,b | end），实际 ${r.layers.length}`);
  assert(r.layers[1]?.length === 2, `第 2 层 2 节点并行：${JSON.stringify(r.layers[1])}`);
}

console.log('== 3. 环路检测 ==');
{
  const def = mkDef(['a', 'b', 'c'], [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ]);
  const r = topoSort(def);
  assert(r.ok === false, 'ok=false（检测到环）');
  assert(r.cyclePath !== null, '给出环路径');
  console.log(`  环路径: ${r.cyclePath}`);
}

console.log('== 4. 自环 ==');
{
  const def = mkDef(['a'], [{ from: 'a', to: 'a' }]);
  const r = topoSort(def);
  assert(r.ok === false, 'ok=false（自环）');
}

console.log('== 5. 不可达节点 ==');
{
  const def = mkDef(['start', 'end', 'orphan'], [
    { from: 'start', to: 'end' },
  ]);
  const r = topoSort(def);
  assert(r.ok === true, 'ok=true');
  assert(r.unreachable.includes('orphan'), `orphan 不可达：${JSON.stringify(r.unreachable)}`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
