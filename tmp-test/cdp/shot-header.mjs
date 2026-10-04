// tmp-test/cdp/shot-header.mjs — 拍头部按钮排（验证 🧾 运行日志在 ⏰ 定时任务后面）
//   用法：node tmp-test/cdp/shot-header.mjs
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

const page = await launchPage({ port: 9393 });
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-header`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-log-btn')`, { timeout: 20000 });
  await sleep(600);
  const r = await evaluate(page.cdp, `(() => { const el = document.querySelector('.dsh-wf-header'); const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 } });
  writeFileSync('tmp-test/header-buttons.png', Buffer.from(shot.data, 'base64'));
  console.log('已保存 tmp-test/header-buttons.png');
  console.log('头部按钮顺序 =', JSON.stringify(await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-header > *')].map((c) => (c.textContent || '').trim()).filter(Boolean).slice(0, 12)`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
