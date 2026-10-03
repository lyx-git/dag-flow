// tmp-test/diag-models-mode.mjs — 诊断：fixture 的 /models 与 /__models-mode 控制口是否按预期工作
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:34177'; // picker-server 端口是硬编码的 34177
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
console.log('fixture up =', up);
try {
  const g1 = await (await fetch(BASE + '/api/dag-flow/models')).json();
  console.log('① 默认模式 GET /models →', JSON.stringify(g1));
  const p = await fetch(BASE + '/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'name' }) });
  console.log('② POST /__models-mode ->', p.status, JSON.stringify(await p.json().catch(() => null)));
  const g2 = await (await fetch(BASE + '/api/dag-flow/models')).json();
  console.log('③ 切 name 后 GET /models →', JSON.stringify(g2).slice(0, 300));
  const p2 = await fetch(BASE + '/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'empty' }) });
  console.log('④ POST 回 empty ->', p2.status);
  const g3 = await (await fetch(BASE + '/api/dag-flow/models')).json();
  console.log('⑤ 回到 empty GET /models →', JSON.stringify(g3));
} finally {
  server.kill();
}
