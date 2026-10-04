// tmp-test/fix-workflows-round5.mjs — 修正"原工作流不适应新语义/新校验"的地方（2026-10-04 轮 5）
//   ① 非法节点 id（数字 id 如 "192850"，违反 ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$ → 整个文件执行不了）
//      规范化为 `<type>_<原id>`，并同步：next / edges / layout / onError.goto / params 里的模板引用 / switch cases 值
//   ② 死配置：onError:{goto} 目标在**本节点之前或同层**（轮 3 起只对后面的层生效，等于没配）→ 删掉该键（回到默认 stop）
//   ③ 「金融政策日报」的 cfg:continue：cfg 是数据源、6 个下游引用 {{cfg.*}} → continue 会让"运行成功但什么都没做"，
//      删掉该键（回到默认 stop：数据源失败就该报错）
//   ④ 「全节点演示-技术简报」switch_mode：cases 与出边不一致 + video 没有出边 → 以**出边为准**对齐三处（cases / next / edges）
//      （已有的 quick→log_mode、image→image_gen、full→video_gen 更符合意图；补 video→video_gen）
// 用法：node tmp-test/fix-workflows-round5.mjs          （真跑，会写盘 + 备份）
//       node tmp-test/fix-workflows-round5.mjs --dry    （只看会改什么）
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'D:/workspace/pluginspace/.dag-flow/workflow';
const BK = 'tmp-test/backup-round5';
const DRY = process.argv.includes('--dry');
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

const changes = [];
const log = (f, msg) => { changes.push(`  ${f}: ${msg}`); console.log(`  ${f}: ${msg}`); };

