// tmp-test/build-fin-daily.mjs — 生成「金融政策日报」工作流（场景：资深金融政策分析专家 · 每日情报）
// 为什么要脚本生成而不是手写 JSON：def 里含多段 Python 代码（smtplib 发邮件），手写 JSON 转义极易出错；
// 用 JS 对象构建 + JSON.stringify 自动转义，而且可重复生成、可自检。
// 产出：<工作区>/.dag-flow/workflow/金融政策日报.json
//
// 设计（见对话里的场景）：
//   start → py_date(取当天日期) → cfg(收件人/主题/板块/关键词)
//     ├→ srch_domestic(国内政策)  ┐
//     ├→ srch_intl(国际金融)      ├→ ai_intl(国际线：事件+外交信号+美/港/A股板块影响)
//     ├→ srch_diplo(中美/外交)    ┘
//     ├→ srch_cctv(找新闻联播) → fetch_cctv(抓全文) ┐
//     └───────────────────────────────────────────┴→ ai_domestic(国内线+新闻联播提炼)
//   ai_intl + ai_domestic → ai_matrix(终稿：行业影响矩阵/机会信号，Markdown)
//     → save_doc(落盘 .dag-flow/reports/金融政策日报-<日期>.md) → mail(Python smtplib 发邮件) → log → end
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// 产出：**工作区**根的 .dag-flow/workflow/（用户自己的 dag-flow 目录；不是插件仓库根）
const DEF_PATH = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';

// ---------- 1. 取当天日期（python out = stdout 单行字符串，便于模板当纯字符串用）----------
const pyDateCode = `# -*- coding: utf-8 -*-
import datetime
print(datetime.datetime.now().strftime('%Y-%m-%d'))`;

// ---------- 2. 发邮件（Python 标准库 smtplib；零额外依赖，符合 R3）----------
// 邮件正文 = 日报 Markdown；同时把落盘的 .md 作为附件发出。
const mailCode = `# -*- coding: utf-8 -*-
# 定时/手动执行时把日报发到邮箱。
# 需要先在环境变量里配好 SMTP（dsh 启动的进程环境）：
#   DAGFLOW_SMTP_HOST  smtp.qq.com / smtp.163.com / smtp.exmail.qq.com ...
#   DAGFLOW_SMTP_PORT  465（SSL）或 587
#   DAGFLOW_SMTP_USER  发件账号（一般就是邮箱地址）
#   DAGFLOW_SMTP_PASS  授权码 / 应用专用密码（不是登录密码）
# 收件人来自工作流参数「收件邮箱」。
import os, sys, smtplib, datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header
from email.utils import formatdate

MAIL_TO = """{{inputs.收件邮箱}}""".strip()
if not MAIL_TO or '@' not in MAIL_TO:
    print('MAIL_MISSING_TO: 工作流参数「收件邮箱」没填（或不是邮箱）——请在头部「工作流参数」里填写')
    sys.exit(3)
host = os.environ.get('DAGFLOW_SMTP_HOST', '').strip()
port = int((os.environ.get('DAGFLOW_SMTP_PORT') or '465').strip() or '465')
user = os.environ.get('DAGFLOW_SMTP_USER', '').strip()
pwd = os.environ.get('DAGFLOW_SMTP_PASS', '').strip()
if not (host and user and pwd):
    print('MAIL_MISSING_SMTP: 未配置 DAGFLOW_SMTP_HOST / DAGFLOW_SMTP_USER / DAGFLOW_SMTP_PASS 环境变量'
          '（qq/163 邮箱用「授权码」，不是登录密码）；配好后重启 dsh web 再跑')
    sys.exit(3)

day = """{{py_date.out}}""".strip()
md_path = os.path.join('.dag-flow', 'reports', '金融政策日报-%s.md' % day)
if not os.path.exists(md_path):
    print('MAIL_NO_DOC: 没找到日报文件 %s（前一步 file_save 可能失败了）' % md_path)
    sys.exit(3)
with open(md_path, 'r', encoding='utf-8') as f:
    body = f.read()

msg = MIMEMultipart()
msg['Subject'] = Header('金融政策日报 %s' % day, 'utf-8')
msg['From'] = user
msg['To'] = MAIL_TO
msg['Date'] = formatdate(localtime=True)
msg.attach(MIMEText(body, 'plain', 'utf-8'))
att = MIMEApplication(body.encode('utf-8'))
att.add_header('Content-Disposition', 'attachment', filename=('utf-8', '', '金融政策日报-%s.md' % day))
msg.attach(att)

try:
    if port == 465:
        s = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        s = smtplib.SMTP(host, port, timeout=30)
        s.starttls()
    s.login(user, pwd)
    s.sendmail(user, [MAIL_TO], msg.as_string())
    s.quit()
except Exception as e:
    print('MAIL_SEND_FAILED: %s: %s（检查授权码/端口/是否开了 SMTP 服务）' % (type(e).__name__, e))
    sys.exit(3)
print('MAIL_SENT -> %s（正文 %d 字 + 附件 %s）' % (MAIL_TO, len(body), os.path.basename(md_path)))`;

