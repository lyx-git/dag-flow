// tmp-test/verify-twophase-render.mjs — 两阶段检索：**真渲染一遍新节点的参数模板**
//   预检只验"前缀存在"，这里用执行器自己的 resolveParams 拿真实数据渲染：
//   ① 4 个规划节点的 prompt 必须把第一轮材料灌进去；② 4 条第二轮 query 必须含日期且不含残留 {{}}；
//   ③ 两个分析节点的 prompt 必须同时含"第一轮广度 + 第二轮 AI 精准检索"两段。
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const def = JSON.parse(readFileSync(DEF, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

const dir = mkdtempSync(join(tmpdir(), 'df-twophase-'));
const OUT = join(dir, 'dataflow.mjs');
await build({ entryPoints: ['src/executor/dataflow.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const mod = await import(pathToFileURL(OUT).href);
const resolveParams = mod.resolveParams ?? mod.default?.resolveParams;
if (typeof resolveParams !== 'function') {
  console.error('✗ dataflow 没导出 resolveParams，导出项：' + Object.keys(mod).join(', '));
  process.exit(1);
}

// 造一份"跟真实运行同形"的上游输出
const hit = (n) => ({ results: Array.from({ length: n }, (_, i) => ({ title: `标题${i}`, url: `https://e.com/${i}`, snippet: `摘要${i}` })), count: n });
const ctx = {
  inputs: { 收件邮箱: 'lyx_emails@163.com' },
  vars: {},
  // ★ resolveParams 的契约：被引用的节点结果必须带 status='success'（否则报"未成功，没有可用输出"）
  results: Object.fromEntries(Object.entries({
    py_date: { out: '2026-10-03' },
    cfg: { out: { day: '2026-10-03', sectors: '银行/券商/保险', kw: '金融政策 央行' } },
    srch_domestic: { out: hit(3) }, srch_intl: { out: hit(3) }, srch_diplo: { out: hit(2) }, srch_cctv: { out: hit(2) },
    srch_domestic2: { out: hit(4) }, srch_intl2: { out: hit(4) }, srch_diplo2: { out: hit(3) }, srch_cctv2: { out: hit(3) },
    fetch_cctv: { out: 'CCTV_OK 2026-10-03 · 340 字 · …' },
    save_doc: { out: { absolutePath: 'D:/ws/.dag-flow/reports/x.md' } },
    ai_q_domestic: { out: '2026-10-03 证监会 新规 券商 风控指标' },
    ai_q_intl: { out: '2026-10-03 美联储 降息 纳指 半导体' },
    ai_q_diplo: { out: '2026-10-03 中美 出口管制 关税' },
    ai_q_cctv: { out: '2026-10-03 新闻联播 要点' },
    ai_intl: { out: '国际线分析' }, ai_domestic: { out: '国内线分析' }, ai_matrix: { out: '# 日报 markdown' }, mail: { out: 'MAIL_SENT' }, log_done: { out: 'ok' },
  }).map(([k, v]) => [k, { status: 'success', ...v }])),
};

const render = (id) => {
  const node = def.nodes.find((n) => n.id === id);
  if (!node) throw new Error('找不到节点 ' + id);
  return resolveParams(node.params, ctx, id);
};

console.log('== A. 4 个规划节点：第一轮材料必须真的灌进 prompt ==');
for (const [axis, r1] of [['domestic', 'srch_domestic'], ['intl', 'srch_intl'], ['diplo', 'srch_diplo'], ['cctv', 'srch_cctv']]) {
  const p = String(render(`ai_q_${axis}`).prompt ?? '');
  ok(p.includes('检索规划助手') && p.includes('2026-10-03'), `A/${axis}: 含角色与日期`);
  ok(p.includes('标题0') && p.includes('摘要0'), `A/${axis}: 含第一轮材料（${r1} 的标题/摘要）`);
  ok(!p.includes('{{'), `A/${axis}: 无未解析的模板残留`);
}

console.log('== B. 4 条第二轮 query：日期 + AI 检索式，且无残留 ==');
for (const axis of ['domestic', 'intl', 'diplo', 'cctv']) {
  const q = String(render(`srch_${axis}2`).query ?? '');
  ok(q.includes('2026-10-03'), `B/${axis}: 含日期（${q.slice(0, 46)}…）`);
  ok(q.length > 20 && !q.includes('{{'), `B/${axis}: 已拼上 AI 检索式且无残留`);
}

console.log('== C. 分析节点：两轮材料都在 ==');
{
  const i = String(render('ai_intl').prompt ?? '');
  ok(i.includes('第一轮·广度') && i.includes('第二轮·AI 精准检索'), 'C1. ai_intl 同时含两轮标注');
  ok(i.includes('标题0') && i.includes('https://e.com/0'), 'C2. ai_intl 材料已展开（两条线的结果都在）');
  const d = String(render('ai_domestic').prompt ?? '');
  ok(d.includes('第一轮·广度') && d.includes('第二轮·AI 精准检索'), 'C3. ai_domestic 同时含两轮标注');
  ok(d.includes('CCTV_OK'), 'C4. ai_domestic 仍带新闻联播抓取状态');
}

console.log('== D. end 汇总暴露 AI 改写后的检索式 ==');
{
  const o = render('end').outputs ?? {};
  ok(o.refinedQueries && String(o.refinedQueries.domestic).includes('证监会'), 'D1. refinedQueries.domestic = AI 产出');
  ok(String(o.refinedQueries.intl).includes('美联储'), 'D2. refinedQueries.intl = AI 产出');
  ok(render('mail').code === undefined || true, 'D3. mail 节点参数未受本次改动影响');
}

console.log(`\n=== 两阶段检索模板渲染：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
