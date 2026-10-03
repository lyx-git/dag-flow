// tmp-test/cdp/diag-line-ghost.mjs — 坐实「改分支键后画布残留幽灵线」：数 DOM 线数 vs def 线数
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9339 });
const ev = (expr) => evaluate(page.cdp, expr);
const stats = () => ev(`(() => ({
  domLines: document.querySelectorAll('.gedit-flow-activity-edge').length,
  domLineLabels: document.querySelectorAll('.dsh-wf-fg-line-label').length,
  defEdges: (window.__df_def?.edges ?? []).length,
  domNodes: document.querySelectorAll('.dsh-wf-fg-card').length,
  defNodes: (window.__df_def?.nodes ?? []).length,
}))()`);

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-ghost&branch=1`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length >= 5`, { timeout: 20000 });
  await sleep(600);
  console.log('初始      ', JSON.stringify(await stats()));

  // 改一次分支键（quick → full）
  await ev(`(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === 'quick');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })(); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  await ev(`(() => { [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].find((x) => x.textContent.includes('full')).click(); })(); true;`);
  await sleep(1500);
  console.log('改一次后  ', JSON.stringify(await stats()));

  // 再改一次（full → quick，切回原 case）
  await ev(`(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].filter((x) => x.textContent.trim() === 'full')[0];
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })(); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  await ev(`(() => { [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].find((x) => x.textContent.includes('quick')).click(); })(); true;`);
  await sleep(1500);
  console.log('再改一次后', JSON.stringify(await stats()));

  // 纯拖动节点（不碰线）作为对照：应当不增生
  await ev(`(() => { const b = [...document.querySelectorAll('.dsh-wf-fg-tb')].find((x) => (x.textContent || '').includes('整理')); b && b.click(); })(); true;`);
  await sleep(1200);
  console.log('整理布局后', JSON.stringify(await stats()));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