// ---------- 3. 三个分析 agent 的提示词 ----------
const aiIntlPrompt = `你是资深金融政策分析专家，为投资决策者做每日国际线情报。今天是 {{py_date.out}}。

【国际金融事件搜索结果】
{{srch_intl.out.results}}

【外交 / 国际关系 / 中美关系搜索结果】
{{srch_diplo.out.results}}

任务：把材料提炼成「国际线」分析，输出中文 Markdown，不要寒暄：
1) **今日国际重要金融事件/政策**（≤6 条，每条：一句话事件 + 来源链接）
2) **外交与国际关系变化**：含中美外交新信号、关税/出口管制/科技限制、地缘冲突；每条标注「信号强度：强/中/弱」与「新增信号 / 延续既有」
3) **对不同市场行业板块的影响**（分点列表）：板块 | 市场（美股 / 纳斯达克 / 港股 / A股）| 积极 or 消极 | 影响逻辑一句话 | 置信度（高/中/低）
4) 只用搜索材料支撑；材料不足就写「材料不足」，**不要编造数字、政策名或时间**。`;

const aiDomesticPrompt = `你是资深金融政策分析专家，为投资决策者做每日国内线情报。今天是 {{py_date.out}}。

【国内金融政策搜索结果】
{{srch_domestic.out.results}}

【新闻联播文字稿（可能为空）】
{{fetch_cctv.out.text}}

任务：输出中文 Markdown，不要寒暄：
1) **今日国内重要政策/监管动向**（≤6 条，每条：政策一句话 + 发布主体 + 来源链接）
2) **新闻联播要点提炼**（≤6 条，标注「官方口径」；文字稿抓不到就写「未取到文字稿，仅用搜索材料」）
3) **对不同市场行业板块的影响**（分点列表）：板块 | 市场（A股 / 港股）| 积极 or 消极 | 影响逻辑一句话 | 置信度（高/中/低）
4) 只写有材料支撑的内容，材料不足写「材料不足」，不要编造。`;

const aiMatrixPrompt = `你是资深金融政策分析专家。基于下面两份分析，产出可直接邮件发送的**每日金融政策与行业机会信号日报**。

【关注板块】{{cfg.out.sectors}}
【今日日期】{{cfg.out.day}}

【国际线分析】
{{ai_intl.out}}

【国内线分析】
{{ai_domestic.out}}

严格按这个结构输出中文 Markdown（不要寒暄、不要代码块包裹全文）：
# 金融政策与市场影响日报 · {{cfg.out.day}}
## 0. 今日一句话结论（≤120 字）
## 1. 重要事件与政策清单（国际 / 国内分列；每条：事件 + 影响方向 + 来源）
## 2. 外交与国际关系信号（单列中美外交变化小节；每条标「新增信号/延续」与强度）
## 3. 新闻联播要点提炼（≤6 条，标「官方口径」）
## 4. 行业板块影响矩阵（Markdown 表格：板块 | A股 | 港股 | 美股 | 纳斯达克 | 积极/消极 | 影响逻辑 | 置信度）
## 5. 机会信号与风险提示（按板块给 1-2 条「值得关注的变化信号」，明确区分事实与推断）
## 6. 数据与来源（列出用到的链接）

要求：精炼、可执行、便于扫读；无材料支撑处写「材料不足」；不给投资建议式断言，只陈述政策/事件与行业影响逻辑。`;

// ---------- 4. 组装 def ----------
const N = (id, type, label, params, next) => ({ id, type, label, params, ...(next !== undefined ? { next } : {}) });

