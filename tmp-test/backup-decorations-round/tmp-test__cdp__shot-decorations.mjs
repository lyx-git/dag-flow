// tmp-test/cdp/shot-decorations.mjs — 拍"分组框 + 便签"在真实画布上的样子（2026-10-04 方案 A）
//   用法：node tmp-test/cdp/shot-decorations.mjs
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
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-decorations&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-deco-add')`, { timeout: 20000 });
  await sleep(400);

  // 建一个分组框 + 一条便签，改标题、写正文
  await evaluate(page.cdp, `(() => { [...document.querySelectorAll('.dsh-wf-deco-add')][0].click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-deco-group')`, { timeout: 8000 });
  await evaluate(page.cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-deco-title');
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
    d.set.call(inp, '数据抓取'); inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(700);
  // 把框挪到节点群上（让它真的圈住几个节点）
  await evaluate(page.cdp, `(async () => {
    const el = document.querySelector('.dsh-wf-deco-group');
    const r = el.getBoundingClientRect();
    const x1 = r.left + 10, y1 = r.top + 40;
    const fire = (t, x, y, target) => (target ?? document.elementFromPoint(x, y) ?? document).dispatchEvent(
      new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    fire('pointerdown', x1, y1, el); fire('mousedown', x1, y1, el);
    for (let i = 1; i <= 4; i++) { fire('pointermove', x1 - 12 * i, y1 - 8 * i); fire('mousemove', x1 - 12 * i, y1 - 8 * i); }
    fire('pointerup', x1 - 48, y1 - 32, document); fire('mouseup', x1 - 48, y1 - 32, document);
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);
  await evaluate(page.cdp, `(() => { [...document.querySelectorAll('.dsh-wf-deco-add')][1].click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-deco-note-text')`, { timeout: 8000 });
  await evaluate(page.cdp, `(() => {
    const ta = document.querySelector('.dsh-wf-deco-note-text');
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value');
    d.set.call(ta, '这一组负责当天材料抓取：搜索源固定 bing，别改回 auto。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);

  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('tmp-test/decorations-real.png', Buffer.from(r.data, 'base64'));
  console.log('已保存 tmp-test/decorations-real.png');
  console.log('def.canvas =', JSON.stringify(await evaluate(page.cdp, `window.__df_def?.canvas ?? null`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
