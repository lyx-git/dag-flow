// tmp-test/cdp/shot-model-label.mjs — 一次性脚本：拍 subagent 模型下拉的「显示名」实装效果
// 用法：node tmp-test/cdp/shot-model-label.mjs（工作目录 = dag-flow 仓库根）
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

const page = await launchPage({ port: 9339 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
try {
  // 夹具 /models 控制口切到「带显示名」模式
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-model-label&stale=1`);
  await evaluate(page.cdp, `(async () => {
    await fetch('/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'name' }) });
    return true;
  })()`);
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-model-label&stale=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('AI：旧模型快照'))`, { timeout: 20000 });
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('AI：旧模型快照'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('选择模型'))`, { timeout: 8000 });
  // 展开下拉（CDP 截图里 <select> 展开态拍不到，改为把 option 文案回读后打印，图里看选中态与下方细字）
  await sleep(600);
  await shot('tmp-test/model-label-real.png');

  const info = await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
    const s = row?.querySelector('select');
    return {
      value: s?.value,
      options: [...(s?.options ?? [])].map((o) => o.textContent),
      hints: [...document.querySelectorAll('.dsh-wf-panel-hint')].map((h) => (h.textContent || '').trim()).filter((t) => t.includes('id：') || t.includes('当前值')),
    };
  })()`);
  console.log('已保存 tmp-test/model-label-real.png');
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
