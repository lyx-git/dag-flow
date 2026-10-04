// tmp-test/cdp/shot-fail-policy.mjs — 拍实装效果：右侧面板合并后的唯一「🛟 本节点失败后」下拉
//   （2026-10-04 轮 2 用户要求：「失败策略和失败后不影响流程，这两个配置要合并到一起，避免歧义」）
// 用法：node tmp-test/cdp/shot-fail-policy.mjs
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

const page = await launchPage({ port: 9385 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }); } catch { /* */ }

const pick = async (v) => evaluate(page.cdp, `
  (() => {
    const sel = document.querySelector('.dsh-wf-failpolicy');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
    desc.set.call(sel, ${JSON.stringify(v)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })(); true;
`);

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-fail-policy`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });
  await evaluate(page.cdp, `window.__df_clickNode(0); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-failpolicy')`, { timeout: 8000 });
  await sleep(400);

  const shot = async (file, tag) => {
    const r = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`已保存 ${file}`);
    console.log(tag + JSON.stringify(await evaluate(page.cdp, `(() => ({
      value: document.querySelector('.dsh-wf-failpolicy')?.value,
      options: [...document.querySelectorAll('.dsh-wf-failpolicy option')].map((o) => o.textContent),
      hint: document.querySelector('.dsh-wf-failpolicy-hint')?.textContent ?? '',
      oldTolerateBox: !!document.querySelector('.dsh-wf-tolerate-check'),
    }))()`)));
  };

  await shot('tmp-test/failpolicy-stop-real.png', '默认（停止这条支路）：');
  await pick('skip');
  await sleep(300);
  await shot('tmp-test/failpolicy-skip-real.png', '切到（跳过这条支路）：');
  // 轮 3：第 4 项 + 「↪ 跳转目标」行（上游候选带"不会生效"标注）
  await pick('goto');
  await sleep(400);
  await shot('tmp-test/failpolicy-goto-real.png', '切到（失败后跳转）：');
  console.log('目标下拉候选：' + JSON.stringify(await evaluate(page.cdp, `
    [...document.querySelectorAll('.dsh-wf-panel-row')].filter((r) => r.textContent.includes('跳转目标'))
      .map((r) => [...r.querySelectorAll('option')].map((o) => o.textContent))[0] ?? []
  `)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
