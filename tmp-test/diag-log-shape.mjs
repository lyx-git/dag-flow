const BASE = 'http://127.0.0.1:3080';
const res = await fetch(`${BASE}/api/dag-flow/run/log?name=${encodeURIComponent('金融政策日报')}`);
const data = await res.json();
console.log('顶层键：', Object.keys(data));
const e = (data.entries ?? [])[0];
console.log('条目数：', data.entries?.length);
if (e) {
  console.log('条目键：', Object.keys(e));
  const brief = {};
  for (const [k, v] of Object.entries(e)) {
    brief[k] = typeof v === 'string' ? `string(${v.length})` : typeof v === 'object' && v ? Object.keys(v) : v;
  }
  console.log('样例：', JSON.stringify(brief, null, 1).slice(0, 900));
}
const ids = (data.entries ?? []).map((x) => x.nodeId ?? x.id ?? x.node);
console.log('节点 id 列表：', ids.join(', '));
