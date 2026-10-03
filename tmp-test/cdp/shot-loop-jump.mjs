// tmp-test/cdp/shot-loop-jump.mjs — 拍子工作流跳转的真实渲染：①进入子工作流（header 返回胶囊 + 面包屑）
//                                                  ②一键返回后回到父工作流并选中来源循环节点
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

const NAME = 'shot-loop-jump';
const CHILD = `${NAME}-child`;
const page = await launchPage({ port: 9342 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
const dbl = async (label) => {
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-node-host')].some((h) => (h.textContent || '').includes(${JSON.stringify(label)}))`, { timeout: 15000 });
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes(${JSON.stringify(label)}));
    window.__df_fire(el, 'dblclick');
    return true;
  })()`);
};
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=${NAME}&jump=1`);
  await evaluate(page.cdp, `(async () => {
    const child = { name: ${JSON.stringify(CHILD)}, version: 1,
      nodes: [
        { id: 'start', type: 'start', label: '子：开始', params: {} },
        { id: 'mid', type: 'set_var', label: '子：中间节点', params: { vars: { ok: '1' } } },
        { id: 'end', type: 'end', label: '子：结束', params: {} }],
      edges: [{ from: 'start', to: 'mid' }, { from: 'mid', to: 'end' }],
      layout: { start: { x: 80, y: 200 }, mid: { x: 380, y: 200 }, end: { x: 680, y: 200 } } };
    await fetch('/api/dag-flow/workflows/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: child.name, def: child }) });
    return true;
  })()`);
  await installHelpers(page.cdp);
  await dbl('循环：有循环体');
  await waitFor(page.cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(CHILD)}`, { timeout: 12000 });
  await sleep(700);
  await shot('tmp-test/loop-jump-child.png');

  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-nav-back').click(); return true; })()`);
  await waitFor(page.cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(NAME)}`, { timeout: 12000 });
  await sleep(700);
  await shot('tmp-test/loop-jump-back.png');

  const info = await evaluate(page.cdp, `(() => ({
    当前工作流: document.querySelector('.dsh-wf-name-input')?.value,
    选中节点: (document.querySelector('.dsh-wf-fg-card.fg-selected')?.textContent ?? '(无)').slice(0, 30),
    返回胶囊: document.querySelector('.dsh-wf-nav-back')?.textContent ?? '(无，已回最外层)',
    面包屑: document.querySelector('.dsh-wf-crumb')?.textContent ?? '(无)',
  }))()`);
  console.log('已保存 tmp-test/loop-jump-child.png 与 tmp-test/loop-jump-back.png');
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
