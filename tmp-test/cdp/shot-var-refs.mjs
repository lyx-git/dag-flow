// tmp-test/cdp/shot-var-refs.mjs — 拍右侧「节点编辑面板 → 变量引用」实装效果（2x，按面板实际尺寸裁剪）
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

const page = await launchPage({ port: 9353 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false }); } catch { /* */ }
const clickCard = (needle) => `(() => {
  const hosts = [...document.querySelectorAll('.dsh-wf-fg-node-host')];
  const i = hosts.findIndex((h) => (h.textContent || '').includes(${JSON.stringify(needle)}));
  if (i < 0) throw new Error('找不到 ' + ${JSON.stringify(needle)});
  window.__df_clickNode(i);
  return true;
})()`;

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-var-refs&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  // 先跑一次 → 面板字段改为「按真实运行输出反推」（含样例值）；再选 py（它的上游 fetch 是对象型输出）
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await waitFor(page.cdp, `(document.body.textContent || '').includes('运行成功')`, { timeout: 8000 });
  await evaluate(page.cdp, clickCard(' · py'));
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-var-group')`, { timeout: 8000 });
  await sleep(500);
  const clip = await evaluate(page.cdp, `(() => {
    const el = document.querySelector('.dsh-wf-right') ?? document.querySelector('.dsh-wf-panel-row').parentElement;
    el.scrollTop = 0;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.min(Math.round(r.height), 980), scale: 1 };
  })()`);
  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
  writeFileSync('tmp-test/var-refs-panel.png', Buffer.from(shot.data, 'base64'));
  console.log('已保存 tmp-test/var-refs-panel.png');
  console.log(JSON.stringify(await evaluate(page.cdp, `(() => {
    const right = document.querySelector('.dsh-wf-right');
    return { text: (right?.innerText ?? '').slice(0, 900) };
  })()`), null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
