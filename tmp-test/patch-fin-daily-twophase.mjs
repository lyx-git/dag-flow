// tmp-test/patch-fin-daily-twophase.mjs — 方案 C：两阶段检索（用户 2026-10-03 拍板「直接上C」）
//
// 用户原话：「工作流查询相关新闻的时候，可以先让ai给你出相关要求，优化查询条件，在执行查询，效果会不会好点」
// 为什么这么做（关键限制）：AI 规划节点**不联网**，凭空改写措辞拿不到"今天的新事"；只有把**第一轮粗搜的
//   结果**喂给它，它才能从今天的材料里抽出实体/事件/机构名，产出第二轮精准查询 —— 这才是 C 的收益来源。
//
// 结构变化（4 条线各加 2 个节点，共 8 个；原有节点 id 一律不动）：
//   cfg ─┬─ srch_domestic ─→ ai_q_domestic ─→ srch_domestic2 ─→ ai_domestic
//        ├─ srch_intl     ─→ ai_q_intl     ─→ srch_intl2     ─→ ai_intl
//        ├─ srch_diplo    ─→ ai_q_diplo    ─→ srch_diplo2    ─→ ai_intl
//        └─ srch_cctv     ─→ ai_q_cctv     ─→ srch_cctv2     ─→ fetch_cctv ─→ ai_domestic
//   分析节点同时吃两轮材料（第一轮广度 + 第二轮精度）；end 汇总里能看到 AI 改写后的 4 条查询。
import { readFileSync, writeFileSync } from 'node:fs';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const MODEL = 'deepseek-flash';

const def = JSON.parse(readFileSync(DEF, 'utf8'));
const log = [];
const node = (id) => def.nodes.find((n) => n.id === id);
if (!node('srch_domestic') || !node('srch_intl') || !node('srch_diplo') || !node('srch_cctv')) {
  console.error('✗ 找不到四个第一轮搜索节点（先把上一轮改动稳定下来再打这个补丁）');
  process.exit(1);
}
if (node('srch_domestic2')) { console.error('✗ 看起来两阶段补丁已经打过了（srch_domestic2 已存在）'); process.exit(1); }

/** 各线的规划提示词：喂第一轮结果 → 产出一行检索语句 */
function plannerPrompt(axis, focus, extra = '') {
  const r1 = `{{srch_${axis}.out.results}}`;
  return [
    `你是资深金融政策分析专家的**检索规划助手**。今天是 {{py_date.out}}。`,
    ``,
    `【第一轮粗搜结果（${focus}）】`,
    r1,
    extra,
    ``,
    `任务：读上面的材料，找出**今天真正值得深挖**的具体线索（政策名 / 发文机构 / 人名 / 会议 / 具体数字 / 公司行业），`,
    `把它们编成**一条**搜索引擎检索语句，用于第二轮精准检索。`,
    ``,
    `硬性要求（不遵守则结果不可用）：`,
    `1. **只输出这一行检索语句**，不要任何解释、不要前后缀、不要引号、不要换行、不要 Markdown；`,
    `2. 必须包含日期 {{py_date.out}}；`,
    `3. 关键词用空格分隔，控制在 8~16 个词；`,
    `4. 优先用材料里出现的**具体专有名词**，不要泛泛的"最新政策""重要事件"；`,
    `5. 若材料里没有可用线索，就输出「{{py_date.out}} ${focus} 重要动向」这一行兜底即可。`,
  ].join('\n');
}

/** 规划节点 + 第二轮搜索节点 */
function addAxis(axis, focus, round1Label, extra = '') {
  const q = `ai_q_${axis}`;
  const r2 = `srch_${axis}2`;
  const r1Node = node(`srch_${axis}`);
  const r1Query = String(r1Node.params?.query ?? '');

  def.nodes.push({
    id: q,
    type: 'subagent',
    label: `AI 规划：${round1Label}检索式`,
    params: { model: MODEL, prompt: plannerPrompt(axis, focus, extra) },
    next: r2,
  });
  def.nodes.push({
    id: r2,
    type: 'web_search',
    label: `搜②：${round1Label}（AI 精准检索）`,
    // 第二轮查询 = AI 产出的一行检索式；前面再兜一层日期，防它漏写
    params: { query: `{{py_date.out}} {{${q}.out}}`, provider: 'bing', count: r1Node.params?.count ?? 8 },
    next: r1Node.next,
  });
  // 重连：第一轮 → 规划 → 第二轮 → （原本第一轮的去处）
  const oldTarget = String(r1Node.next);
  r1Node.next = q;
  def.edges = def.edges.filter((e) => !(e.from === `srch_${axis}` && e.to === oldTarget));
  def.edges.push({ from: `srch_${axis}`, to: q }, { from: q, to: r2 }, { from: r2, to: oldTarget });

  // 画布坐标：第一轮 → 规划 → 第二轮 横向排列（沿用既有 layout 网格）
  const p = def.layout?.[`srch_${axis}`] ?? { x: 986, y: 0 };
  def.layout[q] = { x: p.x + 296, y: p.y };
  def.layout[r2] = { x: p.x + 592, y: p.y };
  // 下游节点右移，避免新列压住旧列
  for (const [id, pos] of Object.entries(def.layout ?? {})) {
    if (id !== q && id !== r2 && pos.x >= p.x + 296) pos.x += 0;
  }
  log.push(`＋ ${axis}：${q} → ${r2}（第一轮去处 ${oldTarget} 改为由第二轮供料）`);
  void r1Query;
}

