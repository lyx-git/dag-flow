// tmp-test/cdp/diag-model-label.mjs — 诊断：为什么 model-select 偶发看到空模型列表
// 关注点：面板挂载时拉过一次 /models 后是否还会再拉（modelsLoaded 缓存）、加载顺序与 localStorage 恢复的关系。
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, lastPageError } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
console.log('fixture up =', up);

const page = await launchPage({ port: 9340 });
const probe = (cdp, tag) => evaluate(cdp, `(async () => {
  const r = await fetch('/api/dag-flow/models');
  const j = await r.json().catch(() => null);
  const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((x) => (x.textContent || '').includes('选择模型'));
  const s = row?.querySelector('select');
  return {
    tag: '${tag}',
    live: { status: r.status, n: (j?.models ?? []).length },
    options: [...(s?.options ?? [])].map((o) => o.textContent),
    reqs: (window.__df_reqs ?? []).filter((x) => String(x).includes('models')),
    lsKeys: Object.keys(localStorage),
  };
})()`);

try {
  // ① 先设模式（此时页面是 about:blank，先导航到夹具再设）
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-model-label&stale=1&t=0`);
  await evaluate(page.cdp, `(async () => { const r = await fetch('/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'name' }) }); return (await r.json()).mode; })()`);
  console.log('模式已设为 name');

  // ② 重新加载页面（加载时面板若自动选中过 subagent，就会在此时拉一次 /models）
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-model-label&stale=1&t=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('AI：旧模型快照'))`, { timeout: 20000 });
  console.log('页面加载后（未点击）:', JSON.stringify(await probe(page.cdp, '加载后未点击'), null, 1));

  // ③ 点击 AI 节点
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('AI：旧模型快照'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('选择模型'))`, { timeout: 8000 });
  await sleep(600);
  console.log('点击 AI 节点后:', JSON.stringify(await probe(page.cdp, '点击后'), null, 1));

  // ④ 取消选中再重新点击（看 modelsLoaded 是否让面板不再重新拉取）
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-fg-editor')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true; })()`);
  await sleep(300);
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('AI：旧模型快照'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await sleep(800);
  console.log('取消选中→再点同一节点:', JSON.stringify(await probe(page.cdp, '再点击'), null, 1));
  const pe = lastPageError();
  if (pe) console.log('页面异常:', pe.split('\n')[0]);
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
