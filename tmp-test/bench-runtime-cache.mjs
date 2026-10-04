// tmp-test/bench-runtime-cache.mjs — 证据：runtime 解析在"循环里反复调用"时省了多少系统调用
//   （2026-10-04 用户反馈：「执行长任务循环的时候，不要循环扫描这三个三方依赖」）
// 用法：node tmp-test/bench-runtime-cache.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'df-rt-'));
const OUT = join(dir, 'runtime.mjs');
await build({ entryPoints: ['src/adapter/runtime.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const rt = await import(pathToFileURL(OUT).href);

// 另一份：把 bundle 放到**仓库内**（tmp-test/），这样 __dirname/.. 正好是插件根 → 能测"内置运行时命中"的快路径
const OUT2 = 'tmp-test/.rt-probe.mjs';
await build({ entryPoints: ['src/adapter/runtime.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT2, logLevel: 'silent' });
const rtBundled = await import(pathToFileURL(OUT2).href + '?v=' + Date.now());

const N = 200;
const timeIt = (label, fn) => {
  const t0 = performance.now();
  for (let i = 0; i < N; i++) fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(38)} ${N} 次共 ${ms.toFixed(1)}ms（每次 ${(ms / N).toFixed(3)}ms）`);
  return ms;
};
const trio = (m) => { m.resolvePython(); m.resolveBash(); m.resolveUv(); };

// 冷启动一次填缓存
trio(rt); trio(rtBundled);
const srcOf = (m) => ({ py: m.resolvePython().source, bash: m.resolveBash().source, uv: m.resolveUv().source });
console.log('① 场景 A：找不到内置运行时（模拟「按需下载」尚未下载 / 非 Windows 平台）');
console.log('   解析结果：', JSON.stringify(srcOf(rt)));
const aCached = timeIt('   带缓存', () => trio(rt));
process.env.DSH_RUNTIME_NO_CACHE = '1';
const aRaw = timeIt('   不带缓存（= 优化前）', () => trio(rt));
delete process.env.DSH_RUNTIME_NO_CACHE;

console.log('\n② 场景 B：内置运行时命中（本机真实布局）');
console.log('   解析结果：', JSON.stringify(srcOf(rtBundled)));
const bCached = timeIt('   带缓存', () => trio(rtBundled));
process.env.DSH_RUNTIME_NO_CACHE = '1';
const bRaw = timeIt('   不带缓存（= 优化前）', () => trio(rtBundled));
delete process.env.DSH_RUNTIME_NO_CACHE;

console.log(`\n场景 A 提速 ${(aRaw / Math.max(aCached, 0.001)).toFixed(0)}×（200 次省 ${(aRaw - aCached).toFixed(0)}ms）`);
console.log(`场景 B 提速 ${(bRaw / Math.max(bCached, 0.001)).toFixed(0)}×（200 次省 ${(bRaw - bCached).toFixed(0)}ms）`);
