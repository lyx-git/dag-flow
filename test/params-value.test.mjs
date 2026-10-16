// test/params-value.test.mjs — 参数弹窗**值层纯函数**的离线单测（2026-10-17 抽出 src/client/params-value.ts 时建立）
//   为什么单独测它：这里正是"行 ↔ params 值"最容易出错的地方 —— 2026-10-17 一天内两次被独立审查抓到高危：
//     ① "改一行"不能让**别行**的值被静默改型（`"0012"`→12、`"true"`→布尔、`"null"` 被删键）
//     ② "删一行"更不能 —— 原判据按**行下标**标记"用户改过"，删行会让其后所有行被误标（C3 就是这两条的锁）
//   手段：esbuild 即时打包纯模块 → 临时 mjs → 断言（无 React / 无 DOM / 无 IO）
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = tmpRoot('df-params-value-');
const OUT = join(dir, 'paramsValue.mjs');
await build({ entryPoints: ['src/client/params-value.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const P = await import(pathToFileURL(OUT).href);
const { toText, valueOfText, rowsFromParams, paramsFromRows, diffPatch, singleLinePlaceholder, looksJsonLike, MULTI_THRESHOLD } = P;

const row = (k, text, extra = {}) => ({ k, text, multi: false, ...extra });

console.log('== A. valueOfText：值文本 → 落盘值（方案 A 自动推断）==');
{
  eq(valueOfText('12'), 12, 'A1. 纯数字样 ⇒ 数字');
  eq(valueOfText('-1.5e3'), -1500, 'A2. 带小数/科学计数 ⇒ 数字');
  eq(valueOfText('true'), true, 'A3. true ⇒ 布尔');
  eq(valueOfText('false'), false, 'A4. false ⇒ 布尔');
  eq(valueOfText('null'), null, 'A5. null ⇒ null（def 里＝删键语义）');
  eq(valueOfText('{"x":1}'), { x: 1 }, 'A6. 合法 JSON 对象 ⇒ 对象');
  eq(valueOfText('[1,2]'), [1, 2], 'A7. 合法 JSON 数组 ⇒ 数组');
  eq(valueOfText('hello'), 'hello', 'A8. 普通文本 ⇒ 原文字符串');
  eq(valueOfText(' 12 '), ' 12 ', 'A9. ★有首尾空白 ⇒ 不猜类型，按原文存');
  eq(valueOfText(''), '', 'A10. 空串 ⇒ 空串');
}

console.log('== B. rowsFromParams：行装配（自动补行 / 示例占位 / 多行形态）==');
{
  const rows = rowsFromParams({ a: 'x', long: 'y'.repeat(MULTI_THRESHOLD + 1), code: 'print(1)' }, 'python');
  eq(rows.map((r) => r.k), ['a', 'long', 'code', 'codePath'], 'B1. ★登记 codeLang 时自动补一行 codePath（auto 行）');
  eq(rows.find((r) => r.k === 'codePath').auto, true, 'B2. codePath 行标 auto（留空不写进 def）');
  eq(rows.find((r) => r.k === 'long').multi, true, `B3. 超过 MULTI_THRESHOLD=${MULTI_THRESHOLD} 的行默认多行框`);
  eq(rows.find((r) => r.k === 'code').multi, true, 'B4. code 行默认多行框');
  eq(rows.find((r) => r.k === 'a').multi, false, 'B5. 短文本默认单行框');
  eq(rows.find((r) => r.k === 'a').orig, 'x', 'B6. ★每行都记下从 def 读出的原值 orig（回写判据靠它）');

  const hinted = rowsFromParams({}, undefined, { images: '说明' }, { images: 'a.png\nb.png' });
  eq(hinted.map((r) => r.k), ['images'], 'B7. ★fieldHints 里登记而 def 里没有的键 ⇒ 自动补一行');
  eq(hinted[0].placeholder, 'a.png\nb.png', 'B8. 补出的行带上示例占位');
  eq(hinted[0].multi, true, 'B9. ★登记了示例的行默认多行框（否则示例与「🖼 选图」工具栏会一起消失）');
  const kept = rowsFromParams({ images: '' }, undefined, { images: '说明' }, { images: 'a.png' });
  eq(kept.length, 1, 'B10. 键已存在于 def ⇒ 不重复补行');
  eq(kept[0].placeholder, 'a.png', 'B11. ★键存在时示例占位仍在（用户「重启了还是没改好」的真因）');
}

console.log('== C. paramsFromRows：只对"文本确实被改过"的行做推断（★★ 两条高危的回归锁）==');
{
  // 原始 def：四个**字符串**值，其中三个"长得像数字/布尔/null"
  const base = [
    row('a', 'plain', { orig: 'plain' }),
    row('b', '0012', { orig: '0012' }),
    row('c', 'null', { orig: 'null' }),
    row('d', 'true', { orig: 'true' }),
  ];
  eq(paramsFromRows(base), { a: 'plain', b: '0012', c: 'null', d: 'true' }, 'C1. 什么都没改 ⇒ 四个字符串原样（不被改型、null 行不丢键）');
  const onlyA = base.map((r) => (r.k === 'a' ? { ...r, text: 'plain2' } : r));
  eq(paramsFromRows(onlyA), { a: 'plain2', b: '0012', c: 'null', d: 'true' }, 'C2. ★只改 a ⇒ b/c/d 仍原样（原 bug：b→12、d→true、c 被删键）');
  // ★★ 删掉第一行：剩下三行的文本与 orig 都没动 ⇒ 必须原样（原判据按下标对齐 ⇒ 全部被误标"改过"）
  eq(paramsFromRows(onlyA.slice(1)), { b: '0012', c: 'null', d: 'true' }, 'C3. ★★删掉第一行 ⇒ 其后各行仍原样（原 bug：下标错位把它们全当"改过"）');
  // 真改了才推断
  const bNum = base.map((r) => (r.k === 'b' ? { ...r, text: '99' } : r));
  eq(paramsFromRows(bNum), { a: 'plain', b: 99, c: 'null', d: 'true' }, 'C4. 真把文本改成 99 ⇒ 才推断成数字（其余行不受影响）');
  // 改一下又改回原样 ⇒ 仍按原值（没有粘性标记）
  eq(paramsFromRows(base.map((r) => (r.k === 'b' ? { ...r, text: '0012' } : r))), { a: 'plain', b: '0012', c: 'null', d: 'true' }, 'C5. ★改一下又改回原样 ⇒ 仍按原值回写（无粘性标记）');
  // auto 行留空不写进 def
  eq(Object.prototype.hasOwnProperty.call(paramsFromRows([...base, row('images', '', { auto: true, multi: true })]), 'images'), false, 'C6. auto 行留空 ⇒ 不写进 params（不产生 `"images": ""` 脏值）');
  eq(paramsFromRows([...base, row('  ', 'x')]), { a: 'plain', b: '0012', c: 'null', d: 'true' }, 'C7. 空名字的行被忽略');
  eq(paramsFromRows([row('o', '{"x":1}', { orig: 'old' })]), { o: { x: 1 } }, 'C8. 文本是合法 JSON 对象 ⇒ 存成对象');
  eq(paramsFromRows([row('s', ' 有空格 ', { orig: 'x' })]), { s: ' 有空格 ' }, 'C9. 有首尾空白 ⇒ 按原文存字符串');
  eq(paramsFromRows([]), {}, 'C10. 空行列表 ⇒ 空对象');
}

console.log('== D. diffPatch：差异补丁（被删的键传 null）==');
{
  eq(diffPatch({ a: 1, b: 2 }, { a: 1, b: 3 }), { a: 1, b: 3 }, 'D1. 改值 ⇒ 补丁带全部新键值');
  eq(diffPatch({ a: 1, b: 2 }, { a: 1 }), { a: 1, b: null }, 'D2. ★新对象里没有的键 ⇒ 传 null（= 删键语义）');
  eq(diffPatch({}, { x: 9 }), { x: 9 }, 'D3. 新增键');
  eq(diffPatch({}, {}), {}, 'D4. 都没变 ⇒ 空补丁');
}

console.log('== E. 其它小函数 ==');
{
  eq(toText('s'), 's', 'E1. 字符串原样');
  eq(toText(null), '', 'E2. null ⇒ 空串（＝"没有值"）');
  eq(toText(12), '12', 'E3. 数字 ⇒ 文本');
  eq(toText({ a: 1 }), '{\n  "a": 1\n}', 'E4. 对象 ⇒ 缩进 JSON（便于编辑）');
  eq(singleLinePlaceholder({ k: 'x', text: '', multi: false, placeholder: 'a.png\nb.png' }), 'a.png b.png', 'E5. 单行占位把多行示例折成一行');
  eq(singleLinePlaceholder({ k: 'x', text: '', multi: false }), '值', 'E6. 没登记示例 ⇒ 通用占位');
  eq(looksJsonLike('{"a":1}'), true, 'E7. 对象文本 ⇒ JSON 高亮');
  eq(looksJsonLike('[1]'), true, 'E8. 数组文本 ⇒ JSON 高亮');
  eq(looksJsonLike('12'), false, 'E9. 数字不是 JSON 对象/数组');
  eq(looksJsonLike('hello'), false, 'E10. 普通文本不是 JSON');
}

console.log(`\n结果：${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