const nodes = [
  N('start', 'start', '开始（每日触发）', {}, 'py_date'),
  N('py_date', 'python', '取今天日期', { code: pyDateCode, timeoutMs: 15000 }, 'cfg'),
  N('cfg', 'set_var', '日报配置', {
    vars: {
      mailTo: '{{inputs.收件邮箱}}',
      subject: '金融政策日报 {{py_date.out}}',
      sectors: '{{inputs.关注板块}}',
      kw: '{{inputs.关键词}}',
      day: '{{py_date.out}}',
    },
  }, ['srch_domestic', 'srch_intl', 'srch_diplo', 'srch_cctv']),

  N('srch_domestic', 'web_search', '搜：国内金融政策', {
    query: '{{cfg.out.day}} 国内 金融政策 央行 财政部 发改委 证监会 监管 新规 {{cfg.out.kw}}',
    provider: 'auto', count: 6,
  }, ['ai_domestic']),
  N('srch_intl', 'web_search', '搜：国际金融事件', {
    query: '{{cfg.out.day}} 国际 金融 美联储 欧央行 利率 通胀 地缘 市场 重要事件',
    provider: 'auto', count: 6,
  }, ['ai_intl']),
  N('srch_diplo', 'web_search', '搜：中美/外交信号', {
    query: '{{cfg.out.day}} 中美关系 外交政策 变化 关税 出口管制 信号 分析',
    provider: 'auto', count: 6,
  }, ['ai_intl']),
  N('srch_cctv', 'web_search', '搜：新闻联播文字稿', {
    query: '{{cfg.out.day}} 新闻联播 主要内容 文字稿',
    provider: 'auto', count: 4,
  }, 'fetch_cctv'),
  N('fetch_cctv', 'web_fetch', '抓：新闻联播全文', {
    url: '{{srch_cctv.out.results.0.url}}', maxChars: 6000,
  }, ['ai_domestic']),

  N('ai_intl', 'subagent', 'AI：国际线分析', { model: 'deepseek-flash', prompt: aiIntlPrompt, timeoutMs: 300000 }, ['ai_matrix']),
  N('ai_domestic', 'subagent', 'AI：国内线分析', { model: 'deepseek-flash', prompt: aiDomesticPrompt, timeoutMs: 300000 }, ['ai_matrix']),
  N('ai_matrix', 'subagent', 'AI：终稿（矩阵+机会信号）', { model: 'deepseek-flash', prompt: aiMatrixPrompt, timeoutMs: 600000 }, 'save_doc'),

  N('save_doc', 'file_save', '落盘：日报 Markdown', {
    source: 'text', filename: 'reports/金融政策日报-{{py_date.out}}.md', content: '{{ai_matrix.out}}',
  }, 'mail'),
  N('mail', 'python', '发邮件（smtplib）', { code: mailCode, timeoutMs: 60000 }, 'log_done'),
  N('log_done', 'log', '日志：完成', {
    level: 'info',
    message: '金融政策日报已生成：{{save_doc.out.path}}；邮件：{{mail.out}}',
  }, 'end'),
  N('end', 'end', '结束（汇总）', {
    outputs: {
      day: '{{py_date.out}}',
      doc: '{{save_doc.out.path}}',
      mail: '{{mail.out}}',
      intlSearchCount: '{{srch_intl.out.count}}',
      domesticSearchCount: '{{srch_domestic.out.count}}',
      cctvSource: '{{srch_cctv.out.results.0.url}}',
      report: '{{ai_matrix.out}}',
    },
  }),
];

const edges = [
  { from: 'start', to: 'py_date' },
  { from: 'py_date', to: 'cfg' },
  { from: 'cfg', to: 'srch_domestic' },
  { from: 'cfg', to: 'srch_intl' },
  { from: 'cfg', to: 'srch_diplo' },
  { from: 'cfg', to: 'srch_cctv' },
  { from: 'srch_cctv', to: 'fetch_cctv' },
  { from: 'srch_intl', to: 'ai_intl' },
  { from: 'srch_diplo', to: 'ai_intl' },
  { from: 'srch_domestic', to: 'ai_domestic' },
  { from: 'fetch_cctv', to: 'ai_domestic' },
  { from: 'ai_intl', to: 'ai_matrix' },
  { from: 'ai_domestic', to: 'ai_matrix' },
  { from: 'ai_matrix', to: 'save_doc' },
  { from: 'save_doc', to: 'mail' },
  { from: 'mail', to: 'log_done' },
  { from: 'log_done', to: 'end' },
];

