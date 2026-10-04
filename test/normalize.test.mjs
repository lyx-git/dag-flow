// test/normalize.test.mjs — 「归一化」单测（2026-10-04 合并顺序模式 · 第 1 轮）
//   用户拍板：dag-flow 只保留一套 DAG 语义——没有 edges 的定义（手写 JSON / AI 生成 / 旧文件 /
//   单节点测试）由 next 补出等价 edges 后再走同一个 DAG 执行器。
// 覆盖：next 四种形态的映射 / switch 非对象 next 的恒激活 shim / 空目标 / normalizeDef 契约
//      （已有 edges 绝不动、不修改入参、幂等、无 next 不补边）。
// 手段：esbuild 即时打包 src/executor/normalize.ts → 临时 mjs → 断言（纯函数，无 IO）
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-normalize-'));
const OUT = join(dir, 'normalize.mjs');
await build({ entryPoints: ['src/executor/normalize.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { nextToEdges, normalizeDef } = await import(pathToFileURL(OUT).href);

console.log('== A. 单节点 next 四种形态 → edges ==');
{
  eq(nextToEdges([{ id: 'a', type: 'log', next: 'b' }]), [{ from: 'a', to: 'b' }],
    'A1. 字符串 next → 一条普通边（省略 when，与客户端 toRF 一致）');

  eq(nextToEdges([{ id: 'a', type: 'log', next: ['b', 'c'] }]), [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
    'A2. 数组 next → 两条并行的普通边');

  eq(nextToEdges([{ id: 'i', type: 'if', next: { true: 'y', false: 'n' } }]), [{ from: 'i', to: 'y', when: 'true' }, { from: 'i', to: 'n', when: 'false' }],
    'A3. {true,false} → when:true / when:false（if 分支）');

  eq(nextToEdges([{ id: 's', type: 'switch', next: { quick: 'q', full: 'f', '*': 'd' } }]),
    [{ from: 's', to: 'q', when: 'quick' }, { from: 's', to: 'f', when: 'full' }, { from: 's', to: 'd', when: '*' }],
    'A4. switch 的对象 next → when:case（含 * 兜底）');

  eq(nextToEdges([{ id: 'a', type: 'log' }]), [], 'A5. 没有 next → 不出边');
  eq(nextToEdges([{ id: 'a', type: 'log', next: null }]), [], 'A6. next:null → 不出边');
  eq(nextToEdges([{ id: 'a', type: 'log', next: { true: 'y', false: '' } }]), [{ from: 'a', to: 'y', when: 'true' }],
    'A7. 空字符串目标跳过（与客户端 toRF 的 if (!target) continue 一致）');
  eq(nextToEdges([{ id: 'a', type: 'log', next: ['b', ''] }]), [{ from: 'a', to: 'b' }], 'A8. 数组里的空目标同样跳过');
}

console.log('== B. switch 非对象 next 的恒激活 shim（唯一例外，必须保留）==');
{
  eq(nextToEdges([{ id: 's', type: 'switch', next: 'x' }]), [{ from: 's', to: 'x', when: '*' }],
    'B1. switch + 字符串 next → when:"*"（复现 legacy 的"无条件跟随"；否则 DAG 会判未激活而跳过）');
  eq(nextToEdges([{ id: 's', type: 'switch', next: ['x', 'y'] }]), [{ from: 's', to: 'x', when: '*' }, { from: 's', to: 'y', when: '*' }],
    'B2. switch + 数组 next → 每条都是 when:"*"（并行且都激活）');
  eq(nextToEdges([{ id: 'i', type: 'if', next: 'x' }]), [{ from: 'i', to: 'x' }],
    'B3. if + 字符串 next → 不带 when（DAG 对 if 的缺键边本来就恒激活，无需 shim）');
  eq(nextToEdges([{ id: 'n', type: 'log', next: 'x' }]), [{ from: 'n', to: 'x' }],
    'B4. 普通节点 + 字符串 next → 不带 when（非 if/switch 的边一律激活）');
}

console.log('== C. normalizeDef 契约 ==');
{
  const withEdges = { name: 'w', version: 1, nodes: [{ id: 'a', type: 'log', next: 'b' }, { id: 'b', type: 'log' }], edges: [{ from: 'a', to: 'b' }] };
  const r1 = normalizeDef(withEdges);
  eq(r1.added, 0, 'C1. 已有 edges → 一条都不补');
  ok(r1.def === withEdges, 'C2. 已有 edges → 返回的就是原对象（画布工作流零改动）');

  const nextOnly = { name: 'n', version: 1, nodes: [{ id: 'a', type: 'log', next: 'b' }, { id: 'b', type: 'log' }] };
  const r2 = normalizeDef(nextOnly);
  eq(r2.added, 1, 'C3. next-only → 补 1 条边');
  eq(r2.def.edges, [{ from: 'a', to: 'b' }], 'C4. 补出来的边内容正确');
  ok(nextOnly.edges === undefined, 'C5. ★不修改入参（原 def 仍然没有 edges，避免调用方被意外改写）');
  ok(r2.def !== nextOnly, 'C6. 返回的是新对象');
  eq(r2.def.nodes, nextOnly.nodes, 'C7. nodes 数组原样复用（不做深拷贝，省内存）');

  const r3 = normalizeDef(r2.def);
  eq(r3.added, 0, 'C8. 幂等：对归一化结果再归一化不再补边');

  const empty = { name: 'e', version: 1, nodes: [{ id: 'a', type: 'log' }] };
  const r4 = normalizeDef(empty);
  eq(r4.added, 0, 'C9. 既无 edges 也无 next → 不补边（交给 DAG 按"全部入度 0"处理）');
  ok(r4.def === empty, 'C10. 那种情况同样返回原对象');

  const star = normalizeDef({ name: 's', version: 1, nodes: [{ id: 'a', type: 'switch', next: 'b' }, { id: 'b', type: 'log' }] });
  eq(star.def.edges, [{ from: 'a', to: 'b', when: '*' }], 'C11. switch shim 在 normalizeDef 里同样生效');
}

console.log(`\n=== normalize 归一化：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
