// tmp-test/scan-modes.mjs — 只读扫描：工作区里每个工作流属于哪种执行模式 + 有没有设了却不生效的 onError
// 用法：node tmp-test/scan-modes.mjs [工作流目录]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'D:/workspace/pluginspace/.dag-flow/workflow';
const rows = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('.')) continue;
  let def;
  try { def = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { rows.push({ f, err: e.message }); continue; }
  const nodes = def.nodes ?? [];
  const edges = def.edges ?? [];
  const onError = nodes.filter((n) => n.onError).map((n) => `${n.id}:${typeof n.onError === 'object' ? `goto(${n.onError.goto})` : n.onError}`);
  const tolerate = nodes.filter((n) => n.tolerate === true).map((n) => n.id);

  // next-only 的自环检测（★ 2026-10-04 轮 4 后所有定义都走 DAG（会判环）→ 这里保留只是给旧文件做历史体检）
  let cycle = '';
  if (edges.length === 0) {
    const nexts = new Map();
    for (const n of nodes) {
      const nx = n.next;
      const arr = typeof nx === 'string' ? [nx]
        : Array.isArray(nx) ? nx
          : (nx && typeof nx === 'object' ? Object.values(nx) : []);
      nexts.set(n.id, arr.filter((x) => typeof x === 'string'));
    }
    const state = new Map();
    const dfs = (id, path) => {
      const s = state.get(id);
      if (s === 1) { cycle = [...path, id].join(' -> '); return true; }
      if (s === 2) return false;
      state.set(id, 1);
      for (const t of nexts.get(id) ?? []) if (dfs(t, [...path, id])) return true;
      state.set(id, 2);
      return false;
    };
    for (const n of nodes) { if (cycle) break; if (dfs(n.id, [])) break; }
  }
  rows.push({ f, nodes: nodes.length, edges: edges.length, mode: edges.length ? 'DAG' : 'next-only', onError, tolerate, cycle });
}
console.log(JSON.stringify(rows, null, 1));
const dag = rows.filter((r) => r.mode === 'DAG').length;
const next = rows.filter((r) => r.mode === 'next-only').length;
console.log(`\n合计 ${rows.length} 个：DAG（带 edges）= ${dag}，next-only（顺序模式）= ${next}`);
const dead = rows.filter((r) => r.mode === 'DAG' && r.onError.length > 0);
console.log('★ 是 DAG 却设了 onError（当前执行器不读 = 死配置）：' + (dead.length ? JSON.stringify(dead.map((r) => ({ f: r.f, onError: r.onError }))) : '无'));
const cyc = rows.filter((r) => r.cycle);
console.log('★ next-only 且存在自环（现在所有定义都走 DAG，会以 DAG_CYCLE 被拒）：' + (cyc.length ? JSON.stringify(cyc.map((r) => ({ f: r.f, cycle: r.cycle }))) : '无'));
const tol = rows.filter((r) => r.tolerate.length);
console.log('用「失败不影响流程」的工作流：' + (tol.length ? JSON.stringify(tol.map((r) => ({ f: r.f, nodes: r.tolerate }))) : '无'));
