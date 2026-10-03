// tmp-test/cdp/diag-port-overlap.mjs — 量 switch 的输出端口元素与圆点是否真的重合（视觉上是不是只有一个点）
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9348 });
const measure = `(() => {
  const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式')) ?? [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('分支很多'));
  const r = card.getBoundingClientRect();
  const ports = [...document.querySelectorAll('.workflow-port-render')]
    .filter((el) => (el.getAttribute('data-port-id') || '').includes('sw_'))
    .map((el) => { const b = el.getBoundingClientRect(); return { id: el.getAttribute('data-port-id'), type: el.getAttribute('data-port-entity-type'),
      x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), h: Math.round(b.height) }; });
  const dots = [...document.querySelectorAll('.workflow-point-bg')]
    .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })
    .filter((p) => p.x > r.left - 30 && p.x < r.right + 30 && p.y > r.top - 30 && p.y < r.bottom + 30);
  return { card: { top: Math.round(r.top), h: Math.round(r.height), right: Math.round(r.right), centerY: Math.round(r.top + r.height / 2) }, ports, dots };
})()`;

try {
  for (const [tag, q, nm] of [['chips', '&chips=1', 'diag-overlap-chips'], ['many', '&many=1', 'diag-overlap-many']]) {
    await goto(page.cdp, `${BASE}/cdp-host.html?name=${nm}${q}`);
    await installHelpers(page.cdp);
    await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式') || (c.textContent || '').includes('分支很多'))`, { timeout: 20000 });
    await sleep(600);
    console.log('== ' + tag + ' ==');
    console.log(JSON.stringify(await evaluate(page.cdp, measure), null, 1));
  }
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
