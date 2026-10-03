// tmp-test/cdp/shot-picker.mjs — 一次性脚本：拍「打开/新建」下拉里置灰路径的真实渲染（交付证据）
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

const page = await launchPage({ port: 9336 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-picker`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await evaluate(page.cdp, `window.__df_openPicker()`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-combo-row .path')`, { timeout: 8000 });
  await sleep(500);
  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/picker-path-real.png', Buffer.from(shot.data, 'base64'));
  const rows = await evaluate(page.cdp, `[...document.querySelectorAll('.dag-flow-combo-row')].slice(0, 3).map((r) => r.textContent.trim())`);
  console.log('已保存 tmp-test/picker-path-real.png');
  console.log('前三行文本：', JSON.stringify(rows, null, 0));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
