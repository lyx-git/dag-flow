// tmp-test/verify-fin-daily-v2-prompts.mjs — 验证最后未测的一环：材料真的注入了 AI 提示词
//   取最新一次运行记录里的 py_* 产物 → 用执行器自己的 resolveParams 真渲染 ai_* 提示词
//   （ai_final 的 {{ai_x.out}} 用占位串补上，因为那次运行把 AI 换成了 log）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const SRC = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const RUNS = 'D:/workspace/pluginspace/.dag-flow/runs';

const files = readdirSync(RUNS).filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, m: statSync(join(RUNS, f)).mtimeMs })).sort((a, b) => b.m - a.m);
const rec = JSON.parse(readFileSync(join(RUNS, files[0].f), 'utf8'));
const results = rec.results ?? rec.summary?.results ?? {};
console.log(`运行记录 ${files[0].f}｜节点 ${Object.keys(results).length}`);

// 造与真实运行同形的 ctx（resolveParams 要求被引用节点带 status:'success'）
const ctx = {
  inputs: JSON.parse(readFileSync(SRC, 'utf8')).inputs ?? {},
  vars: {},
  results: Object.fromEntries(Object.entries(results).map(([id, r]) => [id, { status: r.status, out: r.out }])),
  signal: undefined, runId: 'verify', interactive: false, logger: console,
};
// 补上 AI 节点的占位产物（那次运行 AI 被换成了 log）
for (const id of ['ai_policy', 'ai_money', 'ai_stock', 'ai_fund', 'ai_fx', 'ai_bank', 'ai_intl', 'ai_cctv']) {
  ctx.results[id] = { status: 'success', out: `（${id} 占位结论：核心事实 1/2/3；影响方向中性；关注板块 X；数据缺口 无）` };
}

const out = 'tmp-test/_fin-daily-v2/_dataflow.mjs';
const r = await build({
  entryPoints: ['src/executor/dataflow.ts'], bundle: true, format: 'esm',
  platform: 'node', outfile: out, logLevel: 'silent',
});
if (r.errors?.length) { console.log('打包失败', r.errors); process.exit(1); }
const { resolveParams } = await import(pathToFileURL(out).href);

const def = JSON.parse(readFileSync(SRC, 'utf8'));
let bad = 0;
for (const n of def.nodes.filter((x) => x.type === 'subagent')) {
  try {
    const p = resolveParams(n.params, ctx, def);
    const text = String(p.prompt ?? '');
    const left = (text.match(/\{\{[^}]+\}\}/g) ?? []).length;
    const hasMaterial = /材料 \d|MATERIAL_OK|维度=/.test(text);
    console.log(`  ${n.id.padEnd(10)} 提示词 ${String(text.length).padStart(6)} 字｜残留模板 ${left} 处｜含真实材料 ${hasMaterial ? '是' : '否'}`);
    if (left) bad++;
    if (n.id !== 'ai_final' && !hasMaterial) bad++;
  } catch (e) {
    console.log(`  ${n.id.padEnd(10)} ✗ 渲染失败: ${String(e.message).slice(0, 120)}`);
    bad++;
  }
}
console.log(bad === 0 ? '\n✅ 全部 AI 提示词渲染成功、材料已注入、无残留模板' : `\n❌ ${bad} 项异常`);
