// tmp-test/cdp/diag-quick.mjs — 临时诊断：switch-chips ③ 拖线为何不弹快选面板
// 用法：node tmp-test/cdp/diag-quick.mjs   （工作目录 = dag-flow 仓库根）
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const SW_CARD = `多路分支：运行模式`;

const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('✗ 服务器未就绪'); process.exit(1); }

const page = await launchPage({ port: 9334 });
const cdp = page.cdp;
const log = (...a) => console.log(...a);

try {
  await goto(cdp, `${BASE}/cdp-host.html?name=diag-quick&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent||'').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  await sleep(600);

  log('— 视图状态 —');
  log(JSON.stringify(await evaluate(cdp, `({
    initialView: window.__df_initialView ?? null,
    lastFit: window.__df_lastFit ?? null,
    lastZoom: window.__df_lastZoom ?? null,
    readout: [...document.querySelectorAll('.dsh-wf-btn,.dsh-wf-fg-zoom')].map((b) => (b.textContent||'').trim()).filter((t) => /%|1:1|适应/.test(t)),
  })`)));

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
    let hitCard = null;
    for (let dx = 0; dx <= 0.36 && cards.some((c) => drop.x > c.left - 70 && drop.x < c.right + 70 && drop.y > c.top - 70 && drop.y < c.bottom + 70); dx += 0.06) {
      for (let dy = 0; dy <= 0.36; dy += 0.06) {
        const x = er.left + er.width * (0.62 + dx), y = er.top + er.height * (0.7 + dy);
        if (x > er.right - 30 || y > er.bottom - 30) break;
        if (!cards.some((c) => x > c.left - 70 && x < c.right + 70 && y > c.top - 70 && y < c.bottom + 70)) { drop = { x: Math.round(x), y: Math.round(y) }; dx = 9; break; }
      }
    }
    return {
      editor: { left: Math.round(er.left), top: Math.round(er.top), w: Math.round(er.width), h: Math.round(er.height) },
      swCard: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) },
      start: p, portCount: dots.length, drop,
      cardCount: cards.length,
      cardBoxes: cards.map((c) => [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)]),
      atStart: (() => { const e = document.elementFromPoint(p.x, p.y); return e ? e.tagName + '.' + (typeof e.className === 'string' ? e.className : '[svg]') : 'null'; })(),
      atDrop: (() => { const e = document.elementFromPoint(drop.x, drop.y); return e ? e.tagName + '.' + (typeof e.className === 'string' ? e.className : '[svg]') : 'null'; })(),
      overlays: [...document.querySelectorAll('.dsh-wf-right,.minimap-panel,.dsh-wf-toolbar,.dsh-wf-panel,.gedit-playground')].map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { cls: el.className, pos: cs.position, z: cs.zIndex, box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] };
      }),
      dotHitRaw: dots[0] ? (() => { const e = document.elementFromPoint(dots[0].x, dots[0].y); return e ? e.tagName + '.' + (typeof e.className === 'string' ? e.className : '[svg]') : 'null'; })() : null,
      allPointDots: [...document.querySelectorAll('.workflow-point-bg')].map((el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; }),
    };
  })()`);
  log('— 几何 —');
  log(JSON.stringify(geo));

  const drag = (x, y, dx, dy) => `
    (async () => {
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const trace = [];
      const fire = (type, px, py) => {
        const t = document.elementFromPoint(px, py) ?? editor;
        trace.push(type + '@' + px + ',' + py + '→' + t.tagName + '.' + (typeof t.className === 'string' ? t.className.split(' ')[0] : '[svg]'));
        t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, view: window }));
      };
      const seq = [
        ['mousemove', ${x}, ${y}], ['mousemove', ${x}, ${y}], ['mousemove', ${x}, ${y}],
        ['mousedown', ${x}, ${y}],
        ['mousemove', (${x} + ${dx}) / 2, (${y} + ${dy}) / 2],
        ['mousemove', ${dx}, ${dy}],
        ['mouseup', ${dx}, ${dy}],
      ];
      for (const [t, px, py] of seq) { fire(t, px, py); await new Promise((r) => setTimeout(r, 180)); }
      return {
        trace,
        quick: !!document.querySelector('.dsh-wf-fg-quick'),
        quickAll: document.querySelectorAll('.dsh-wf-fg-quick').length,
        lines: document.querySelectorAll('.dsh-wf-fg-line').length,
        nodeCount: (window.__df_def?.nodes ?? []).length,
        lastDrag: window.__df_lastDrag ?? null,
      };
    })()`;

  const hit = await evaluate(cdp, drag(geo.start.x, geo.start.y, geo.drop.x, geo.drop.y));
  log('— 拖线结果 —');
  log(JSON.stringify(hit));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
