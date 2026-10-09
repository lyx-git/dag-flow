// test/result-tip.test.mjs — 节点「最终执行结果」悬浮卡内容模型单测（2026-10-03 用户需求）
// 需求原话：「每个节点执行完最好有个最终执行结果可以在节点上看，无论失败还是成功，方便定位，
//   可以是悬浮查看」。
// 手段：esbuild 即时打包 src/client/resultTip.ts → 临时 mjs → 断言（纯函数，无 React/无 IO/无 CDP）。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-result-tip-'));
const OUT = join(dir, 'resultTip.mjs');
await build({
  entryPoints: ['src/client/resultTip.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { tipModel, previewOut, tipFullText } = await import(pathToFileURL(OUT).href);

const kinds = (m) => m.lines.map((l) => l.kind);
const texts = (m) => m.lines.map((l) => l.text).join('\n');

console.log('== A. 没跑过 / 成功 ==');
eq(tipModel(undefined, { label: 'L', id: 'n1' }), null, 'A1. 无运行结果 → 不弹（null）');
eq(tipModel({ status: 'pending' }, { label: 'L', id: 'n2' }), null, 'A1b. ★待运行（还没跑到）→ 不弹（2026-10-08 用户要求：没执行的不用浮窗）');
eq(tipModel({ status: 'running' }, { label: 'L', id: 'n3' }), null, 'A1c. ★运行中 → 也不弹（用户要的是"最终执行结果"）');
{
  const m = tipModel({ status: 'success', durationMs: 120, out: 'hello' }, { label: '取日期', id: 'py_date' });
  eq(m.badge, '✓ 成功 · 120ms', 'A2. 成功徽标含耗时');
  eq(m.badgeKind, 'ok', 'A3. badgeKind=ok');
  eq(m.title, '取日期 · py_date', 'A4. 标题=显示名 · 节点id');
  eq(m.lines.length, 1, 'A5. 只有输出一行');
  eq(m.lines[0].kind, 'code', 'A6. 输出行 kind=code');
  eq(m.lines[0].text, 'hello', 'A7. 字符串 out 原样展示（python/bash 的 out 就是纯文本）');
}
{
  const m = tipModel({ status: 'success', out: null }, { label: 'L', id: 'n' });
  eq(m.badge, '✓ 成功', 'A8. 无 durationMs 时不写耗时');
  ok(texts(m).includes('本次无输出'), 'A9. 成功但无输出 → 明确写「本次无输出」');
}

console.log('== B. 失败 / 失败但已容错（A 方案开关）==');
{
  const m = tipModel({ status: 'failed', durationMs: 3400, error: { code: 'FETCH_FAILED', message: '请求异常: HTTP 403' }, out: { error: { code: 'FETCH_FAILED' } } }, { label: '抓取', id: 'fetch_cctv' });
  eq(m.badge, '✕ 失败 · 3400ms', 'B1. 硬失败徽标');
  eq(m.badgeKind, 'err', 'B2. badgeKind=err');
  eq(m.lines[0].kind, 'err', 'B3. 首行是错误行');
  ok(m.lines[0].text.startsWith('FETCH_FAILED：'), 'B4. 错误行 = code：message');
  ok(!texts(m).includes('已容错'), 'B5. 未容错时不写「已容错」');
}
{
  const m = tipModel({ status: 'failed', durationMs: 3400, tolerated: true, error: { code: 'FETCH_FAILED', message: 'HTTP 403' } }, { label: '抓取', id: 'fetch_cctv' });
  eq(m.badgeKind, 'warn', 'B6. 已容错 → badgeKind=warn（琥珀，不是红色）');
  ok(m.badge.includes('已容错'), 'B7. 徽标写明「已容错」');
  ok(kinds(m).includes('warn'), 'B8. 有一行 warn 说明');
  ok(texts(m).includes('后续节点照常执行'), 'B9. 容错说明写清后果（没有中断工作流）');
}
{
  const m = tipModel({ status: 'failed', tolerated: true }, { label: 'L', id: 'n' });
  eq(kinds(m), ['warn'], 'B10. 容错失败且无 error 信息 → 只有容错说明行');
}

console.log('== C. 跳过 ==');
{
  const m = tipModel({ status: 'skipped' }, { label: 'L', id: 'n' });
  eq(m.badgeKind, 'muted', 'C1. skipped → muted');
  ok(m.badge.includes('跳过'), 'C2. 徽标写「跳过（未执行）」');
  ok(texts(m).includes('未执行：'), 'C3. 说明为什么没跑（分支未激活/上游失败被跳过）');
}

// ★ 2026-10-04 用户反馈「定时任务自动触发的运行，手动确认节点自动跳过」→ 拍板 A：保持自动通过，但**显形**
console.log('== C2. 人工确认「自动通过」（非交互运行）要显形 ==');
{
  const auto = tipModel(
    { status: 'success', durationMs: 3, out: { prompt: '继续生成日报？', confirmed: true, autoPassed: true, value: '', confirmedAt: '2026-10-04T01:00:00.000Z' } },
    { label: '人工确认', id: 'manual_ok' },
  );
  ok(texts(auto).includes('⏭ 自动通过'), 'C2a. 悬浮卡写明「⏭ 自动通过」（实际：' + texts(auto).slice(0, 80) + '）');
  ok(texts(auto).includes('非交互运行'), 'C2b. 说明原因：这次是非交互运行（定时/立即运行一次/CLI/子工作流内部）');
  ok(texts(auto).includes('不代表有人确认过'), 'C2c. 明确"不是失败、也不代表有人确认过"（避免误判成确认节点坏了）');
  ok(texts(auto).includes('画布上点 ▶ 运行'), 'C2d. 给出正确做法（要人工把关就手动运行）');
  ok(!texts(auto).includes('已容错'), 'C2e. 自动通过不等于容错（不串标签）');
  eq(auto.badgeKind, 'ok', 'C2f. 自动通过仍是成功态（不是失败/警告）');
  // 真的有人确认过（interactive 运行）→ 不应出现「自动通过」
  const real = tipModel({ status: 'success', durationMs: 900, out: { prompt: '继续？', confirmed: true, autoPassed: false, value: '已核对' } }, { label: '人工确认', id: 'manual_ok' });
  ok(!texts(real).includes('自动通过'), 'C2g. 有人真确认过时不写「自动通过」');
}

console.log('== D. 输出预览（截断 / JSON / 循环次数）==');
eq(previewOut(undefined), '', 'D1. undefined → 空串');
eq(previewOut(null), '', 'D2. null → 空串');
ok(previewOut({ a: 1 }).includes('\n  "a": 1'), 'D3. 对象 → 2 空格缩进 JSON（可读）');
{
  const long = 'x'.repeat(900);
  const p = previewOut(long);
  ok(p.length < 900 && p.includes('共 900 字'), 'D4. 超长输出截断并注明总字数');
  ok(p.includes('完整内容见运行历史'), 'D5. 截断时给出去哪儿看完整内容');
}
{
  const m = tipModel({ status: 'success', durationMs: 10, count: 7, out: { count: 7 } }, { label: '遍历', id: 'lp' });
  ok(texts(m).includes('循环迭代：7 次'), 'D6. loop 节点的实际迭代次数也进悬浮卡');
}
{
  // 数值 out：JSON.stringify(0) = '0'，不能被当成「空输出」漏掉
  const m = tipModel({ status: 'success', out: 0 }, { label: 'L', id: 'n' });
  eq(m.lines[0].text, '0', 'D7. out=0 正常展示（不误判为空）');
}

console.log('== E. 📋 复制全文（2026-10-03 用户反馈「无法把鼠标移动到浮窗上复制错误」）==');
{
  const m = tipModel({ status: 'failed', durationMs: 77, error: { code: 'MAIL_SKIPPED_NO_SMTP', message: '未配置 SMTP：找过 A | B；cwd=X' } }, { label: '发邮件', id: 'mail' });
  const t = tipFullText(m);
  ok(t.startsWith('发邮件 · mail'), 'E1. 全文首行是标题');
  ok(t.includes('✕ 失败 · 77ms'), 'E2. 带状态徽标（含耗时）');
  ok(t.includes('MAIL_SKIPPED_NO_SMTP：未配置 SMTP：找过 A | B；cwd=X'), 'E3. 完整错误码+消息一行不丢（复制的是原文，不是截断预览）');
  eq(t.split('\n').length, 2 + m.lines.length, 'E4. 行数 = 标题 + 徽标 + 各说明行');
  const long = tipModel({ status: 'success', out: { a: 'y'.repeat(1200) } }, { label: 'L', id: 'n' });
  ok(tipFullText(long).includes('共') && tipFullText(long).length < 1200, 'E5. 超长输出仍走截断口径（复制内容与卡片所见一致）');
}

console.log(`\n=== resultTip 悬浮卡内容模型：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
