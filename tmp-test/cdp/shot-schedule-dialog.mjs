// tmp-test/cdp/shot-schedule-dialog.mjs — 一次性截图：⏰ 定时任务弹窗（2026-10-03 定时任务轮）
// 用法：node tmp-test/cdp/shot-schedule-dialog.mjs   （工作目录 = dag-flow 仓库根）
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
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-schedule-dialog&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(500);

  // 打开 ⏰ 弹窗
  const opened = await evaluate(page.cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  console.log('点到 ⏰ 按钮：' + opened);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched')`, { timeout: 8000 });
  await sleep(400);

  // 加一条，并把 cron 改成「工作日 09:00」让预览更直观
  await evaluate(page.cdp, `(() => {
    const add = [...document.querySelectorAll('.dsh-wf-inputs-add')].find((b) => (b.textContent || '').includes('添加定时'));
    if (add) add.click();
    return !!add;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched-cron')`, { timeout: 8000 });
  await evaluate(page.cdp, `(() => {
    const input = document.querySelector('.dsh-wf-sched-cron');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    desc.set.call(input, '0 9 * * 1-5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })()`);
  await sleep(1800);   // 等防抖保存 + 列表刷新

  // 夹具的 nextRunAt 只是占位（now+20s）；这里灌入**产品 cron.ts 真算出来**的下次时间，
  // 让「下次」这一栏与真机一致（0 9 * * 1-5 从 2026-10-04 00:27 起 → 2026-10-05 周一 09:00）。
  // 该值由 `nextRunAt('0 9 * * 1-5', now)` 实测得到（见交付说明的验证记录）。
  const preset = await evaluate(page.cdp, `(async () => {
    const r = await fetch('/__sched-preset', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nextRunAt: '2026-10-05T01:00:00.000Z' }) });   // = 本机 2026-10-05 09:00
    return r.ok;
  })()`);
  console.log('预置下次时间：' + preset);
  // 关掉再打开 → 面板重新拉列表（不触发保存，保留预置值）
  await evaluate(page.cdp, `(() => { document.querySelector('.dag-flow-picker-close')?.click(); return true; })()`);
  await sleep(300);
  await evaluate(page.cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    b?.click();
    return true;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched-item')`, { timeout: 8000 });
  await sleep(400);

  const state = await evaluate(page.cdp, `(() => {
    const dlg = document.querySelector('.dsh-wf-sched');
    return {
      open: !!dlg,
      warn: dlg?.querySelector('.dsh-wf-sched-warn')?.textContent?.trim().slice(0, 40) ?? '',
      beat: dlg?.querySelector('.dsh-wf-sched-beat')?.textContent?.trim().slice(0, 60) ?? '',
      items: [...(dlg?.querySelectorAll('.dsh-wf-sched-item') ?? [])].map((it) => ({
        cron: it.querySelector('.dsh-wf-sched-cron')?.value ?? '',
        preview: it.querySelector('.dsh-wf-sched-preview')?.textContent?.trim() ?? '',
        meta: it.querySelector('.dsh-wf-sched-meta')?.textContent?.trim() ?? '',
        // ★ 2026-10-04：立即运行一次应在 cron 同一行（.dsh-wf-sched-run），不再是独立的 actions 行
        runBtnInRow: !!it.querySelector('.dsh-wf-sched-row .dsh-wf-sched-run'),
        oldActionsRow: !!it.querySelector('.dsh-wf-sched-actions'),
      })),
    };
  })()`);
  console.log(JSON.stringify(state));
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/schedule-dialog-real.png', Buffer.from(r.data, 'base64'));
  console.log('已保存 tmp-test/schedule-dialog-real.png');

  // ★ 2026-10-04 用户反馈轮：点「▶ 立即运行一次」→ 拍**应用内**确认弹窗（替代 Windows 原生 confirm）
  await evaluate(page.cdp, `(() => { const b = document.querySelector('.dsh-wf-sched-run'); b?.click(); return !!b; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched-confirm')`, { timeout: 8000 });
  await sleep(350);
  const c = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/sched-confirm-real.png', Buffer.from(c.data, 'base64'));
  console.log('已保存 tmp-test/sched-confirm-real.png');
  console.log('确认弹窗文案：' + JSON.stringify(await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched-confirm')?.textContent ?? ''`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
