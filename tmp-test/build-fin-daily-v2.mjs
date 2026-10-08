// tmp-test/build-fin-daily-v2.mjs — 生成「金融政策日报」v2（四层优化：修根因 + 抓正文 + 换方向重搜 + 扩维度/投资建议）
//   幂等：可重复执行；写入前跑 8 道自检，任一项不过就不写盘。
//   用法：node tmp-test/build-fin-daily-v2.mjs [--write]
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';

const SRC = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const TPL = 'tmp-test/collector-template.py';
const WRITE = process.argv.includes('--write');
const AI_MODEL = 'dsh:llm:deepseek-vision:deepseek-flash';

// ============ 维度表（唯一真源：查询词 / 权威源 / 筛选词 / 重搜式 / 分析关注点）============
const DIMS = [
  {
    dim: '政策', node: 'policy',
    q: '央行 货币政策 降准降息 公开市场操作 政策',
    sources: ['http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html',
      'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', 'https://www.stcn.com/'],
    keywords: ['政策', '央行', '财政', '监管', '国务院', '通知', '意见', '会议', '降准', '降息', '贴息', 'LPR', '货币政策', '证监会', '金融监管'],
    alt: ['国务院 财政部 稳增长 最新政策 发布', '金融监管总局 新规 通知 解读'],
    focus: '货币政策/财政政策/监管新规的边际变化，以及政策对资金面与市场风险偏好的指向',
  },
  {
    dim: '资金', node: 'money',
    q: '银行间 资金面 逆回购 净投放 利率 成交额',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['资金', '流动性', '利率', '逆回购', 'MLF', '净投放', 'DR007', '北向', '融资', '两融', '成交额', 'shibor', '主力'],
    alt: ['央行 公开市场操作 净投放 公告', 'A股 主力资金 北向资金 流向 统计'],
    focus: '市场流动性松紧、资金价格（利率）变化、主力/北向资金动向',
  },
  {
    dim: '股市', node: 'stock',
    q: 'A股 上证指数 深证成指 板块 行情 涨跌',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['A股', '股市', '上证', '深证', '创业板', '指数', '板块', '涨', '跌', '行情', '涨停', '个股', '沪指', '收盘'],
    alt: ['股市 复盘 涨跌 原因 分析', '沪深两市 收盘 板块 表现'],
    focus: '指数表现、领涨领跌板块及其原因、个股异动与情绪',
  },
  {
    dim: '基金', node: 'fund',
    q: '公募基金 新发 ETF 规模 净值 调仓',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['基金', 'ETF', '公募', '私募', '募集', '净值', '份额', '调仓', '重仓', '发行'],
    alt: ['ETF 资金流入 规模 排行', '公募基金 发行 业绩 排名 最新'],
    focus: '基金发行与申赎、ETF 资金流向、机构调仓与重仓变化',
  },
  {
    dim: '汇率', node: 'fx',
    q: '人民币 汇率 中间价 离岸 美元指数 外汇',
    sources: ['http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', 'https://www.stcn.com/'],
    keywords: ['汇率', '人民币', '美元', '中间价', '离岸', '外汇', '贬值', '升值', '货币网', '结售汇'],
    alt: ['人民币 汇率 中间价 走势 分析', '外汇局 跨境资金 流动 数据'],
    focus: '人民币汇率水平与中间价、美元指数、监管层的汇率政策表态',
  },
  {
    dim: '银行', node: 'bank',
    q: '银行 净息差 存款利率 贷款 不良率 理财',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['银行', '存款', '贷款', '净息差', '不良', '息差', '信贷', '理财', '拨备', '大行'],
    alt: ['银行股 业绩 息差 财报 分析', '商业银行 信贷 投放 数据 最新'],
    focus: '银行息差与信贷投放、存款利率调整、资产质量与理财动向',
  },
  {
    dim: '国际', node: 'intl',
    q: '美联储 利率决议 美股 美债 通胀 非农',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['美联储', '美国', '欧洲', '欧央行', '日本', '美债', '美股', '油价', '黄金', '地缘', '关税', '通胀', '非农', '全球'],
    alt: ['全球市场 隔夜 美股 美债 表现', '美联储 降息 预期 最新 表态'],
    focus: '海外央行政策与数据、美股美债与大宗商品、地缘与外部风险',
  },
];

