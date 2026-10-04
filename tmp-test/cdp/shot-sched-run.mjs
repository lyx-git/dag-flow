// tmp-test/cdp/shot-sched-run.mjs — 一次性截图：定时（宿主侧）触发的运行在画布上的可见性
//   （用户真机反馈「定时任务执行，工作流的状态不会变化」的修复证据：客户端零点击，画布自己点亮）
// 用法：node tmp-test/cdp/shot-sched-run.mjs   （工作目录 = dag-flow 仓库根）
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

const page = await launchPage({ port: 9340 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-sched-run&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(600);
  const ids = await evaluate(page.cdp, `(window.__df_def?.nodes ?? []).map((n) => n.id)`);
  // 宿主侧跑起来（前 2 个完成、第 3 个运行中）——客户端一下都不点
  await evaluate(page.cdp, `(async () => {
    await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'shot-sched-run', ids: ${JSON.stringify(ids)}, stage: 2 }) });
    return true;
  })()`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length >= 2`, { timeout: 12000 });
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-btn.is-running')`, { timeout: 12000 });
  await sleep(400);
  const state = await evaluate(page.cdp, `(() => ({
    ok: document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length,
    run: document.querySelectorAll('.dsh-wf-fg-badge.is-run').length,
    wait: document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length,
    header: (document.querySelector('.dsh-wf-btn.is-running')?.textContent ?? '').trim(),
    cardRunning: document.querySelectorAll('.dsh-wf-fg-card.is-running').length,
  }))()`);
  console.log('零点击后画布状态：' + JSON.stringify(state));
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/sched-run-visible-real.png', Buffer.from(r.data, 'base64'));
  console.log('已保存 tmp-test/sched-run-visible-real.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