function layersOf(def) {
  const nodes = def.nodes ?? [];
  const edges = def.edges ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const work = new Map(indeg);
  const layerOf = new Map();
  let frontier = [...work.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let li = 0;
  while (frontier.length) {
    for (const id of frontier) layerOf.set(id, li);
    const next = [];
    for (const id of frontier) for (const to of adj.get(id) ?? []) { work.set(to, work.get(to) - 1); if (work.get(to) === 0) next.push(to); }
    frontier = next; li++;
  }
  return layerOf;
}

/** 深度遍历替换字符串里的 {{旧id. 引用 */
function remapTemplates(node, map) {
  const walk = (v) => {
    if (typeof v === 'string') {
      let s = v;
      for (const [oldId, newId] of map) {
        s = s.replace(new RegExp(`\\{\\{\\s*${oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[.\\s}])`, 'g'), `{{${newId}`);
      }
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); }
    return v;
  };
  node.params = walk(node.params ?? {});
}

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('.')) continue;
  const path = join(DIR, f);
  let def;
  try { def = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  const before = JSON.stringify(def);
  const nodes = def.nodes ?? [];

  // ── ① 非法 id 规范化 ──
  const map = new Map();
  const used = new Set(nodes.map((n) => String(n.id)));
  for (const n of nodes) {
    const oldId = String(n.id);
    if (ID_RE.test(oldId)) continue;
    let base = `${n.type}_${oldId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    if (!/^[a-zA-Z]/.test(base)) base = `n_${base}`;
    let id = base, i = 2;
    while (used.has(id)) id = `${base}_${i++}`;
    used.add(id);
    map.set(oldId, id);
  }
  if (map.size) {
    for (const n of nodes) {
      const oldId = String(n.id);
      if (map.has(oldId)) n.id = map.get(oldId);
      // next（string / array / object 值）
      const remap = (v) => (typeof v === 'string' ? (map.get(v) ?? v) : v);
      if (typeof n.next === 'string') n.next = remap(n.next);
      else if (Array.isArray(n.next)) n.next = n.next.map(remap);
      else if (n.next && typeof n.next === 'object') for (const k of Object.keys(n.next)) n.next[k] = remap(n.next[k]);
      if (n.onError && typeof n.onError === 'object' && n.onError.goto) n.onError.goto = remap(n.onError.goto);
      // switch cases 的值也是节点 id
      if (n.params?.cases && typeof n.params.cases === 'object') for (const k of Object.keys(n.params.cases)) n.params.cases[k] = remap(n.params.cases[k]);
      remapTemplates(n, map);
    }
    for (const e of def.edges ?? []) { e.from = map.get(String(e.from)) ?? e.from; e.to = map.get(String(e.to)) ?? e.to; }
    if (def.layout) { const l = {}; for (const [k, v] of Object.entries(def.layout)) l[map.get(k) ?? k] = v; def.layout = l; }
    log(f, `① 规范化 ${map.size} 个非法 id：${[...map.entries()].map(([o, n]) => `${o}→${n}`).join(', ')}`);
  }

  // ── ② 回跳/同层 goto（永不生效）→ 删键 ──
  const layerOf = layersOf(def);
  for (const n of def.nodes ?? []) {
    if (!n.onError || typeof n.onError !== 'object' || !n.onError.goto) continue;
    const s = layerOf.get(n.id), t = layerOf.get(n.onError.goto);
    if (s !== undefined && t !== undefined && t <= s) {
      log(f, `② 删除死配置 ${n.id}(L${s}) onError.goto → ${n.onError.goto}(L${t})（只对后面的层生效，等于没配；回到默认 stop）`);
      delete n.onError;
    }
  }

  // ── ③ cfg:continue（数据源失败却记成功）→ 删键 ──
  for (const n of def.nodes ?? []) {
    if (n.id === 'cfg' && n.onError === 'continue') {
      log(f, '③ 删除 cfg 的 onError:"continue"（数据源失败应报错；continue 会让运行"成功但什么都没做"）');
      delete n.onError;
    }
  }

  // ── ④ switch：cases / next / edges 三处对齐 ──
  //   判据：**cases 的值若都是"存在的节点 id" → 以 cases 为准**（它是面板里的分支表，且本例的 description
  //   明确写了四档语义：quick 默认 / full=图片 / video=视频 / image 与 quick 同路）；
  //   若 cases 的值不是节点 id（历史遗留的说明文字）→ 以 edges 为准，重建 cases。
  for (const n of (def.nodes ?? []).filter((x) => x.type === 'switch')) {
    const nodeIds = new Set((def.nodes ?? []).map((x) => String(x.id)));
    const caseObj = n.params?.cases ?? {};
    const entries = Object.entries(caseObj).filter(([, to]) => typeof to === 'string' && to);
    const casesValid = entries.length > 0 && entries.every(([, to]) => nodeIds.has(to));
    const want = {};
    if (casesValid) {
      for (const [c, to] of entries) want[c] = to;
      log(f, `④ switch ${n.id}：以 cases 为准对齐（${JSON.stringify(want)}）`);
    } else {
      for (const e of (def.edges ?? []).filter((e2) => e2.from === n.id)) if (e.when) want[e.when] = e.to;
      log(f, `④ switch ${n.id}：cases 不是节点 id（历史说明文字），改以 edges 为准重建 → ${JSON.stringify(want)}`);
    }
    // 没有任何有效分支（cases 不是节点 id、也没有出边）→ **不擅自重连**，只报告（要修得先确认意图）
    if (Object.keys(want).length === 0) {
      log(f, `④ switch ${n.id}：既没有有效 cases 也没有出边 → 跳过（结构残缺，需人工确认分支意图后再修）`);
      continue;
    }
    // 出边：补齐缺失、改写对不上的、删掉多出来的（同一个 when 只保留一条，避免歧义）
    const outs = (def.edges ?? []).filter((e) => e.from === n.id);
    for (const [c, to] of Object.entries(want)) {
      const hit = outs.filter((e) => e.when === c);
      if (hit.length === 0) { (def.edges ??= []).push({ from: n.id, to, when: c }); log(f, `④ switch ${n.id}：补出边 ${c} → ${to}`); }
      else {
        for (const h of hit) if (h.to !== to) { log(f, `④ switch ${n.id}：改出边 ${c}：${h.to} → ${to}`); h.to = to; }
        for (const dup of hit.slice(1)) { def.edges = def.edges.filter((x) => x !== dup); log(f, `④ switch ${n.id}：删除重复的 ${c} 出边`); }
      }
    }
    for (const e of outs) if (e.when && !(e.when in want)) { def.edges = def.edges.filter((x) => x !== e); log(f, `④ switch ${n.id}：删除多余出边（when=${e.when} → ${e.to}）`); }
    const oldCases = JSON.stringify(n.params?.cases ?? {});
    n.params = { ...(n.params ?? {}), cases: want };
    n.next = { ...want };
    if (oldCases !== JSON.stringify(want)) log(f, `④ switch ${n.id}：cases 更新为 ${JSON.stringify(want)}`);
  }

  if (JSON.stringify(def) === before) continue;
  if (!DRY) {
    if (!existsSync(BK)) mkdirSync(BK, { recursive: true });
    copyFileSync(path, join(BK, f));
    writeFileSync(path, JSON.stringify(def, null, 2) + '\n', 'utf8');
  }
}
console.log(`\n${DRY ? '[DRY] 将修改' : '已修改'} ${new Set(changes.map((c) => c.trim().split(':')[0])).size} 个文件，共 ${changes.length} 处`);
if (!DRY) console.log(`备份：${BK}/`);
