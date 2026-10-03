// tmp-test/cdp/diag-model-reselect.mjs — 复现「选完模型后重进下拉没有定位到已选模型」
// 步骤：①打开 AI 节点面板 ②把下拉改成 probe-flash ③重选节点（面板重挂载）④读下拉 value 与 def 里的 model
// 判据：④ 若 value 回到旧值/空 → 复现（面板 props 未随 def 更新）；若仍是 probe-flash → 未复现
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, lastPageError } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
console.log('fixture up =', up);

const page = await launchPage({ port: 9341 });
const read = (cdp, tag) => evaluate(cdp, `(() => {
  const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
  const s = row?.querySelector('select');
  const n = window.__df_def?.nodes?.find((x) => x.id === 'ai_stale');
  return { tag: '${tag}', selectValue: s?.value ?? '(无下拉)', defModel: n?.params?.model ?? '(无)' };
})()`);
const clickNode = `(() => {
  const hosts = window.__df_qa('.dsh-wf-fg-node-host');
  const el = hosts.find((h) => (h.textContent || '').includes('AI：旧模型快照'));
  window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  return true;
})()`;
const deselect = `(() => {
  const ed = document.querySelector('.dsh-wf-fg-editor');
  if (ed) { window.__df_fire(ed, 'mousedown'); window.__df_fire(ed, 'mouseup'); window.__df_fire(ed, 'click'); }
  return true;
})()`;

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-model-reselect&stale=1&t=0`);
  await evaluate(page.cdp, `(async () => { await fetch('/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'name' }) }); return true; })()`);
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-model-reselect&stale=1&t=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('AI：旧模型快照'))`, { timeout: 20000 });
  await evaluate(page.cdp, clickNode);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('选择模型'))`, { timeout: 8000 });
  await sleep(400);
  console.log('① 初次打开面板:', JSON.stringify(await read(page.cdp, '初次')));

  // ② 手动改下拉为 probe-flash（模拟用户选择）
  const target = 'dsh:llm:probe-provider:probe-flash';
  const changed = await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
    const s = row?.querySelector('select');
    if (!s) return 'no-select';
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(s, ${JSON.stringify(target)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  console.log('② 改选模型:', changed, JSON.stringify(await read(page.cdp, '改选后')));
  await sleep(500); // 等 def 镜像同步

  // ③ 取消选中 → 重新点节点（面板重挂载）
  await evaluate(page.cdp, deselect);
  await sleep(300);
  await evaluate(page.cdp, clickNode);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('选择模型'))`, { timeout: 8000 });
  await sleep(500);
  console.log('③ 重进面板:', JSON.stringify(await read(page.cdp, '重进')));

  const pe = lastPageError();
  if (pe) console.log('页面异常:', pe.split('\n')[0]);
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
