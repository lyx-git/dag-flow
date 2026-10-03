// tmp-test/cdp/diag-chips-drag.mjs — 临时诊断：复刻 test-switch-chips ③ 的完整序列（先点 video chip，再拖线），
// 在同一页面里连做 3 次，报告每次「起点命中的元素 / 拖完是否弹快选面板 / edge 数变化」，用来分辨失败模式：
//   A) 起点 elementFromPoint 不是端口点 → mousedown 没抓到线（几何/时序）
//   B) 起点是端口点但没弹面板，且 edge 数 +1 → 落点直接连到了节点（落点被吞）
// 用法：node tmp-test/cdp/diag-chips-drag.mjs
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const SW_CARD = `多路分支：运行模式`;
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('服务器未就绪'); process.exit(1); }

const page = await launchPage({ port: 9335 });
const cdp = page.cdp;
try {
  await goto(cdp, `${BASE}/cdp-host.html?name=diag-chips-drag&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  await sleep(800);

  for (let attempt = 1; attempt <= 3; attempt++) {
    // 点 video chip（复刻用例 ③ 的前置）
    await evaluate(cdp, `(() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('video'));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`);
    await sleep(250);

    const geo = await evaluate(cdp, `(() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const er = document.querySelector('.dsh-wf-fg-editor').getBoundingClientRect();
      const r = card.getBoundingClientRect();
      const dots = [...document.querySelectorAll('.workflow-point-bg')]
        .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })
        .filter((p) => p.x > r.right - 24 && p.x < r.right + 24 && p.y > r.top && p.y < r.bottom);
      const p = dots[0] ?? { x: Math.round(r.right + 1), y: Math.round(r.top + r.height / 2) };
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')].map((c) => c.getBoundingClientRect());
      let drop = { x: Math.round(er.left + er.width * 0.62), y: Math.round(er.top + er.height * 0.82) };
      for (let dx = 0; dx <= 0.36 && cards.some((c) => drop.x > c.left - 70 && drop.x < c.right + 70 && drop.y > c.top - 70 && drop.y < c.bottom + 70); dx += 0.06) {
        for (let dy = 0; dy <= 0.36; dy += 0.06) {
          const x = er.left + er.width * (0.62 + dx), y = er.top + er.height * (0.7 + dy);
          if (x > er.right - 30 || y > er.bottom - 30) break;
          if (!cards.some((c) => x > c.left - 70 && x < c.right + 70 && y > c.top - 70 && y < c.bottom + 70)) { drop = { x: Math.round(x), y: Math.round(y) }; dx = 9; break; }
        }
      }
      return { start: p, drop, portCount: dots.length, cardW: Math.round(r.width), cardH: Math.round(r.height) };
    })()`);

    const res = await evaluate(cdp, `(async () => {
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const x = ${geo.start.x}, y = ${geo.start.y}, dx = ${geo.drop.x}, dy = ${geo.drop.y};
      const before = (window.__df_def?.edges ?? []).length;
      const trace = [];
      const fire = (type, px, py) => {
        const t = document.elementFromPoint(px, py) ?? editor;
        trace.push(type + '@' + px + ',' + py + '→' + (typeof t.className === 'string' ? t.className.split(' ').slice(0, 3).join('.') : t.tagName));
        t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, view: window }));
      };
      const seq = [['mousemove', x, y], ['mousemove', x, y], ['mousemove', x, y], ['mousedown', x, y],
        ['mousemove', (x + dx) / 2, (y + dy) / 2], ['mousemove', dx, dy], ['mouseup', dx, dy]];
      for (const [t, px, py] of seq) { fire(t, px, py); await new Promise((r) => setTimeout(r, 180)); }
      return { trace, quick: !!document.querySelector('.dsh-wf-fg-quick'), edgesDelta: (window.__df_def?.edges ?? []).length - before };
    })()`);

    console.log(`尝试 ${attempt}: startHit=${res.trace[3].split('→')[1]} dropHit=${res.trace[6].split('→')[1]} quick=${res.quick} edgesDelta=${res.edgesDelta} portCount=${geo.portCount} card=${geo.cardW}x${geo.cardH}`);
    // 关掉可能弹出的面板，回到干净状态
    await evaluate(cdp, `(() => { const q = document.querySelector('.dsh-wf-fg-quick'); if (q) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await sleep(400);
  }
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