// ============ 候选权威源池（2026-10-08 实测可抓的 15 个；采集器运行时自动探测+按维度打分）============
const POOL = [
  { name: '央行-沟通交流', url: 'http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', tags: ['政策', '汇率'] },
  { name: '财政部-财政新闻', url: 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', tags: ['政策'] },
  { name: '证监会-要闻', url: 'http://www.csrc.gov.cn/csrc/c100028/common_list.shtml', tags: ['政策', '股市'] },
  { name: '国家外汇局-新闻', url: 'https://www.safe.gov.cn/safe/whxw/index.html', tags: ['汇率'] },
  { name: '国家统计局-数据解读', url: 'https://www.stats.gov.cn/sj/sjjd/', tags: ['资金', '国际'] },
  { name: '证券时报', url: 'https://www.stcn.com/', tags: ['政策', '资金', '股市', '基金', '汇率', '银行', '国际'] },
  { name: '东方财富-财经要闻', url: 'https://finance.eastmoney.com/a/ccjdd.html', tags: ['资金', '股市', '基金', '银行'] },
  { name: '东方财富-股票频道', url: 'https://stock.eastmoney.com/', tags: ['股市'] },
  { name: '东方财富-基金频道', url: 'https://fund.eastmoney.com/', tags: ['基金'] },
  { name: '中国证券报', url: 'https://www.cs.com.cn/', tags: ['政策', '股市', '基金'] },
  { name: '上海证券报', url: 'https://www.cnstock.com/', tags: ['政策', '股市', '银行'] },
  { name: '新浪财经', url: 'https://finance.sina.com.cn/', tags: ['资金', '股市', '国际'] },
  { name: '第一财经', url: 'https://www.yicai.com/', tags: ['政策', '资金', '国际'] },
  { name: '人民网-财经', url: 'http://finance.people.com.cn/', tags: ['政策', '银行'] },
  { name: '央视网-联播按日页', url: 'https://tv.cctv.com/lm/xwlb/day/20261007.shtml', tags: ['官方'] },
];

const AI_RULES = [
  '只依据材料里的事实作答，严禁编造材料中没有的数字、政策名或事件；',
  '材料没覆盖到的关键信息，写进「数据缺口」，不要用推测填空；',
  '纯文本输出：不要用 Markdown 的加粗语法（星号），不要代码块（正文会渲染成邮件）；',
  '控制在 400 字以内，信息密度优先。',
].join('\n- ');

function aiPrompt(d) {
  return `你是资深金融分析师，负责「${d.dim}」维度。
下面的材料分两轮抓取：第一轮来自权威源列表页，第二轮用多引擎检索（bing/ddg/searxng 轮换）补充第一轮未覆盖的角度，并已跳过第一轮用过的 URL。每段材料都标了来源。
本维度重点关注：${d.focus}。

输出要求（严格遵守）：
- ${AI_RULES}
- 必须做跨来源、跨轮次交叉印证：同一事实若多个来源一致，标「多源一致」；互相矛盾或口径不同，标「来源分歧」并写清分歧点；只有一个来源提及，标「单一来源」；只有第二轮检索才出现的，标「检索补充」。

输出结构：
1. 核心事实：3~6 条，每条一行，带具体数字/政策名/日期，并标注印证情况（多源一致 / 来源分歧 / 单一来源）
2. 影响方向：对市场/相关板块偏多、偏空或中性，并给一句逻辑
3. 相关板块或标的：只写材料里出现过的行业/板块/公司；没有就写「材料未提及」
4. 数据缺口：这一维度里材料未覆盖的关键信息

【材料开始】
第一轮（权威源列表页抓取）
{{py_${d.node}.out}}

第二轮（多引擎检索补充，已跳过第一轮用过的 URL）
{{py_${d.node}2.out}}
【材料结束】`;
}

function finalPrompt() {
  const parts = DIMS.map((d) => `### ${d.dim}\n{{ai_${d.node}.out}}`).join('\n\n');
  return `你是首席策略分析师。下面是 ${DIMS.length} 个维度的分析结论（每个维度由独立分析师依据真实抓取材料得出），另有「官方口径」一栏来自当日《新闻联播》文字页。

请汇总成一份完整的《金融与投资参考》，供投资者判断使用。
输出要求（严格遵守）：
- 只依据下面各维度的结论，不得编造；某维度材料不足就如实写明；
- 纯文本 + Markdown 表格（不要用 Markdown 的加粗语法即星号，不要代码块，正文会渲染成邮件）；
- 表格用真实 Markdown 语法（| 分隔）。

输出结构：
一、今日结论（不超过 200 字，讲清当前市场的主要矛盾与方向）
二、分维度要点表（Markdown 表格，列：# | 维度 | 核心事实 | 影响方向 | 关注板块，共 ${DIMS.length + 1} 行：政策/资金/股市/基金/汇率/银行/国际/官方口径）
三、投资建议（按资产与板块给出倾向与理由；说明仓位思路与节奏；投资者关注的板块偏好见下）
四、风险提示（3~5 条，每条一行）
五、数据缺口（哪些维度材料不足、建议人工补充什么）

投资者关注的板块偏好：{{inputs.关注板块}}

【各维度分析开始】
${parts}

### 官方口径（当日新闻联播）
{{ai_cctv.out}}
【各维度分析结束】`;
}

// ============ 组装节点 ============
const cur = JSON.parse(readFileSync(SRC, 'utf8'));
const pick = (id) => cur.nodes.find((n) => n.id === id);
const tpl = readFileSync(TPL, 'utf8');
// ★ 采集器自给自足：不依赖上游搜索节点（实测「搜索 0 条」会让整条支路跳过 → 该维度零材料）。
//   ROUND=1 权威源优先（列表页→正文），ROUND=2 多引擎检索优先（补第 1 轮未覆盖的角度）+ 跨轮去重。
const collectorCode = (d, round) => tpl
  .replaceAll('@@DIM@@', d.dim)
  .replaceAll('@@ROUND@@', String(round))
  .replaceAll('@@CANDIDATES@@', JSON.stringify(POOL))
  .replaceAll('@@KEYWORDS@@', JSON.stringify(d.keywords))
  .replaceAll('@@ALT@@', JSON.stringify([d.q, ...d.alt]))
  .replaceAll('@@RAW@@', "''");

const nodes = [];
// —— 保留的三个节点 ——
const startN = { ...pick('start') };
const pyDate = { ...pick('py_date') };
const cfg = JSON.parse(JSON.stringify(pick('cfg')));
cfg.params.vars = { mailTo: '{{inputs.收件邮箱}}', subject: '金融政策日报 {{py_date.out}}', sectors: '{{inputs.关注板块}}', day: '{{py_date.out}}' };
nodes.push(startN, pyDate, cfg);

// —— 搜索节点：只保留 srch_cctv（fetch_cctv 的兜底引用了它，不能动原逻辑）——
//    ★ 7 个维度的搜索节点已去掉：采集器自给自足（权威源优先、不足才在内部搜），
//      避免「搜索 0 条 → 整条支路跳过 → 该维度零材料」的失败级联。
nodes.push({
  id: 'srch_cctv', type: 'web_search', label: '搜索·联播文字稿',
  // provider=auto：走插件内置 5 引擎链（bing→ddg-lite→ddg→searxng→anysearch），比单一引擎抗限流
  params: { provider: 'auto', query: '新闻联播 主要内容 文字稿', timeRange: 'week', count: 8 },
});
// —— 官方口径：沿用既有 fetch_cctv（央视网按日页，已验证能拿到正文）
//    它的代码里有一条兜底：央视页抓失败时用 {{srch_cctv.out.results}} 里的 URL，所以 srch_cctv 必须保留
const fetchCctv = JSON.parse(JSON.stringify(pick('fetch_cctv')));
nodes.push(fetchCctv);
// —— 两轮采集：第 1 轮权威源优先；第 2 轮多引擎检索优先 + 跳过第 1 轮已抓过的 URL ——
for (const d of DIMS) {
  nodes.push({
    id: `py_${d.node}`, type: 'python', label: `采集·${d.dim}·1轮`,
    params: { code: collectorCode(d, 1), timeoutMs: 300000 },
  });
}
for (const d of DIMS) {
  nodes.push({
    id: `py_${d.node}2`, type: 'python', label: `采集·${d.dim}·2轮`,
    params: { code: collectorCode(d, 2), timeoutMs: 300000 },
  });
}

// —— 8 个分析节点（读两轮材料，做跨轮 + 跨源印证）——
for (const d of DIMS) {
  nodes.push({ id: `ai_${d.node}`, type: 'subagent', label: `分析·${d.dim}`, params: { model: AI_MODEL, prompt: aiPrompt(d) } });
}
nodes.push({
  id: 'ai_cctv', type: 'subagent', label: '分析·官方口径',
  params: {
    model: AI_MODEL,
    prompt: `你是资深时政金融分析师，负责「官方口径」维度。
下面是当日《新闻联播》文字页抓取的条目清单（央视网按日页）。

输出要求（严格遵守）：
- ${AI_RULES}

输出结构：
1. 今日官方议程要点：3~5 条（政策信号、经济数据、重要会议或部署）
2. 与市场的关联：这些表述对哪些板块可能有指向
3. 数据缺口：文字页只有条目标题时，明确说明「仅有标题、无正文」

【材料开始】
{{fetch_cctv.out}}
【材料结束】`,
  },
});

// —— 终稿 ——
nodes.push({ id: 'ai_final', type: 'subagent', label: '终稿·投资建议报告', params: { model: AI_MODEL, prompt: finalPrompt() } });

// —— mail / log_done / end ——
const mail = JSON.parse(JSON.stringify(pick('mail')));
mail.params.code = mail.params.code.replace('{{ai_matrix.out}}', '{{ai_final.out}}');
nodes.push(mail);
nodes.push({ id: 'log_done', type: 'log', label: '记录完成', params: { message: '金融政策日报已生成并已发送邮件：{{mail.out}}（不落盘）' } });
nodes.push({
  id: 'end', type: 'end', label: '结束',
  params: {
    outputs: {
      day: '{{py_date.out}}', mail: '{{mail.out}}', report: '{{ai_final.out}}',
      // ★ 不再暴露 cctv：end 引用 {{fetch_cctv.out}} 会在 fetch_cctv 被跳过时让整轮运行失败（原版就有这个脆弱点）
    },
  },
});

// ============ 边 + next（两者必须一致）============
const edges = [];
const link = (from, to) => edges.push({ from, to });
link('start', 'py_date'); link('py_date', 'cfg');
link('cfg', 'srch_cctv');
// fetch_cctv 的代码里引用了 {{srch_cctv.out.results}}（央视页抓失败时的兜底 URL）→ 必须在它之后执行
link('srch_cctv', 'fetch_cctv');
for (const d of DIMS) { link('cfg', `py_${d.node}`); link(`py_${d.node}`, `py_${d.node}2`); link(`py_${d.node}2`, `ai_${d.node}`); }
link('fetch_cctv', 'ai_cctv');
for (const d of DIMS) link(`ai_${d.node}`, 'ai_final');
link('ai_cctv', 'ai_final');
link('ai_final', 'mail'); link('mail', 'log_done'); link('log_done', 'end');

const succ = {};
for (const e of edges) (succ[e.from] ??= []).push(e.to);
for (const n of nodes) {
  const s = succ[n.id];
  if (s && s.length) n.next = s.length === 1 ? s[0] : s;
  else delete n.next;
}

// ============ 布局（分层：x 按层，y 同层内均分）============
const layers = [
  ['start'], ['py_date'], ['cfg'], ['srch_cctv'],
  DIMS.map((d) => `py_${d.node}`),
  [...DIMS.map((d) => `py_${d.node}2`), 'fetch_cctv'],
  [...DIMS.map((d) => `ai_${d.node}`), 'ai_cctv'],
  ['ai_final'], ['mail'], ['log_done'], ['end'],
];
const layout = {};
layers.forEach((ids, li) => {
  ids.forEach((id, i) => {
    layout[id] = { x: 60 + li * 300, y: 60 + i * 170 };
  });
});

const def = {
  ...cur,
  description: '金融政策日报 v2：8 维度（政策/资金/股市/基金/汇率/银行/国际/官方口径）— 权威源抓正文 + 材料不足自动换方向重搜 + 终稿出投资建议报告，不落盘直接发邮件',
  nodes, edges, layout,
};

// ============ 自检（任一不过不写盘）============
const problems = [];
const ids = new Set(nodes.map((n) => n.id));
if (ids.size !== nodes.length) problems.push('节点 id 有重复');
if (nodes.length !== 31) problems.push(`节点数应为 31，实际 ${nodes.length}`);
if (edges.length !== 37) problems.push(`边数应为 37，实际 ${edges.length}`);
for (const e of edges) if (!ids.has(e.from) || !ids.has(e.to)) problems.push(`边指向不存在的节点: ${e.from}->${e.to}`);
for (const n of nodes) {
  const t = JSON.stringify(n);
  for (const m of t.matchAll(/\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5]+)\./g)) {
    const ref = m[1];
    if (ref !== 'inputs' && ref !== 'vars' && !ids.has(ref)) problems.push(`节点 ${n.id} 引用了不存在的节点 ${ref}`);
  }
}
// ★ 关键：搜索词里不得出现日期
for (const n of nodes) {
  if (n.type !== 'web_search') continue;
  const q = String(n.params.query ?? '');
  if (/\d{4}-\d{2}-\d{2}|py_date|cfg\.out\.day/.test(q)) problems.push(`搜索节点 ${n.id} 的查询词里仍带日期: ${q}`);
}
// 每个维度都要有 两轮采集 + 分析 三件套
for (const d of DIMS) {
  for (const id of [`py_${d.node}`, `py_${d.node}2`, `ai_${d.node}`]) {
    if (!ids.has(id)) problems.push(`缺少 ${id}`);
  }
  for (const [id, rnd] of [[`py_${d.node}`, '1'], [`py_${d.node}2`, '2']]) {
    const py = nodes.find((n) => n.id === id);
    if (!py) continue;
    if (!py.params.code.includes('CANDIDATES')) problems.push(`${id} 缺候选源池`);
    if (!py.params.code.includes('discover_sources')) problems.push(`${id} 缺「先搜索有哪些权威源」的探测逻辑`);
    if (!py.params.code.includes(`ROUND = "${rnd}"`)) problems.push(`${id} 的 ROUND 不是 ${rnd}`);
    if (!py.params.code.includes('multi_search')) problems.push(`${id} 缺多引擎搜索`);
    if (!py.params.code.includes('SEEN_FILE')) problems.push(`${id} 缺跨轮去重（临时文件）`);
    if (!py.params.code.includes('MATERIAL_OK')) problems.push(`${id} 缺少状态行`);
    if (!py.params.code.includes('except Exception')) problems.push(`${id} 缺少兜底 try/except`);
    if (!py.params.code.includes('ENGINES')) problems.push(`${id} 缺多引擎表`);
    if (/\{\{/.test(py.params.code)) problems.push(`${id} 含模板引用（应自给自足，避免被上游失败拖垮）`);
    if (py.params.code.length > 24000) problems.push(`${id} 代码 ${py.params.code.length} 字，逼近命令行长度上限（会 spawn ENAMETOOLONG）`);
  }
  const ai = nodes.find((n) => n.id === `ai_${d.node}`);
  if (!ai.params.prompt.includes(`{{py_${d.node}.out}}`) || !ai.params.prompt.includes(`{{py_${d.node}2.out}}`)) {
    problems.push(`ai_${d.node} 未同时引用两轮材料`);
  }
}
const mailN = nodes.find((n) => n.id === 'mail');
if (!mailN.params.code.includes('{{ai_final.out}}')) problems.push('mail 未改为引用 ai_final');
if (mailN.params.code.includes('{{ai_matrix.out}}')) problems.push('mail 仍残留 ai_matrix 引用');
for (const n of nodes.filter((x) => x.type === 'subagent')) {
  if (!n.params.model) problems.push(`${n.id} 缺 model`);
  if (/\*\*/.test(n.params.prompt)) problems.push(`${n.id} 的提示词里含 ** （会渲染成裸星号）`);
}

console.log(`节点 ${nodes.length} / 边 ${edges.length}；自检问题 ${problems.length} 项`);
if (problems.length) { for (const p of problems) console.log('  ✗ ' + p); console.log('→ 自检未通过，不写盘'); process.exit(1); }
console.log('  ✓ 全部自检通过');
if (!WRITE) { console.log('（演练模式：加 --write 才写盘）'); process.exit(0); }
mkdirSync('tmp-test/_fin-daily-v2', { recursive: true });
writeFileSync('tmp-test/_fin-daily-v2/金融政策日报.json', JSON.stringify(def, null, 2), 'utf8');
copyFileSync(SRC, `tmp-test/_fin-daily-v2/prev-${Date.now()}.json`);
writeFileSync(SRC, JSON.stringify(def, null, 2), 'utf8');
console.log('已写入 ' + SRC);
