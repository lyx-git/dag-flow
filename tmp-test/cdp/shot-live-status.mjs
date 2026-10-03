// tmp-test/cdp/shot-live-status.mjs — 拍「运行过程态」实装效果（2x）
//   ① 画布：待运行 / 运行中 / 已完成 三种状态并存 + 正在执行的节点卡蓝色高亮
//   ② 头部：运行按钮动态「运行中」（扫光+转圈）、取消按钮红色
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

const page = await launchPage({ port: 9373 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false }); } catch { /* */ }

try {
  await evaluate(page.cdp, `fetch('${BASE}/__run-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'slow' }) }).then((r) => r.json())`).catch(() => { /* 页面还没加载 */ });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-live-status&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 4`, { timeout: 20000 });
  await evaluate(page.cdp, `fetch('${BASE}/__run-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'slow' }) }).then((r) => r.json())`);
  await evaluate(page.cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  // 等到「已完成 + 运行中 + 待运行」并存的时刻（最能说明"依次点亮"）
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length >= 2
    && document.querySelectorAll('.dsh-wf-fg-badge.is-run').length >= 1
    && document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length >= 1`, { timeout: 10000 });
  await sleep(120);

  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('tmp-test/live-status-real.png', Buffer.from(shot.data, 'base64'));
  console.log('已保存 tmp-test/live-status-real.png');
  console.log(JSON.stringify(await evaluate(page.cdp, `(() => ({
    runBtn: document.querySelector('.dsh-wf-btn-success')?.textContent ?? '',
    runBtnCls: document.querySelector('.dsh-wf-btn-success')?.className ?? '',
    cancelBtn: document.querySelector('.dsh-wf-btn.is-danger')?.textContent ?? '',
    cancelColor: (() => { const el = document.querySelector('.dsh-wf-btn.is-danger'); return el ? getComputedStyle(el).color : null; })(),
    ok: document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length,
    run: document.querySelectorAll('.dsh-wf-fg-badge.is-run').length,
    wait: document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length,
    runningCard: !!document.querySelector('.dsh-wf-fg-card.is-running'),
    runRing: (() => { const el = document.querySelector('.dsh-wf-run-ring'); if (!el) return null;
      const s = getComputedStyle(el); return { w: Math.round(el.getBoundingClientRect().width), anim: s.animationName + ' ' + s.animationDuration, radius: s.borderRadius }; })(),
    runGlow: (() => { const el = document.querySelector('.dsh-wf-btn.is-running'); if (!el) return null;
      const s = getComputedStyle(el); return { anim: s.animationName + ' ' + s.animationDuration, shadow: s.boxShadow }; })(),
    labels: [...document.querySelectorAll('.dsh-wf-fg-badge')].map((b) => b.textContent),
  }))()`), null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
