// tmp-test/cdp/diag-port-hover.mjs — 诊断：真实鼠标 hover 到端口上时，playground 的前置状态到底成不成立？
//   （2026-10-04 轮 7：line-drop-panel / switch-chips 用真实输入后仍有 ~1/3 落空，需要看"起线前"发生了什么）
// 用法：node tmp-test/cdp/diag-port-hover.mjs
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, mouseMove, mouseHover, mouseDown, mouseUp } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9391 });
const snap = async () => evaluate(page.cdp, `(() => {
  const ports = [...document.querySelectorAll('.workflow-port-render')];
  const out = ports.filter((p) => p.getAttribute('data-port-entity-type') === 'output');
  const lines = document.querySelectorAll('.gedit-flow-activity-edge').length;
  const tmp = document.querySelectorAll('[class*="drawing"],[class*="line-drawing"],[data-line-drawing]').length;
  return {
    portCount: ports.length, outCount: out.length,
    cls: out.map((p) => p.className),
    rects: out.map((p) => { const r = p.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }),
    lines, tmp,
  };
})()`);

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-hover`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });
  await sleep(500);

  console.log('① 初始：', JSON.stringify(await snap()));
  const geo = await evaluate(page.cdp, `(() => {
    const p = [...document.querySelectorAll('.workflow-port-render')].find((x) => x.getAttribute('data-port-entity-type') === 'output');
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  console.log('   端口中心：', JSON.stringify(geo));

  // 逐次试：每次 hover 后 dump 端口 class（看有没有 hover 态），再按下并 dump（看有没有起线）
  for (let round = 1; round <= 5; round++) {
    await mouseMove(page.cdp, geo.x - 40, geo.y);
    await sleep(120);
    await mouseHover(page.cdp, geo.x, geo.y, { times: 2, gapMs: 100 });
    const afterHover = await snap();
    await mouseDown(page.cdp, geo.x, geo.y);
    await sleep(150);
    const afterDown = await snap();
    await mouseMove(page.cdp, geo.x + 160, geo.y + 120, { buttons: 1 });
    await sleep(150);
    const duringDrag = await snap();
    await mouseUp(page.cdp, geo.x + 160, geo.y + 120);
    await sleep(350);
    const afterUp = await evaluate(page.cdp, `({ quick: !!document.querySelector('.dsh-wf-fg-quick'), lines: document.querySelectorAll('.gedit-flow-activity-edge').length })`);
    console.log(`② 第 ${round} 轮：hover 后端口 class=${JSON.stringify(afterHover.cls)} lines=${afterHover.lines}`);
    console.log(`   按下后 lines=${afterDown.lines} 拖动中 lines=${duringDrag.lines} 临时线元素=${duringDrag.tmp}`);
    console.log(`   抬起后：快选面板=${afterUp.quick} 线数=${afterUp.lines}`);
    if (afterUp.quick) {
      await evaluate(page.cdp, `(() => { const i = document.querySelector('.dsh-wf-fg-quick-search'); if (i) { i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } return true; })()`);
      await sleep(300);
    }
    await mouseMove(page.cdp, 8, 8);
    await sleep(200);
  }
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
