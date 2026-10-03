// test/schema-next.test.mjs — 分支键 next（case 映射）schema 契约 + 校验报错质量
// 背景（2026-10-02 用户报错）：switch 节点 next 为 { case值: 目标节点id } 时，
//   WORKFLOW_SCHEMA.next.oneOf 只认 string/array/{true,false}/null → 画布保存过的 switch 工作流全部跑不起来。
//   画布 fromRF 每次变更都会重新生成 case 映射，AI prompt 也要求模型产出这种形状 → schema 是唯一的少数派。
// 锁定两条契约：
//   A. schema 接受 { 分支键: 目标 } 对象（并与 if 的 {true,false} 共存——oneOf 必须恰好命中一个分支）
//   B. 校验报错折叠成一条人话：不再「一个根因喷 9 条」，且位置带「显示名_id(类型)」
// 手段：esbuild 即时打包 src/executor/parse.ts → 临时 mjs → 直接调 parseAndValidate
import { build } from 'esbuild';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'dag-flow-schema-next-'));
const OUT = join(tmp, 'parse.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/executor/parse.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  logLevel: 'silent',
});
const { parseAndValidate, nodeTag } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
/** 跑一次校验，返回错误消息（通过则返回 null） */
function errOf(def) {
  try { parseAndValidate(def); return null; } catch (e) { return String(e?.message ?? e); }
}

const DISPLAY_LABEL = '多路分支：运行模式';
/** switch 节点工作流；next 可指定为任意值 */
const switchWf = (next, nodeExtra = {}) => ({
  name: 'schema-next',
  version: 1,
  nodes: [
    { id: 'start', type: 'start', next: 'sw' },
    { id: 'sw', type: 'switch', label: DISPLAY_LABEL, params: { value: 'prep_vars.mode', cases: { quick: 'a', full: 'b' } }, next, ...nodeExtra },
    { id: 'a', type: 'log', params: { level: 'info', message: 'a' }, next: 'end' },
    { id: 'b', type: 'log', params: { level: 'info', message: 'b' }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
});
/** if 节点工作流 */
const ifWf = (next) => ({
  name: 'schema-if',
  version: 1,
  nodes: [
    { id: 'start', type: 'start', next: 'cond' },
    { id: 'cond', type: 'if', label: '是否有搜索结果', params: { expr: 'web_search1.count > 0' }, next },
    { id: 'a', type: 'log', params: { level: 'info', message: 'a' }, next: 'end' },
    { id: 'b', type: 'log', params: { level: 'info', message: 'b' }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
});

console.log('\n[A] schema 接受的分支键形状');
t('A1. switch case 映射 {quick,full} → 通过', errOf(switchWf({ quick: 'a', full: 'b' })) === null, errOf(switchWf({ quick: 'a', full: 'b' })) ?? '');
t('A2. if {true,false} → 通过（oneOf 恰好命中一个分支，未被新分支撞车）',
  errOf(ifWf({ true: 'a', false: 'b' })) === null, errOf(ifWf({ true: 'a', false: 'b' })) ?? '');
t('A3. case 含 "*" 兜底键 → 通过', errOf(switchWf({ quick: 'a', '*': 'b' })) === null);
t('A4. string next → 通过', errOf(switchWf('end')) === null);
t('A5. array next → 通过', errOf(switchWf(['a', 'b'])) === null);
t('A6. next: null → 通过', errOf(switchWf(null)) === null);
t('A7. 真实演示文件（画布保存过的 switch）→ 通过', (() => {
  const p = join(ROOT, '..', '.dag-flow', 'workflow', '全节点演示-技术简报.json');
  if (!existsSync(p)) { console.log('    (跳过：演示文件不存在)'); return true; }
  const e = errOf(JSON.parse(readFileSync(p, 'utf8')));
  t('A7-detail. 演示文件校验无错', e === null, e ?? '');
  return e === null;
})());

console.log('\n[B] 非法 next 的报错质量（折叠 + 显示名_id）');
{
  const e = errOf(switchWf(123)) ?? '';
  t('B1. 非对象/数组/字符串 → 报「结构不符合任一允许的形式」', e.includes('结构不符合任一允许的形式'), e);
  t('B2. 带允许形式提示', e.includes('{ 分支键: 目标节点id } 对象'), e);
  t('B3. 位置带显示名_id(类型)', e.includes(`${DISPLAY_LABEL}_sw(switch)`), e);
  t('B4. 不再喷 9 条（单根因单条消息）', !e.includes('缺少必填字段 "true"') && (e.match(/；/g) ?? []).length === 0, e);
}
{
  const e = errOf(switchWf({ a: 1 })) ?? '';
  t('B5. 分支值非字符串 → 折叠报错', e.includes('结构不符合任一允许的形式') && e.includes('_sw'), e);
}
{
  const e = errOf(switchWf({})) ?? '';
  t('B6. 空对象 {} → 报错（minProperties 1）', e.includes('结构不符合任一允许的形式'), e);
}
{
  const e = errOf(switchWf({ quick: 'a' }, { onError: 'nope' })) ?? '';
  t('B7. onError 非法 → 折叠 + onError 允许形式提示', e.includes('结构不符合任一允许的形式') && e.includes('"stop" / "continue"'), e);
  t('B8. onError 与 next 两类错误分别成条（不互相吞）', (e.match(/结构不符合任一允许的形式/g) ?? []).length === 1, e);
}
{
  const e = errOf({ name: 123, version: 1, nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }] }) ?? '';
  t('B9. 非节点路径保留 JSON Pointer 原样（不伪造成「节点」）', e.includes('/name') && e.includes('类型必须是 string'), e);
}
{
  t('B10. nodeTag：label=id 时退化为 id，缺 id 用 fallback',
    nodeTag({ id: 'x', label: 'x' }) === 'x' && nodeTag({ id: 'x', label: '显示名' }) === '显示名_x' && nodeTag(undefined, '#3') === '#3');
}

console.log(`\n=== schema-next: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
