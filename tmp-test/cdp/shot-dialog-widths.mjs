// tmp-test/cdp/shot-dialog-widths.mjs — 拍"宽度规则修好后"的两个弹窗，给用户复核视觉变化
//   （2026-10-04 修：`.dsh-wf-sched` 等 4 条宽度规则被运行时注入的 `.dag-flow-picker{width:680px}` 压掉）
//   用法：node tmp-test/cdp/shot-dialog-widths.mjs
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

const page = await launchPage({ port: 9399 });
const rect = (sel) => evaluate(page.cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) }; })()`);

try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-widths&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(400);

  // ① ⏰ 定时任务弹窗（应 720）
  await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'))?.click()`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-picker.dsh-wf-sched')`, { timeout: 8000 });
  await sleep(300);
  const sched = await rect('.dag-flow-picker.dsh-wf-sched');
  writeFileSync('tmp-test/width-sched.png', Buffer.from((await page.cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched .dag-flow-picker-close').click()`);
  await waitFor(page.cdp, `!document.querySelector('.dsh-wf-sched')`, { timeout: 5000 });

  // ② 🧾 运行日志弹窗（应 920）
  await evaluate(page.cdp, `document.querySelector('.dsh-wf-log-btn').click()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-logdlg')`, { timeout: 8000 });
  await sleep(600);
  const logdlg = await rect('.dsh-wf-logdlg');
  writeFileSync('tmp-test/width-logdlg.png', Buffer.from((await page.cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  console.log('⏰ 定时任务弹窗 =', JSON.stringify(sched), '（期望 width=720）');
  console.log('🧾 运行日志弹窗 =', JSON.stringify(logdlg), '（期望 width=920）');
  console.log('已保存 tmp-test/width-sched.png / width-logdlg.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
