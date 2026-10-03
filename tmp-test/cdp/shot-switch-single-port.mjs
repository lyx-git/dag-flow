// tmp-test/cdp/shot-switch-single-port.mjs — 拍本轮 switch 改造的实装效果（2x）
//   · ?chips=1：端口行删除、只留一行 chips（选中 video → 拉线即带 video）
//   · ?many=1 ：9 个出口 → 3 个 chip + 「+6」 + 卡内情况说明，卡片不变高
//   · ?branch=1：if 保持逐行标签、switch 用 chips（同屏对照）
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

const page = await launchPage({ port: 9347 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false }); } catch { /* 忽略 */ }
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};

const selectChip = (kw) => `(() => {
  const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
  const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('${kw}'));
  chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return true;
})()`;

try {
  // ① chips 档：选中 video
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-single-chips&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  await evaluate(page.cdp, selectChip('video'));
  await sleep(700);
  await shot('tmp-test/switch-single-port-chips.png');
  console.log('① switch-single-port-chips.png（?chips=1，video 选中）');
  console.log(JSON.stringify(await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const r = card.getBoundingClientRect();
    return { h: Math.round(r.height), minH: card.style.minHeight, chips: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.textContent.trim()),
      rows: card.querySelectorAll('.dsh-wf-fg-rou').length, note: card.querySelector('.dsh-wf-fg-card-note')?.textContent?.trim() ?? '',
      sub: card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '' };
  })()`)));

  // ② many 档：9 个出口 → 折叠 + 说明
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-single-many&many=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('分支很多'))`, { timeout: 20000 });
  await sleep(700);
  await shot('tmp-test/switch-single-port-many.png');
  console.log('② switch-single-port-many.png（?many=1，9 个出口）');

  // ③ branch 档：if 逐行标签 + switch chips 同屏
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-single-branch&branch=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 20000 });
  await sleep(700);
  await shot('tmp-test/switch-single-port-branch.png');
  console.log('③ switch-single-port-branch.png（?branch=1，if 标签 + switch chips 对照）');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
