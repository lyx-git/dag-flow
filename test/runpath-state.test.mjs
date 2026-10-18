// test/runpath-state.test.mjs — 连线运行态落色判定（纯函数，2026-10-19 用户四轮定稿）
//
// 语义（用户原话汇总）：
//   ①「连接线变绿，必须要前后节点都执行了，不论执行成功还是失败」⇒ active = 两端都执行过
//   ②「线上的动画效果，在后一个节点开始运行的时候才有，直到整个链路执行结束（无论成功还是失败）才停止」
//   ③「如果中间某个节点失败、流程不继续了，也要中断后面线的动画；如果中间节点的失败被忽略了、
//      还继续执行后面的流程，那么线的动画还是正常要有的」⇒ flowing 集合（目标失败且流程中断的边不在其中）
// 判据链：没走过⇒dim；走过 + 整轮在跑 + 在 flowing⇒moving；否则 done（两端成功）/ stalled。
// 手法：esbuild 即时打包 runStatus.ts（纯逻辑、无 React）→ 直接调 stateFor 断言。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const tmp = tmpRoot('dag-flow-runpath-test-');
const OUT = join(tmp, 'runstatus.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/client/flowgram/runStatus.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: OUT, logLevel: 'silent',
});
const { runPathStore, runPathKey } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const mk = (from, to) => ({ from: { id: from }, to: { id: to } });
const L_AB = mk('a', 'b');
const L_BC = mk('b', 'c');
const L_CD = mk('c', 'd');
const K_AB = runPathKey(L_AB);
const K_BC = runPathKey(L_BC);
const K_CD = runPathKey(L_CD);

// ① 没有运行态：一律 null（画布保持设计态）
runPathStore.set(false, new Set(), new Set(), new Set(), false);
t('R1 无运行态 ⇒ null（画布照旧，不淡化不动画）', runPathStore.stateFor(L_AB) === null);

// ② 走过 + 支路活着 + 整轮在跑 ⇒ 流动
runPathStore.set(true, new Set([K_AB, K_BC]), new Set(), new Set([K_AB, K_BC]), true);
t('R2 走过且支路活着 ⇒ moving（正在流动）', runPathStore.stateFor(L_AB) === 'moving', String(runPathStore.stateFor(L_AB)));

// ③ ★ 末版规则：目标节点失败且流程中断 ⇒ **这条边立刻停**（不在 flowing）
//    同时同轮里另一条还活着的支路必须照常流动（证明不是"整轮一失败全停"）
runPathStore.set(true, new Set([K_AB, K_BC]), new Set(), new Set([K_BC]), true);
t('R3 目标失败且流程中断 ⇒ 该边立刻转 stalled（动画停）', runPathStore.stateFor(L_AB) === 'stalled', String(runPathStore.stateFor(L_AB)));
t('R4 同轮其它还活着的支路 ⇒ 仍在 moving（不是全停）', runPathStore.stateFor(L_BC) === 'moving', String(runPathStore.stateFor(L_BC)));

// ④ 失败被忽略（🛟 忽略失败，下游照跑）⇒ 仍在 flowing ⇒ 继续流动
runPathStore.set(true, new Set([K_AB]), new Set(), new Set([K_AB]), true);
t('R5 失败被忽略 ⇒ 继续流动', runPathStore.stateFor(L_AB) === 'moving', String(runPathStore.stateFor(L_AB)));

// ⑤ 整轮结束（成功/失败/取消都一样）：runActive=false ⇒ 全部转静态
runPathStore.set(true, new Set([K_AB, K_BC]), new Set([K_AB]), new Set([K_AB, K_BC]), false);
t('R6 整轮结束后：两端成功 ⇒ done（常亮绿+外发光）', runPathStore.stateFor(L_AB) === 'done', String(runPathStore.stateFor(L_AB)));
t('R7 整轮结束后：走过但有一端没成功 ⇒ stalled（静态绿）', runPathStore.stateFor(L_BC) === 'stalled', String(runPathStore.stateFor(L_BC)));

// ⑥ 没走过（两端没都执行）= 淡化
runPathStore.set(true, new Set([K_AB]), new Set(), new Set([K_AB]), true);
t('R8 没走过的边 ⇒ dim（淡化 40%）', runPathStore.stateFor(L_CD) === 'dim', String(runPathStore.stateFor(L_CD)));

// ⑦ 反向锁：flowing 只对"走过"的边生效（flowing 里有但 active 没有 ⇒ 仍 dim）
runPathStore.set(true, new Set(), new Set(), new Set([K_CD]), true);
t('R9 反向锁：flowing 里有、但两端没都执行 ⇒ 仍是 dim（不会凭空流动）', runPathStore.stateFor(L_CD) === 'dim', String(runPathStore.stateFor(L_CD)));

console.log(`\n=== runpath-state: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
