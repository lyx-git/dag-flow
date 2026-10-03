// tmp-test/cdp/diag-switch-card.mjs — 量 switch 卡片实际高度构成（普通节点 vs switch 的差距从哪来）
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9345 });
const measure = `(() => {
  const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
  const find = (t) => cards.find((c) => (c.textContent || '').includes(t));
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  const sw = find('多路分支：运行模式') ?? find('分支很多') ?? find('模式分支');
  const plain = cards.find((c) => c !== sw && !(c.textContent || '').includes('分支'));
  const head = sw?.querySelector('.dsh-wf-fg-card-head');
  const sub = sw?.querySelector('.dsh-wf-fg-card-sub');
  const chips = sw?.querySelector('.dsh-wf-fg-chips');
  const note = sw?.querySelector('.dsh-wf-fg-card-note');
  const swBox = box(sw);
  const inner = (el) => { const b = box(el); return b ? { h: b.h, offTop: b.top - swBox.top, offBottom: swBox.bottom - b.bottom } : null; };
  return {
    plain: box(plain), sw: swBox, swMinH: sw?.style.minHeight ?? '',
    head: inner(head), sub: inner(sub), chips: inner(chips), note: inner(note),
    chipsStyle: chips ? { display: getComputedStyle(chips).display, wrap: getComputedStyle(chips).flexWrap, mt: getComputedStyle(chips).marginTop } : null,
    cardPad: sw ? getComputedStyle(sw).padding : '',
    ports: [...document.querySelectorAll('.workflow-port-render')].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, type: el.getAttribute('data-port-entity-type'), id: el.getAttribute('data-port-id') ?? el.getAttribute('data-port-entity-id') ?? el.getAttribute('data-port-key') ?? '', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }).slice(0, 8),
  };
})()`;

try {
  for (const [tag, q, nm] of [['chips', '&chips=1', 'diag-chips'], ['many', '&many=1', 'diag-many'], ['branch', '&branch=1', 'diag-branch']]) {
    await goto(page.cdp, `${BASE}/cdp-host.html?name=${nm}${q}`);
    await installHelpers(page.cdp);
    await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 20000 });
    await sleep(500);
    const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`tmp-test/diag-switch-card-${tag}.png`, Buffer.from(r.data, 'base64'));
    console.log('== ' + tag + ' ==');
    console.log(JSON.stringify(await evaluate(page.cdp, measure), null, 1));
  }
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
