// tmp-test/probe-real-versions.mjs — 对**真实运行中的宿主**（127.0.0.1:3080）验证版本快照链路
//   默认只读；加 --write 才做"建临时工作流→连存多次→看版本数→删除"的端到端写测试（净零，用后即删）。
//   用法：
//     node tmp-test/probe-real-versions.mjs            # 只读盘点
//     node tmp-test/probe-real-versions.mjs --write    # 端到端写测试（会建/删一个临时工作流）
const BASE = 'http://127.0.0.1:3080';
const WRITE = process.argv.includes('--write');

const j = async (path, init) => {
  const res = await fetch(BASE + path, init);
  let body = null;
  try { body = await res.json(); } catch { /* */ }
  return { status: res.status, body };
};
const get = (p) => j(p);
const post = (p, obj) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

const list = await get('/api/dag-flow/workflows');
if (list.status !== 200) {
  console.error('✗ 宿主不可达或接口异常：HTTP ' + list.status + ' ' + JSON.stringify(list.body)?.slice(0, 200));
  process.exit(1);
}
console.log('宿主存活。存储目录 =', list.body?.storage?.dir, '(source:', list.body?.storage?.source + ')');
console.log('工作流清单：');
for (const wf of list.body?.workflows ?? []) {
  const v = await get(`/api/dag-flow/workflows/${encodeURIComponent(wf.name)}/versions`);
  const n = v.body?.versions?.length ?? 0;
  const newest = v.body?.versions?.[0]?.ts ?? '-';
  console.log(`  ${wf.name}  (${wf.nodes} 节点)  →  版本 ${n} 个，最新 ${newest}`);
}

if (!WRITE) {
  console.log('\n（只读盘点结束。加 --write 可跑端到端写测试）');
  process.exit(0);
}

// ---------- 端到端写测试（临时工作流，用后即删）----------
const name = 'verprobe-' + Date.now().toString(36);
const mk = (extra) => ({
  name, version: 1,
  nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }, ...extra],
});
const cnt = async (tag) => {
  const v = await get(`/api/dag-flow/workflows/${encodeURIComponent(name)}/versions`);
  const n = v.body?.versions?.length ?? -1;
  console.log(`  ${tag} → 版本数 ${n}`);
  return n;
};

console.log(`\n--- 端到端写测试（临时工作流 ${name}）---`);
const s1 = await post('/api/dag-flow/workflows/save', { name, def: mk([]), snapshot: true });
console.log('  保存#1 HTTP', s1.status, JSON.stringify(s1.body));
const c1 = await cnt('保存#1（snapshot:true，内容 A）');
const s2 = await post('/api/dag-flow/workflows/save', { name, def: mk([{ id: 'log', type: 'log', params: { message: 'B' } }]), snapshot: true });
console.log('  保存#2 HTTP', s2.status);
const c2 = await cnt('保存#2（snapshot:true，内容 B ← 已改）');
const s3 = await post('/api/dag-flow/workflows/save', { name, def: mk([{ id: 'log', type: 'log', params: { message: 'B' } }]), snapshot: true });
console.log('  保存#3 HTTP', s3.status);
const c3 = await cnt('保存#3（snapshot:true，内容同 B → 应去重）');
const s4 = await post('/api/dag-flow/workflows/save', { name, def: mk([{ id: 'log', type: 'log', params: { message: 'C' } }]), snapshot: false });
console.log('  保存#4 HTTP', s4.status);
const c4 = await cnt('保存#4（snapshot:false，内容 C → 不该产版本）');
const s5 = await post('/api/dag-flow/workflows/save', { name, def: mk([{ id: 'log', type: 'log', params: { message: 'D' } }]), snapshot: true });
console.log('  保存#5 HTTP', s5.status);
const c5 = await cnt('保存#5（snapshot:true，内容 D ← 已改）');

const del = await j(`/api/dag-flow/workflows/${encodeURIComponent(name)}`, { method: 'DELETE' });
const after = await get(`/api/dag-flow/workflows/${encodeURIComponent(name)}`);
console.log('  清理：DELETE HTTP', del.status, '→ 再读 HTTP', after.status, '（期望 404）');

console.log('\n判定（真实宿主）：');
console.log('  #1=%d  #2=%d  → %s', c1, c2, c2 === c1 + 1 ? 'OK 改内容再存会新增版本' : '★ 异常：改了内容却没有新增版本');
console.log('  #3=%d（同内容）→ %s', c3, c3 === c2 ? 'OK 去重' : '★ 异常：重复保存产生了重复版本');
console.log('  #4=%d（snapshot:false）→ %s', c4, c4 === c3 ? 'OK 自动保存不产版本' : '★ 异常');
console.log('  #5=%d → %s', c5, c5 === c4 + 1 ? 'OK 再改内容会新增版本' : '★ 异常：改内容后没新增版本');
