// tmp-test/cdp/diag-chips-hover.mjs — 诊断：chips 夹具里"起线点"到底是什么元素、hover 时有什么状态？
//   （2026-10-04 轮 7：switch-chips 用真实输入后仍会落空，且"干等 hover"反而更差 → 需要看真实状态）
// 用法：node tmp-test/cdp/diag-chips-hover.mjs
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, mouseMove, mouseHover, mouseDown, mouseUp } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9393 });
const dump = (label) => evaluate(page.cdp, `
  (() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const r = card.getBoundingClientRect();
    const dots = [...document.querySelectorAll('.workflow-point-bg')]
      .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), cls: el.className }; })
      .filter((p) => p.x > r.right - 24 && p.x < r.right + 24 && p.y > r.top && p.y < r.bottom);
    const ports = [...document.querySelectorAll('.workflow-port-render')].map((el) => ({ type: el.getAttribute('data-port-entity-type'), cls: el.className }));
    return { label: ${JSON.stringify(label)}, dots, ports, lines: document.querySelectorAll('.gedit-flow-activity-edge').length };
  })()
`);

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-chips&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  await sleep(600);
  const d0 = await dump('初始');
  console.log('① 初始：', JSON.stringify(d0));
  const p = d0.dots[0] ?? { x: 0, y: 0 };
  console.log('   起线点（dots[0]）：', JSON.stringify(p));

  for (let round = 1; round <= 5; round++) {
    await mouseMove(page.cdp, p.x - 40, p.y);
    await sleep(120);
    await mouseMove(page.cdp, p.x - 20, p.y);
    await sleep(120);
    await mouseHover(page.cdp, p.x, p.y, { times: 2, gapMs: 100 });
    const afterHover = await dump(`第 ${round} 轮 hover 后`);
    const hoveredAny = /hovered/.test(JSON.stringify(afterHover));
    await mouseDown(page.cdp, p.x, p.y);
    await sleep(120);
    const afterDown = await dump('按下后');
    // 落点：卡片右下方空白
    const drop = await evaluate(page.cdp, `(() => {
      const er = document.querySelector('.dsh-wf-fg-editor').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')].map((c) => c.getBoundingClientRect());
      let x = Math.round(er.left + er.width * 0.7), y = Math.round(er.top + er.height * 0.8);
      return { x, y, cards: cards.length };
    })()`);
    await mouseMove(page.cdp, (p.x + drop.x) / 2, (p.y + drop.y) / 2, { buttons: 1 });
    await sleep(60);
    await mouseMove(page.cdp, drop.x, drop.y, { buttons: 1 });
    await sleep(60);
    const during = await dump('拖动中');
    await mouseUp(page.cdp, drop.x, drop.y);
    await sleep(400);
    const after = await evaluate(page.cdp, `({ quick: !!document.querySelector('.dsh-wf-fg-quick'), lines: document.querySelectorAll('.gedit-flow-activity-edge').length })`);
    console.log(`② 第 ${round} 轮：hover 时出现 hovered 类=${hoveredAny}｜按下后线数=${afterDown.lines}｜拖动中=${during.lines}｜抬起后 面板=${after.quick} 线数=${after.lines}`);
    if (!hoveredAny) console.log('   hover 后的端口类名：', JSON.stringify(afterHover.ports.slice(0, 3)), ' dots：', JSON.stringify(afterHover.dots));
    if (after.quick) {
      await evaluate(page.cdp, `(() => { const i = document.querySelector('.dsh-wf-fg-quick-search'); if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
      await sleep(300);
    }
    await mouseMove(page.cdp, 8, 8);
    await sleep(200);
  }
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
