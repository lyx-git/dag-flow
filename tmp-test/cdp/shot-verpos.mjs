// tmp-test/cdp/shot-verpos.mjs — 拍 🕘 历史版本弹窗与 ⏰ 定时任务弹窗的位置对照
//   （2026-10-04 用户反馈「历史版本弹窗有点偏中下部了，最好和定时任务弹窗保持一致」）
//   用法：node tmp-test/cdp/shot-verpos.mjs
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

const page = await launchPage({ port: 9395 });
const rectOf = `(() => { const el = document.querySelector(SEL); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height), bottom: Math.round(b.bottom) }; })()`;

try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-verpos`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  // 手动保存一次，让版本列表里有内容（截图更像真实使用）
  await evaluate(page.cdp, `window.__df_clickBtn('💾')`);
  await sleep(900);

  const vh = await evaluate(page.cdp, `window.innerHeight`);

  // ① 历史版本弹窗
  await evaluate(page.cdp, `window.__df_clickBtn('🕘')`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-picker-ver')`, { timeout: 8000 });
  await sleep(400);
  const ver = await evaluate(page.cdp, rectOf.replace('SEL', `'.dag-flow-picker-ver'`));
  const verShot = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/verpos-history.png', Buffer.from(verShot.data, 'base64'));

  // ② 定时任务弹窗（同一视口，量同一参照点）
  //   ★ 先关掉历史版本弹窗：两个 overlay 同为 z-index:10000，而历史版本在 DOM 里更靠后 → 会盖住更矮的定时弹窗，
  //     截出来两张一模一样的图（真机上不可能同时开：overlay 铺满视口，点外面即关）。
  await evaluate(page.cdp, `document.querySelector('.dag-flow-picker-ver .dag-flow-picker-close').click()`);
  await waitFor(page.cdp, `!document.querySelector('.dag-flow-picker-ver')`, { timeout: 5000 });
  await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'))?.click()`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-picker.dsh-wf-sched')`, { timeout: 8000 });
  await sleep(400);
  const sched = await evaluate(page.cdp, rectOf.replace('SEL', `'.dag-flow-picker.dsh-wf-sched'`));
  const schedShot = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/verpos-schedule.png', Buffer.from(schedShot.data, 'base64'));

  console.log('视口 innerHeight =', vh, ' · 14vh =', Math.round(vh * 0.14));
  console.log('🕘 历史版本  =', JSON.stringify(ver));
  console.log('⏰ 定时任务  =', JSON.stringify(sched));
  console.log('顶边差 =', Math.abs(ver.top - sched.top), 'px');
  console.log('已保存 tmp-test/verpos-history.png / verpos-schedule.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
