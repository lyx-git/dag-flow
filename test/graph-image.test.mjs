// test/graph-image.test.mjs — 「导出图片」的 SVG 生成（纯函数，2026-10-09 用户需求）
//   用户原话：「导出 json 已经有导出按钮了，导出图片可以集成到一起」。
//   实现路线：自己画 SVG（零依赖；官方 free-export-plugin 未安装、html2canvas 会新增依赖 ✗）→ 浏览器里
//   img+canvas 光栅化成 2 倍 PNG。本文件只测**纯函数部分**（buildGraphSvg / graphInputOf），
//   光栅化与下载在 CDP 里验（test-export-image.mjs）。
const OUT = 'file:///D:/workspace/pluginspace/dag-flow/dist/client.js';

let pass = 0, fail = 0;
const t = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => t(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

// 客户端 bundle 是 IIFE/CJS，不能直接 import 内部模块 → 从源码 bundle 里取不到就跳过？
//   ★ 改为直接编译测试：用 esbuild 把 graphImage.ts 单独打成 ESM 再 import（与其它纯函数用例同款）。
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = 'D:/workspace/pluginspace/dag-flow';
const outfile = path.join(root, 'tmp-test', 'graph-image.test-bundle.mjs');
await build({
  entryPoints: [path.join(root, 'src/client/util/graphImage.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent',
});
const { buildGraphSvg, graphInputOf } = await import(pathToFileURL(outfile).href);
fs.rmSync(outfile, { force: true });

const META = {
  start: { label: '开始', emoji: '▶', color: '#4c8dff' },
  python: { label: 'Python', emoji: '🐍', color: '#22d3ee' },
  if: { label: '条件判断', emoji: '🔀', color: '#fbbf24' },
  end: { label: '结束', emoji: '⏹', color: '#94a3b8' },
};
const metaOf = (type) => META[type];

console.log('== A. 基本结构 ==');
{
  const svg = buildGraphSvg({
    title: '金融政策日报',
    nodes: [
      { id: 'start', type: 'start', x: 0, y: 0 },
      { id: 'py_date', type: 'python', label: '取日期', x: 240, y: 0 },
      { id: 'end', type: 'end', x: 480, y: 0 },
    ],
    edges: [{ from: 'start', to: 'py_date' }, { from: 'py_date', to: 'end' }],
    metaOf,
  });
  t(svg.startsWith('<svg '), 'A1. 产出以 <svg 开头');
  t(svg.endsWith('</svg>'), 'A2. 以 </svg> 结尾');
  t(/width="\d+"/.test(svg) && /height="\d+"/.test(svg), 'A3. 带显式 width/height（img 光栅化需要）');
  t(/viewBox="0 0 \d+ \d+"/.test(svg), 'A4. 带 viewBox');
  t(svg.includes('金融政策日报'), 'A5. 标题写进图里');
  t(svg.includes('3 个节点') && svg.includes('2 条连线'), 'A6. 标题栏统计节点/连线数');
  const rects = (svg.match(/<rect /g) ?? []).length;
  t(rects >= 3, `A7. 每个节点至少一个卡片矩形（rect 数=${rects}）`);
  t(svg.includes('取日期') && svg.includes('py_date'), 'A8. 节点显示名 + id 都在');
  t(svg.includes('#22d3ee'), 'A9. 用到 NODE_PALETTE 的类型色');
  t(svg.includes('▶') && svg.includes('🐍'), 'A10. 带类型图标 emoji');
}

console.log('\n== B. 坐标平移（负坐标也要落进画布内）==');
{
  const svg = buildGraphSvg({
    title: 'w',
    nodes: [{ id: 'a', type: 'start', x: -500, y: -300 }, { id: 'b', type: 'end', x: -200, y: -300 }],
    edges: [{ from: 'a', to: 'b' }],
    metaOf,
  });
  const nums = [...svg.matchAll(/<rect x="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  t(nums.length > 0 && nums.every((n) => n >= 0), `B1. 所有节点矩形 x ≥ 0（实际 ${JSON.stringify(nums.slice(0, 4))}）`);
  const ys = [...svg.matchAll(/<rect [^>]*y="(-?\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  t(ys.every((n) => n >= 0), 'B2. 所有 y ≥ 0');
}

console.log('\n== C. 分支键（when）→ 线上标签 + 配色 ==');
{
  const svg = buildGraphSvg({
    title: 'w',
    nodes: [{ id: 'if1', type: 'if', x: 0, y: 0 }, { id: 'yes', type: 'end', x: 300, y: -60 }, { id: 'no', type: 'end', x: 300, y: 60 }],
    edges: [{ from: 'if1', to: 'yes', when: 'true' }, { from: 'if1', to: 'no', when: 'false' }],
    metaOf,
  });
  t(svg.includes('>true<'), 'C1. true 分支键画成标签');
  t(svg.includes('>false<'), 'C2. false 分支键画成标签');
  t(svg.includes('#10b981') && svg.includes('#f43f5e'), 'C3. true=绿 / false=红（与画布连线标签同色系）');
}
{
  const svg = buildGraphSvg({
    title: 'w',
    nodes: [{ id: 'sw', type: 'if', x: 0, y: 0 }, { id: 'e', type: 'end', x: 300, y: 0 }],
    edges: [{ from: 'sw', to: 'e', when: '*' }],
    metaOf,
  });
  t(svg.includes('>*<') && svg.includes('#fbbf24'), 'C4. 兜底键 * 用琥珀色');
}

console.log('\n== D. XML 转义（工作流名/标签含特殊字符不能破坏 SVG）==');
{
  const svg = buildGraphSvg({
    title: 'A & B <test>',
    nodes: [{ id: 'n1', type: 'start', label: 'x<y & z"q', x: 0, y: 0 }],
    edges: [],
    metaOf,
  });
  t(!/<test>/.test(svg), 'D1. 标题里的 <test> 被转义（不产生裸标签）');
  t(svg.includes('&amp;') && svg.includes('&lt;'), 'D2. & 与 < 都转义');
  t(!/x<y/.test(svg), 'D3. 节点标签里的 < 也转义');
}

console.log('\n== E. 边界：空图 / 缺元信息 ==');
{
  const svg = buildGraphSvg({ title: '', nodes: [], edges: [], metaOf: () => undefined });
  t(/width="\d+"/.test(svg) && /height="\d+"/.test(svg), 'E1. 空图也有非零尺寸（不产出 0×0）');
  t(svg.includes('工作流'), 'E2. 空标题回退成「工作流」');
  const svg2 = buildGraphSvg({ title: 'w', nodes: [{ id: 'x', type: '未知类型', x: 0, y: 0 }], edges: [], metaOf: () => undefined });
  t(svg2.includes('未知类型') && svg2.includes('#64748b'), 'E3. 未知类型用回退色 + 显示 type 名');
}

console.log('\n== F. graphInputOf（ClientNode + layout → 图入参）==');
{
  const nodes = [
    { id: 'a', type: 'start', params: {} },
    { id: 'b', type: 'python', params: {}, label: '取日期' },
  ];
  const r = graphInputOf(nodes, { a: { x: 10, y: 20 } }, [{ x: 0, y: 0 }, { x: 240, y: 0 }], [{ from: 'a', to: 'b' }]);
  eq(r.nodes[0], { id: 'a', type: 'start', x: 10, y: 20 }, 'F1. 有 layout 用 layout');
  eq(r.nodes[1], { id: 'b', type: 'python', label: '取日期', x: 240, y: 0 }, 'F2. 无 layout 用兜底位置；label 带出');
  eq(r.edges, [{ from: 'a', to: 'b' }], 'F3. 边原样带出');
}

console.log(`\n=== graphImage 导出图片（SVG 生成）：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
