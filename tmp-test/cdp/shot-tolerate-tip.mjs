// tmp-test/cdp/shot-tolerate-tip.mjs — 拍实装效果：①节点悬浮「最终执行结果」卡 ②面板「🛟 失败不影响流程」勾选框
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

const page = await launchPage({ port: 9363 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false }); } catch { /* */ }

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-tolerate-tip`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });

  // ① 跑一次（每个节点都有 success + out）→ 徽标出现
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-badge')`, { timeout: 8000 });

  // ② 勾上容错开关（面板里那行要能看见才拍得到）
  await evaluate(page.cdp, `window.__df_clickNode(0); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-tolerate-check')`, { timeout: 8000 });
  await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => r.textContent.includes('失败不影响流程'));
    row.scrollIntoView({ block: 'center' });
    const c = document.querySelector('.dsh-wf-tolerate-check');
    if (!c.checked) c.click();
    return true;
  })()`);
  await sleep(400);

  // ③ 悬浮一张卡片 → 弹「最终执行结果」
  await evaluate(page.cdp, `(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-editor .dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge'));
    el.dispatchEvent(new MouseEvent('mouseenter'));
    return true;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-tip')`, { timeout: 4000 });
  await sleep(300);

  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('tmp-test/tolerate-tip-real.png', Buffer.from(shot.data, 'base64'));
  console.log('已保存 tmp-test/tolerate-tip-real.png');
  console.log(JSON.stringify(await evaluate(page.cdp, `(() => ({
    tip: document.querySelector('.dsh-wf-fg-tip')?.textContent ?? '',
    tipRect: (() => { const r = document.querySelector('.dsh-wf-fg-tip')?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; })(),
    tolerateRow: [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => r.textContent.includes('失败不影响流程'))?.innerText ?? '',
    badge: document.querySelector('.dsh-wf-fg-badge')?.textContent ?? '',
    defTolerate: (window.__df_def?.nodes ?? []).filter((n) => n.tolerate).map((n) => n.id),
  }))()`), null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
