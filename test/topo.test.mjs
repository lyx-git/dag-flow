// test/topo.test.mjs — 拓扑排序 + 环路检测单元测试（纯函数验证，不依赖 DSH 环境）
// 覆盖：无环分层与层序 / 并行分支同层 / 有环（给出环路径）/ 自环 / 不可达节点
// 手段：esbuild 即时打包 src/executor/topo.ts → 临时 mjs → 断言（与测试链其余文件同款写法）
//   ★ 2026-10-11 改造：此前是直接 `import '../src/executor/topo.ts'` —— 全仓**唯一**依赖 Node
//     原生 TS 类型剥离的孤例（package.json 声明 engines >=22.13，而早期 22.x 需要
//     --experimental-strip-types 才认 .ts），换机器/换 Node 版本会让整条 suite 变红。
//   断言 1:1 保留（12 条），只换加载方式；并纳入 npm run test:offline。
// 跑法：node test/topo.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const dir = tmpRoot('df-topo-');
const OUT = join(dir, 'topo.mjs');
await build({ entryPoints: ['src/executor/topo.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { topoSort } = await import(pathToFileURL(OUT).href);

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

console.log(`\n=== topo: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