// 布局：数据源一排 → 两个分析 → 终稿 → 落盘/邮件/日志
const layout = {
  start: { x: 40, y: 380 },
  py_date: { x: 200, y: 380 },
  cfg: { x: 360, y: 380 },
  srch_domestic: { x: 540, y: 120 },
  srch_intl: { x: 540, y: 300 },
  srch_diplo: { x: 540, y: 480 },
  srch_cctv: { x: 540, y: 660 },
  fetch_cctv: { x: 780, y: 660 },
  ai_intl: { x: 1020, y: 200 },
  ai_domestic: { x: 1020, y: 520 },
  ai_matrix: { x: 1280, y: 360 },
  save_doc: { x: 1520, y: 360 },
  mail: { x: 1520, y: 520 },
  log_done: { x: 1520, y: 660 },
  end: { x: 1520, y: 800 },
};

const def = {
  name: '金融政策日报',
  version: 1,
  description: '资深金融政策分析专家 · 每日情报：国内政策/国际事件/中美外交信号/新闻联播提炼 → 行业板块影响矩阵（A股/港股/美股/纳斯达克，积极与消极）→ Markdown 日报 → 邮件推送',
  inputs: {
    收件邮箱: '',
    关注板块: '银行/券商/保险、半导体、新能源、医药、军工、消费、地产、互联网',
    关键词: '金融政策 央行 货币 财政 监管',
  },
  nodes,
  edges,
  layout,
};

// ---------- 5. 自检（结构/引用/一致性），任何一条不过就不写盘 ----------
const errs = [];
const ids = new Set(nodes.map((n) => n.id));
const NODE_TYPES = new Set(['start', 'end', 'python', 'bash', 'http', 'web_search', 'web_fetch', 'subagent', 'session_input', 'if', 'switch', 'merge', 'subflow', 'loop', 'set_var', 'log', 'manual', 'image_generate', 'video_generate', 'file_save']);
for (const n of nodes) {
  if (!NODE_TYPES.has(n.type)) errs.push(`未知节点类型 ${n.type}（${n.id}）`);
  if (!n.label) errs.push(`${n.id} 缺 label`);
}
// 模板引用必须指向存在的节点
const refs = new Set();
const scan = (v) => {
  if (typeof v === 'string') {
    for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\./g)) refs.add(m[1]);
  } else if (v && typeof v === 'object') { for (const x of Object.values(v)) scan(x); }
};
for (const n of nodes) scan(n.params);
for (const r of refs) {
  if (r === 'inputs' || r === 'vars' || r === 'results') continue;
  if (!ids.has(r)) errs.push(`模板引用了不存在的节点：${r}`);
}
// next 与 edges 必须一致（edges 是执行真相，next 是兼容写法）
for (const e of edges) if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`边指向不存在的节点：${e.from}→${e.to}`);
for (const n of nodes) {
  const fromEdges = edges.filter((e) => e.from === n.id).map((e) => e.to);
  const nextList = n.next === undefined ? [] : (Array.isArray(n.next) ? n.next : [n.next]);
  const same = fromEdges.length === nextList.length && fromEdges.every((t) => nextList.includes(t));
  if (!same) errs.push(`next 与 edges 不一致：${n.id} edges=[${fromEdges}] next=[${nextList}]`);
}
// 环检测（DAG 必须无环）
{
  const adj = new Map(nodes.map((n) => [n.id, edges.filter((e) => e.from === n.id).map((e) => e.to)]));
  const state = new Map();
  const dfs = (id) => {
    if (state.get(id) === 1) { errs.push(`存在环：经过 ${id}`); return; }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const t of adj.get(id) ?? []) dfs(t);
    state.set(id, 2);
  };
  for (const n of nodes) dfs(n.id);
}
// 必填参数（对齐 src/registry/builtin.ts 的 schema.required）
const REQUIRED = { web_search: ['query'], web_fetch: ['url'], subagent: ['prompt', 'model'], file_save: ['filename'], log: ['message'], set_var: ['vars'], python: [], start: [], end: [] };
for (const n of nodes) {
  for (const k of REQUIRED[n.type] ?? []) {
    if (n.params?.[k] === undefined || n.params[k] === '') errs.push(`${n.id} 缺必填参数 ${k}`);
  }
}
if (errs.length) {
  console.error('✗ 自检未通过，不写盘：');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

mkdirSync(dirname(DEF_PATH), { recursive: true });
const existed = existsSync(DEF_PATH);
writeFileSync(DEF_PATH, JSON.stringify(def, null, 2) + '\n', 'utf8');
console.log(`✓ ${existed ? '覆盖' : '新建'} ${DEF_PATH}`);
console.log(`  节点 ${nodes.length} / 边 ${edges.length} / 工作流参数 ${Object.keys(def.inputs).length}`);
console.log('  ' + nodes.map((n) => n.id).join(' → ').slice(0, 200));
