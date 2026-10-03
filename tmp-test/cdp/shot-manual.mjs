// tmp-test/cdp/shot-manual.mjs — 一次性脚本：把真实插件渲染的人工确认弹窗/徽标截图下来（交付证据）
// 用法：node tmp-test/cdp/shot-manual.mjs
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

const page = await launchPage({ port: 9335 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-manual`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 20000 });
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 20000 });
  const before = await evaluate(page.cdp, `window.__df_def?.nodes?.length ?? -1`);
  await evaluate(page.cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('手动确认'));
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.42, ey = er.top + er.height * 0.62;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);
  await waitFor(page.cdp, `(window.__df_def?.nodes?.length ?? 0) > ${before >= 0 ? before : 0}`, { timeout: 8000 });
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 8000 });
  await sleep(500);
  const dlg = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/manual-dialog-real.png', Buffer.from(dlg.data, 'base64'));
  // 关掉弹窗 → 只留头部 ⏸ 徽标
  await evaluate(page.cdp, `(() => { document.querySelector('.dag-flow-picker-close').click(); })(); true;`);
  await sleep(400);
  const chip = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/manual-chip-real.png', Buffer.from(chip.data, 'base64'));
  console.log('已保存 tmp-test/manual-dialog-real.png 与 tmp-test/manual-chip-real.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
