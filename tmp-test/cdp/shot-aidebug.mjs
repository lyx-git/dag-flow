// tmp-test/cdp/shot-aidebug.mjs — 拍「AI 调试」两张图：①运行日志（只看失败 + AI 调用详情）②试跑面板（AI 调试块）
//   用法：node tmp-test/cdp/shot-aidebug.mjs
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, confirmSelfcheck } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const shotOf = async (cdp, selector, file) => {
  const r = await evaluate(cdp, `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
  const s = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 } });
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  console.log('已保存', file, JSON.stringify(r));
};

const page = await launchPage({ port: 9391 });
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-aidebug&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });

  // 跑一次（让夹具生成带 debug / 失败条目的运行日志）
  await evaluate(page.cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.includes('▶')); b.click(); return true; })()`);
  await confirmSelfcheck(page.cdp);
  await sleep(900);
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-log-btn').click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-logdlg')`, { timeout: 8000 });
  await sleep(600);
  // 只看失败/跳过 + 展开 AI 调用详情
  await evaluate(page.cdp, `(() => { [...document.querySelectorAll('.dsh-wf-log-toolbar button')].find((b) => b.textContent.includes('只看失败'))?.click(); return true; })()`);
  await sleep(500);
  await shotOf(page.cdp, '.dsh-wf-logdlg', 'tmp-test/aidebug-log.png');

  // ② 试跑面板的 AI 调试块
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-logdlg .dag-flow-picker-close').click(); return true; })()`);
  await sleep(300);
  await evaluate(page.cdp, `(() => { const ids = (window.__df_def?.nodes ?? []).map((n) => n.id); const i = ids.findIndex((id) => id !== 'start' && !String(id).startsWith('end')); window.__df_clickNode?.(i); return ids[i]; })()`);
  await sleep(400);
  await evaluate(page.cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-panel-row button')].find((x) => x.textContent.includes('试跑本节点')); if (b) b.click(); return !!b; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-test-debug')`, { timeout: 8000 });
  await sleep(300);
  await shotOf(page.cdp, '.dsh-wf-test-result', 'tmp-test/aidebug-testrun.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
