// tmp-test/probe-collector.mjs — 实测新版采集器（权威列表页 → 文章正文 → 不足则换方向重搜）
//   ① /run-node 跑该维度的干净查询拿第一轮结果（注入 RAW）
//   ② 注入 collector-template.py 的占位符（用 replaceAll，避免 docstring 抢先匹配）
//   ③ 内置 Python 跑，报材料字数 / 篇数 / 状态行
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3080';
const PY = 'D:\\workspace\\pluginspace\\dag-flow\\runtime\\python\\3.12.14+20260901\\win-x64\\python.exe';
const OUT = 'tmp-test/_collector-probe';

// —— 维度表（构建工作流时共用同一份）——
export const DIMS = [
  { dim: '政策', q: '央行 货币政策 降准降息 公开市场操作 政策',
    sources: ['http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', 'https://www.stcn.com/'],
    keywords: ['政策', '央行', '财政', '监管', '国务院', '通知', '意见', '会议', '降准', '降息', '贴息', 'LPR', '货币政策', '证监会', '金融监管'],
    alt: ['国务院 财政部 稳增长 最新政策 发布', '金融监管总局 新规 通知 解读'] },
  { dim: '资金', q: '银行间 资金面 逆回购 净投放 利率 成交额',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['资金', '流动性', '利率', '逆回购', 'MLF', '净投放', 'DR007', '北向', '融资', '两融', '成交额', 'shibor', '主力'],
    alt: ['央行 公开市场操作 净投放 公告', 'A股 主力资金 北向资金 流向 统计'] },
  { dim: '股市', q: 'A股 上证指数 深证成指 板块 行情 涨跌',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['A股', '股市', '上证', '深证', '创业板', '指数', '板块', '涨', '跌', '行情', '涨停', '个股', '沪指', '收盘'],
    alt: ['股市 复盘 涨跌 原因 分析', '沪深两市 收盘 板块 表现'] },
  { dim: '基金', q: '公募基金 新发 ETF 规模 净值 调仓',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['基金', 'ETF', '公募', '私募', '募集', '净值', '份额', '调仓', '重仓', '发行'],
    alt: ['ETF 资金流入 规模 排行', '公募基金 发行 业绩 排名 最新'] },
  { dim: '汇率', q: '人民币 汇率 中间价 离岸 美元指数 外汇',
    sources: ['http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', 'https://www.stcn.com/'],
    keywords: ['汇率', '人民币', '美元', '中间价', '离岸', '外汇', '贬值', '升值', '货币网', '结售汇'],
    alt: ['人民币 汇率 中间价 走势 分析', '外汇局 跨境资金 流动 数据'] },
  { dim: '银行', q: '银行 净息差 存款利率 贷款 不良率 理财',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['银行', '存款', '贷款', '净息差', '不良', '息差', '信贷', '理财', '拨备', '大行'],
    alt: ['银行股 业绩 息差 财报 分析', '商业银行 信贷 投放 数据 最新'] },
  { dim: '国际', q: '美联储 利率决议 美股 美债 通胀 非农',
    sources: ['https://www.stcn.com/', 'https://finance.eastmoney.com/a/ccjdd.html'],
    keywords: ['美联储', '美国', '欧洲', '欧央行', '日本', '美债', '美股', '油价', '黄金', '地缘', '关税', '通胀', '非农', '全球'],
    alt: ['全球市场 隔夜 美股 美债 表现', '美联储 降息 预期 最新 表态'] },
];

async function search(query) {
  const r = await fetch(`${BASE}/api/dag-flow/run-node`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeType: 'web_search', params: { provider: 'bing', query, timeRange: 'week' } }),
  });
  const d = await r.json().catch(() => null);
  const t = d?.summary?.results?.target ?? d?.results?.target ?? null;
  return t?.out?.results ?? [];
}

mkdirSync(OUT, { recursive: true });
const tpl = readFileSync('tmp-test/collector-template.py', 'utf8');
const only = process.argv.slice(2);            // 可选：只测某几个维度

for (const d of DIMS) {
  if (only.length && !only.includes(d.dim)) continue;
  const results = await search(d.q);
  const code = tpl
    .replaceAll('@@DIM@@', d.dim)
    .replaceAll('@@SOURCES@@', JSON.stringify(d.sources))
    .replaceAll('@@KEYWORDS@@', JSON.stringify(d.keywords))
    .replaceAll('@@ALT@@', JSON.stringify(d.alt))
    .replaceAll('@@RAW@@', JSON.stringify(results));
  const f = `${OUT}/${d.dim}.py`;
  writeFileSync(f, code, 'utf8');
  const t0 = Date.now();
  let out = '';
  try {
    out = execFileSync(PY, [f], { encoding: 'utf8', timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
  } catch (e) {
    out = `[运行失败] ${e.message}`;
  }
  writeFileSync(`${OUT}/${d.dim}.out.txt`, out, 'utf8');
  console.log(`\n===== ${d.dim}（${((Date.now() - t0) / 1000).toFixed(1)}s）上游搜索 ${results.length} 条 =====`);
  console.log('  ' + out.split('\n')[0]);
  let n = 0;
  for (const m of out.matchAll(/^来源: (\S+)/gm)) {
    if (n++ >= 3) break;
    console.log(`    来源 ${n}: ${m[1].slice(0, 88)}`);
  }
}
console.log('\n（明细写到 tmp-test/_collector-probe/*.out.txt）');
