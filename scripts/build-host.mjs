#!/usr/bin/env node
// scripts/build-host.mjs — 把 src/index.ts 编成单文件 ESM dist/index.js
//
// v0.3.2 修订：之前 tsc 输出 + 多文件 dynamic import 让 namespace.apply
// 在 dsh loader 拿到时不稳定。换成 esbuild 单文件 bundle，对齐
// dsh-image-vision 2.9.2 的 lib/index.js 风格（2413 行单一 export 块）。
//
// dsh loader 链路：cordis-plugin-loader/lib/index.js:522
//   plugin = this.loader.unwrapExports(await this.parent.tree.import(name))
// unwrapExports = exports.default ?? exports; (处理 __esModule)
//
// ESM namespace 上 apply 是 [[Get]] getter，cordis 0.1.2-rc.1
// isApplicable(namespace) = typeof namespace.apply === 'function' 应该过。
// 实测 v0.3 多次报 "received object"——可能是 tsc 输出 + dynamic import
// 让 namespace 在某条件下是 null / apply undefined。esbuild bundle 单文件
// 同步解析，与 dsh-image-vision 行为一致。

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile: resolve(root, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // 让所有依赖都 inline 成单文件，cordis loader 拿到时 namespace.apply 立即可同步访问
  external: [
    '@deepseek-ai/cordis',  // peer dep 走 loader 注入
    'node:fs',
    'node:path',
    'node:url',
    'node:child_process',
    'node:os',
    'node:process',
    'node:sqlite',  // Node 22.13+ 内置；仅用于旧 workflows.db 一次性导出迁移（storage.ts）
  ],
  logLevel: 'info',
});

console.log('[build:host] ✅ dist/index.js (ESM bundle) built');
