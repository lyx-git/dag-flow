// tmp-test/cdp/shot-sched-manual.mjs — 拍「定时任务弹窗」改造后的**真实渲染**（给用户复核，非原型）
//   覆盖：① 一行常态 + 一行「cron 草稿态」（描黄边 + 保存高亮 + 行内提示）② 未保存关闭的二次确认弹窗
//   用法：node tmp-test/cdp/shot-sched-manual.mjs
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

const page = await launchPage({ port: 9405 });
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-sched-manual&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await sleep(400);

  // 打开 ⏰ + 加两条（一条留作"常态"，一条用来演示"草稿态"）
  await evaluate(page.cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（')); b.click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched')`, { timeout: 8000 });
  await evaluate(page.cdp, `window.__sa = {}; window.__sa_setVal = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; true`);
  for (let i = 0; i < 2; i++) {
    await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched .dsh-wf-inputs-add').click()`);
    await sleep(600);
  }
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-sched-item').length === 2`, { timeout: 8000 });

  // 第二行改成"草稿态"（只改草稿、不保存）
  await evaluate(page.cdp, `(() => { const ins = [...document.querySelectorAll('.dsh-wf-sched-cron')]; window.__sa_setVal(ins[ins.length - 1], '30 7 * * 1-5'); return true; })()`);
  await sleep(300);
  const clipOf = async (sel) => evaluate(page.cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
  const r1 = await clipOf('.dsh-wf-sched');
  const shot1 = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...r1, scale: 2 } });
  writeFileSync('tmp-test/sched-manual-real.png', Buffer.from(shot1.data, 'base64'));

  // 状态取证（同时把可见文案 dump 出来，顺手排查 ** 星号等文案问题）
  const evidence = await evaluate(page.cdp, `(() => {
    const rows = [...document.querySelectorAll('.dsh-wf-sched-item')].map((it) => ({
      cron: it.querySelector('.dsh-wf-sched-cron')?.value,
      dirty: it.querySelector('.dsh-wf-sched-cron')?.classList.contains('is-dirty'),
      saveDisabled: !!it.querySelector('.dsh-wf-sched-save')?.disabled,
      saveReady: it.querySelector('.dsh-wf-sched-save')?.classList.contains('is-ready'),
      state: (it.querySelector('.dsh-wf-sched-state')?.textContent || '').trim(),
      hint: (it.querySelector('.dsh-wf-sched-dirty')?.textContent || '').trim(),
      checkbox: !!it.querySelector('input[type=checkbox]'),
    }));
    const txt = document.querySelector('.dsh-wf-sched').textContent || '';
    return { rows, hasDoubleStar: txt.includes('**') };
  })()`);
  console.log('行状态 =', JSON.stringify(evidence.rows, null, 1));
  console.log('弹窗可见文案里含 ** =', evidence.hasDoubleStar, '（应为 false）');

  // ② 未保存关闭 → **直接关闭 + 浮层提示**（2026-10-04 用户改口：不要二次确认弹窗）
  await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched .dag-flow-picker-close').click()`);
  await waitFor(page.cdp, `!document.querySelector('.dsh-wf-sched')`, { timeout: 6000 });
  await waitFor(page.cdp, `(document.body.textContent || '').includes('未保存的 cron 改动已丢弃')`, { timeout: 4000 });
  await sleep(200);
  const toastRect = await evaluate(page.cdp, `(() => { const el = [...document.querySelectorAll('div[title="点击关闭"]')].find((x) => (x.textContent || '').includes('已丢弃')); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.max(0, Math.round(b.left) - 30), y: Math.max(0, Math.round(b.top) - 20), width: Math.round(b.width) + 60, height: Math.round(b.height) + 40 }; })()`);
  const shot2 = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...(toastRect ?? { x: 0, y: 700, width: 900, height: 200 }), scale: 2 } });
  writeFileSync('tmp-test/sched-discard-toast-real.png', Buffer.from(shot2.data, 'base64'));
  const toastTxt = await evaluate(page.cdp, `([...document.querySelectorAll('div[title="点击关闭"]')].find((x) => (x.textContent || '').includes('已丢弃'))?.textContent ?? '(没找到提示)')`);
  console.log('关闭后的浮层提示 =', toastTxt.trim());
  console.log('二次确认弹窗是否存在 =', await evaluate(page.cdp, `!!document.querySelector('.dsh-wf-sched-confirm')`), '（应为 false）');
  console.log('已保存 tmp-test/sched-manual-real.png / sched-discard-toast-real.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
