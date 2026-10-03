// scripts/build-client.mjs
// esbuild 打包脚本 —— 把 src/client/index.tsx 打成 dist/client.js
//
// 协议：window.__ModuleLoader__.load({ id, factory: (require) => ... })
//   复用 dsh-genui / dsh-memory-evolve 的 esbuild 模式：
//   - react / react-dom / react-dom/client 走 external（DSH loader 注入，避免 dual-React）
//   - reactflow + zustand + 业务代码 inline
//   - reactflow/dist/style.css 通过 dsh-css-inject plugin 转成运行时 <style> 注入
//   - target es2020, format cjs, minify in production, watch mode on --watch
//
// 2026-09-06 修复（"received object" 根因）：
//   format 从 'iife' 改为 'cjs' —— iife + 无 globalName 时 esbuild 会把 entry 的
//   exports 丢弃（只生成局部变量不挂 module.exports），factory 返回空对象导致
//   DSH loader 报 `invalid plugin ... received object`。cjs 格式下 esbuild 自动生成
//   `module.exports = __toCommonJS(index_exports)`（与 dsh-memory-evolve lib/client.js
//   完全同构），footer 的 `return module.exports` 才能拿到带 apply/inject/mount 的对象。

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = join(ROOT, 'dist');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const PLUGIN_ID = PKG.name;

const args = new Set(process.argv.slice(2));
const isWatch = args.has('--watch');
const isProd = process.env.NODE_ENV === 'production' || !args.has('--dev');

// DSH loader 协议的 banner + footer
const banner = {
  js: [
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
  ].join('\n'),
};
const footer = {
  js: 'return module.exports; } });',
};

// React 全家桶 + peer dep 走 external（DSH loader 会注入）
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
];

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [join(ROOT, 'src/client/index.tsx')],
  outfile: join(OUT, 'client.js'),
  bundle: true,
  format: 'cjs',
  target: ['es2020'],
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: true,
  minify: isProd,
  treeShaking: true,
  loader: {
    '.css': 'text',
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.woff2': 'file',
  },
  external: EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
  },
  // CSS 文件转成运行时 <style> 注入（不依赖外部 link）
  plugins: [
    {
      name: 'dsh-css-inject',
      setup(b) {
        b.onLoad({ filter: /\.css$/, namespace: 'file' }, async (args) => {
          const css = readFileSync(args.path, 'utf8');
          return {
            contents: `(() => { if (typeof document === 'undefined') return; const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; s.setAttribute('data-source', ${JSON.stringify(PLUGIN_ID)}); document.head.appendChild(s); })();`,
            loader: 'js',
          };
        });
      },
    },
  ],
  logLevel: 'info',
  banner,
  footer,
};

async function run() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[build-client] watching for changes…');
  } else {
    await esbuild.build(buildOptions);
    console.log(`[build-client] ✓ dist/client.js ${isProd ? '(minified)' : '(dev)'}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
