// tmp-test/build-fixture.mjs — 把 CDP 夹具入口 tmp-test/grab-test.tsx 打成
//   tmp-test/grab-test.js（iife，React 内联）+ tmp-test/grab-test.css（<link> 用）
// 用法：node tmp-test/build-fixture.mjs   （工作目录 = dag-flow 仓库根）
// ★ 任何 src/client 下的改动，CDP 夹具都必须重新构建，否则夹具跑的还是旧客户端（"改了没反应"假象）。
import * as esbuild from 'esbuild';

const t0 = Date.now();
await esbuild.build({
  entryPoints: ['tmp-test/grab-test.tsx'],
  outfile: 'tmp-test/grab-test.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  jsx: 'automatic',
  minify: false,
  sourcemap: false,
  treeShaking: true,
  loader: { '.css': 'css', '.png': 'dataurl', '.svg': 'dataurl', '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'warning',
});
console.log(`[build-fixture] ✓ tmp-test/grab-test.js + grab-test.css (${Date.now() - t0}ms)`);