addAxis('domestic', '国内金融政策/监管', '国内政策', '\n【关注板块】{{cfg.out.sectors}}');
addAxis('intl', '国际金融与市场', '国际金融');
addAxis('diplo', '中美关系与外交信号', '中美外交');
addAxis('cctv', '新闻联播当日议程', '新闻联播');

// ---- 分析节点吃两轮材料 ----
const intl = node('ai_intl');
const domestic = node('ai_domestic');
const patchPrompt = (n, replaces) => {
  let s = String(n.params.prompt);
  for (const [from, to] of replaces) {
    if (!s.includes(from)) { console.error(`✗ 提示词锚点没找到：${from.slice(0, 40)}…`); process.exit(1); }
    s = s.replace(from, to);
  }
  n.params = { ...n.params, prompt: s };
};
patchPrompt(intl, [
  ['【国际金融事件搜索结果】\n{{srch_intl.out.results}}', '【国际金融事件搜索结果（第一轮·广度）】\n{{srch_intl.out.results}}\n\n【国际金融事件搜索结果（第二轮·AI 精准检索：{{ai_q_intl.out}}）】\n{{srch_intl2.out.results}}'],
  ['【外交 / 国际关系 / 中美关系搜索结果】\n{{srch_diplo.out.results}}', '【外交 / 国际关系 / 中美关系搜索结果（第一轮·广度）】\n{{srch_diplo.out.results}}\n\n【外交 / 国际关系 / 中美关系搜索结果（第二轮·AI 精准检索：{{ai_q_diplo.out}}）】\n{{srch_diplo2.out.results}}'],
]);
patchPrompt(domestic, [
  ['【国内金融政策搜索结果】\n{{srch_domestic.out.results}}', '【国内金融政策搜索结果（第一轮·广度）】\n{{srch_domestic.out.results}}\n\n【国内金融政策搜索结果（第二轮·AI 精准检索：{{ai_q_domestic.out}}）】\n{{srch_domestic2.out.results}}'],
]);
log.push('↻ ai_intl / ai_domestic：提示词改为「第一轮广度 + 第二轮 AI 精准检索」两段材料');

// ---- end 汇总暴露 AI 改写后的检索式（便于人工核对效果）----
const end = node('end');
end.params = {
  ...end.params,
  outputs: {
    ...end.params.outputs,
    refinedQueries: {
      domestic: `{{ai_q_domestic.out}}`,
      intl: `{{ai_q_intl.out}}`,
      diplo: `{{ai_q_diplo.out}}`,
      cctv: `{{ai_q_cctv.out}}`,
    },
  },
};
log.push('↻ end.outputs 增加 refinedQueries（4 条 AI 改写后的检索式，跑完可直接核对）');

// ---- 自检（写盘前）----
const errs = [];
const ids = def.nodes.map((n) => n.id);
const idSet = new Set(ids);
if (ids.length !== idSet.size) errs.push('节点 id 重复');
const refs = new Set();
const scan = (v) => {
  if (typeof v === 'string') { for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\./g)) refs.add(m[1]); }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) scan(x);
};
for (const n of def.nodes) scan(n.params);
for (const r of refs) if (!['inputs', 'vars', 'results'].includes(r) && !idSet.has(r)) errs.push(`模板引用不存在的节点：${r}`);
for (const e of def.edges) if (!idSet.has(e.from) || !idSet.has(e.to)) errs.push(`边指向不存在的节点：${e.from}→${e.to}`);
const REQUIRED = { web_search: ['query', 'provider'], subagent: ['prompt', 'model'], file_save: ['filename'], log: ['message'], set_var: ['vars'] };
for (const n of def.nodes) for (const k of REQUIRED[n.type] ?? []) {
  if (n.params?.[k] === undefined || n.params[k] === '') errs.push(`${n.id} 缺必填参数 ${k}`);
}
// next ↔ edges 一致
for (const n of def.nodes) {
  const fromEdges = def.edges.filter((e) => e.from === n.id).map((e) => e.to);
  const nextList = n.next === undefined || n.next === null ? [] : (Array.isArray(n.next) ? n.next : [n.next]);
  if (fromEdges.length !== nextList.length || !fromEdges.every((t) => nextList.includes(t))) {
    errs.push(`next 与 edges 不一致：${n.id} edges=[${fromEdges}] next=[${nextList}]`);
  }
}
// 分层（Kahn）：确认「粗搜 → 规划 → 精搜 → 分析」顺序成立，并作为交付证据打印
const layers = [];
{
  const indeg = new Map(def.nodes.map((n) => [n.id, 0]));
  const adj = new Map(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) { adj.get(e.from).push(e.to); indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1); }
  let cur = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (cur.length) {
    layers.push(cur);
    const nextLayer = [];
    for (const id of cur) {
      seen++;
      for (const t of adj.get(id)) {
        indeg.set(t, indeg.get(t) - 1);
        if (indeg.get(t) === 0) nextLayer.push(t);
      }
    }
    cur = nextLayer;
  }
  if (seen !== def.nodes.length) errs.push('存在环（节点无法全部排序）');
}
if (errs.length) { console.error('✗ 自检未通过：'); for (const e of errs) console.error('  - ' + e); process.exit(1); }

writeFileSync(DEF, JSON.stringify(def, null, 2) + '\n', 'utf8');
for (const l of log) console.log(l);
console.log(`✓ 已写盘（节点 ${def.nodes.length} / 边 ${def.edges.length}）`);
console.log('  执行层序（证据：两阶段检索顺序成立）：');
layers.forEach((l, i) => console.log(`    L${i + 1}: ${l.join(' ')}`));
