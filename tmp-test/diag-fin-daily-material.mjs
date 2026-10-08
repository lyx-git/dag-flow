// tmp-test/diag-fin-daily-material.mjs — 诊断「金融政策日报」最近一次运行到底拿到多少材料
//   只读，不执行工作流、不花钱：优先读宿主内存里的运行日志（GET /run/log），
//   读不到就退回去读 <工作区>/.dag-flow/runs/ 里最新的运行记录。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://127.0.0.1:3080';
const WF = '金融政策日报';
const RUNS = 'D:\\workspace\\pluginspace\\.dag-flow\\runs';

const len = (v) => (typeof v === 'string' ? v.length : v == null ? 0 : JSON.stringify(v).length);
const countIn = (s, kw) => (typeof s === 'string' ? s.split(kw).length - 1 : 0);

function summarizeEntry(e) {
  const out = e.out ?? null;
  const bits = [`${String(e.id).padEnd(16)} ${String(e.type ?? '').padEnd(12)} ${String(e.status ?? '').padEnd(9)} ${String(e.durationMs ?? '').padStart(6)}ms`];
  if (out && typeof out === 'object' && Array.isArray(out.results)) {
    const snippets = out.results.map((r) => len(r?.snippet ?? r?.content ?? ''));
    bits.push(`结果 ${out.results.length} 条，摘要字数 [${snippets.join(',')}] 合计 ${snippets.reduce((a, b) => a + b, 0)}`);
    bits.push(`标题示例: ${String(out.results[0]?.title ?? '').slice(0, 40)}`);
  } else if (typeof out === 'string') {
    bits.push(`文本 ${out.length} 字`);
  } else if (out && typeof out === 'object') {
    const keys = Object.keys(out);
    bits.push(`字段 ${keys.join('/')} 合计 ${len(out)} 字`);
  }
  const text = typeof out === 'string' ? out : JSON.stringify(out ?? '');
  const lack = countIn(text, '材料不足');
  if (lack) bits.push(`★含「材料不足」${lack} 处`);
  return bits.join('  |  ');
}

// ① 先试宿主内存日志
let entries = null;
try {
  const r = await fetch(`${BASE}/api/dag-flow/run/log?name=${encodeURIComponent(WF)}`);
  if (r.ok) {
    const d = await r.json();
    entries = d.entries ?? [];
    console.log(`[来源] 宿主运行日志：runId=${d.runId} status=${d.runStatus} origin=${d.origin} 条目=${entries.length}`);
  } else {
    console.log(`[来源] /run/log 返回 ${r.status}（宿主重启后内存日志会丢，正常）`);
  }
} catch (e) {
  console.log(`[来源] /run/log 不可达：${e.message}`);
}

// ② 退化：读最新的运行记录文件
if (!entries || entries.length === 0) {
  let files = [];
  try {
    files = readdirSync(RUNS).filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, m: statSync(join(RUNS, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  } catch (e) { console.log(`[来源] 读 runs 目录失败：${e.message}`); }
  if (files.length === 0) { console.log('没有可用的运行记录。'); process.exit(0); }
  const newest = files[0];
  const rec = JSON.parse(readFileSync(join(RUNS, newest.f), 'utf8'));
  console.log(`[来源] 运行记录文件 ${newest.f}（${new Date(newest.m).toLocaleString()}）`);
  const results = rec?.results ?? rec?.summary?.results ?? {};
  entries = Object.entries(results).map(([id, r]) => ({ id, type: r?.type, status: r?.status, durationMs: r?.durationMs, out: r?.out, error: r?.error }));
  console.log(`  整体 status=${rec?.status ?? rec?.summary?.status} 节点=${entries.length}`);
}

console.log('\n=== 逐节点材料量 ===');
for (const e of entries) console.log('  ' + summarizeEntry(e));

console.log('\n=== 「材料不足」总出现次数 ===');
let total = 0;
for (const e of entries) total += countIn(typeof e.out === 'string' ? e.out : JSON.stringify(e.out ?? ''), '材料不足');
console.log('  ' + total + ' 处');
