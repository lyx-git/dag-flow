// tmp-test/cdp/diag-port-dom.mjs — 诊断：switch 端口圆点在 DOM 里的实际位置/类名（用于校对行序号与端口是否同高）
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
const page = await launchPage({ port: 9343 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-port-dom&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  await sleep(600);
  const info = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const host = card?.closest('.dsh-wf-fg-node-host') ?? card;
    const wrap = host?.parentElement ?? card;
    const all = [...document.querySelectorAll('*')].filter((el) => /port/i.test(el.className?.toString?.() ?? ''));
    const desc = (el) => {
      const r = el.getBoundingClientRect();
      return { cls: String(el.className).slice(0, 60), tag: el.tagName, x: Math.round(r.left), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      cardRect: (() => { const r = card.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      rows: [...card.querySelectorAll('.dsh-wf-fg-rou')].map((r) => ({ t: r.textContent, y: Math.round(r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) })),
      dotCenters: all.filter((el) => /workflow-point-bg/.test(String(el.className)))
        .map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }),
      portAnchors: all.filter((el) => /workflow-port-render/.test(String(el.className)))
        .map((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), cy: Math.round(r.top + r.height / 2), h: Math.round(r.height) }; }),
    };
  })()`);
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
