// test/decorations.test.mjs — 画布装饰（分组框/便签）纯函数契约（2026-10-04 用户拍板方案 A）
// 契约（本文件钉死）：
//   ① def.canvas ↔ 画布 RF 节点 双向转换稳定（round-trip 逐字段一致；缺省值补齐）
//   ② 装饰类型判据 isDecoType 只认 deco-group / deco-note
//   ③ memberNodeIds = 几何包含（节点**中心**在框内才算成员）
//   ④ 便签配色 → 文字色可读（浅底配深字）
// 手段：esbuild 即时打包 src/client/flowgram/decorations.ts → 断言（纯函数，无 React/无 DOM）
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-deco-'));
const OUT = join(dir, 'deco.mjs');
await build({ entryPoints: ['src/client/flowgram/decorations.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const d = await import(pathToFileURL(OUT).href);

console.log('== A. 类型判据 ==');
ok(d.isDecoType('deco-group') && d.isDecoType('deco-note'), 'A1. 认 deco-group / deco-note');
ok(!d.isDecoType('log') && !d.isDecoType('') && !d.isDecoType(undefined) && !d.isDecoType(null), 'A2. 其它类型（含空值）一律不算装饰');

console.log('== B. def.canvas → 画布节点 ==');
{
  const rf = d.decorationsToRF({
    canvas: {
      groups: [{ id: 'g1', title: '抓取组', x: 10, y: 20, width: 300, height: 200, color: '#34d399' }],
      comments: [{ id: 'n1', text: '备注', x: 5, y: 6, color: '#9ecbff', collapsed: true, width: 200 }],
    },
  });
  eq(rf.length, 2, 'B1. 框 + 便签各生成一个画布节点');
  eq(rf[0].type, 'deco-group', 'B2. 框的类型是 deco-group');
  eq(rf[0].position, { x: 10, y: 20 }, 'B3. 位置取自 canvas');
  eq(rf[0].data.title, '抓取组', 'B4. 标题进 data');
  eq(rf[1].type, 'deco-note', 'B5. 便签类型 deco-note');
  eq(rf[1].data.collapsed, true, 'B6. 折叠状态进 data');
}
{
  const rf = d.decorationsToRF({ canvas: { groups: [{ id: 'g2', x: 0, y: 0 }] } });
  eq(rf[0].data.width, d.GROUP_DEFAULT_W, 'B7. 缺 width 时补默认尺寸（不让 UI 崩）');
  eq(d.decorationsToRF({}).length, 0, 'B8. 没有 canvas → 空列表（不抛）');
  eq(d.decorationsToRF({ canvas: {} }).length, 0, 'B9. 空 canvas → 空列表');
}

console.log('== C. 画布节点 → def.canvas（round-trip）==');
{
  const canvas = {
    groups: [{ id: 'g1', title: 'A', x: 1, y: 2, width: 300, height: 200, color: '#4f8cff' }],
    comments: [{ id: 'n1', text: 'hello', x: 3, y: 4, color: '#ffd977', collapsed: false, width: 190 }],
  };
  const back = d.decorFromRF(d.decorationsToRF({ canvas }));
  eq(back, canvas, 'C1. canvas → RF → canvas 逐字段一致（位置/尺寸/文字/颜色/折叠）');
  const rounded = d.decorFromRF([{ id: 'g9', type: 'deco-group', position: { x: 10.6, y: 20.4 }, data: {} }]);
  eq(rounded.groups[0].x, 11, 'C2. 位置取整（避免浮点噪声进 JSON）');
  ok(rounded.groups[0].width === d.GROUP_DEFAULT_W && rounded.groups[0].title === '', 'C3. 缺字段补默认值');

  const tiny = d.decorFromRF([{ id: 'g8', type: 'deco-group', position: { x: 0, y: 0 }, data: { width: 1, height: 1 } }]);
  eq([tiny.groups[0].width, tiny.groups[0].height], [80, 60], 'C4. 尺寸有下限（拖到 0 也能再拖回来）');
}

console.log('== D. 拖动框时"谁是成员"（几何包含）==');
{
  const box = { x: 0, y: 0, width: 300, height: 200 };
  const nodes = [
    { id: 'inside', x: 100, y: 80, width: 100, height: 60 },      // 中心 (150,110) 在内
    { id: 'outside', x: 400, y: 300, width: 100, height: 60 },    // 中心在外
    { id: 'edge-just-inside', x: 270, y: 170, width: 20, height: 20 }, // 中心 (280,180) 在内
    { id: 'half-overlap', x: 280, y: 30, width: 100, height: 60 },     // 中心 (330,60) 在外（虽有一半压着框）
  ];
  eq(d.memberNodeIds(box, nodes), ['inside', 'edge-just-inside'], 'D1. 只有**中心**落在框内的节点算成员（半压着框的不算）');
  eq(d.memberNodeIds(box, []), [], 'D2. 没有节点 → 空');
  eq(d.memberNodeIds(box, [{ id: 'p', x: 10, y: 10 }]), ['p'], 'D3. 拿不到尺寸时按点算（左上角在框内即算）');
}

console.log('== E. 配色可读性 ==');
ok(d.NOTE_COLORS.length >= 3 && d.GROUP_COLORS.length >= 3, 'E1. 便签/分组框都有多套配色');
ok(d.noteTextColor('#9ecbff') === '#10233a' && d.noteTextColor('#ffd977') === '#2a2410', 'E2. 浅底配深字（保证可读）');
ok(/^#[0-9a-f]{6}$/.test(d.noteTextColor(undefined)), 'E3. 配色缺失也有确定的文字色');

console.log(`\n=== decorations: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
