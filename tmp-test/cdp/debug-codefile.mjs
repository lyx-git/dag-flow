// tmp-test/cdp/debug-codefile.mjs — 诊断：python 选中后面板 label 列表
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';
import { spawn } from 'node:child_process';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

let page = null;
try {
  page = await launchPage({ port: 9333 });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=debug-codefile-${Date.now().toString(36)}`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 20000 });
  await evaluate(page.cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('Python'));
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.5, ey = er.top + er.height * 0.5;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((el) => (el.textContent || '').includes('Python'))`, { timeout: 15000 });
  await evaluate(page.cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      const idx = cards.findIndex((el) => el.textContent.includes('Python'));
      return window.__df_clickNode(idx);
    })(); true;
  `);
  await sleep(600);
  const labels = await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].map((l) => l.textContent)`);
  console.log('panel labels:', JSON.stringify(labels));
  const selected = await evaluate(page.cdp, `document.querySelector('.dsh-wf-fg-card.fg-selected')?.textContent?.slice(0, 30) ?? '(none)'`);
  console.log('selected card:', selected);
  const nodeTypes = await evaluate(page.cdp, `window.__df_def?.nodes?.map((n) => n.type).join(',')`);
  console.log('def types:', nodeTypes);
} finally {
  try { page?.close(); } catch { /* */ }
  server.kill();
}
