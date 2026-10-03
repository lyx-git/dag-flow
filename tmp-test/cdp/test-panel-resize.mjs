// tmp-test/cdp/test-panel-resize.mjs — 左右面板八向拖拽调大小（2026-10-01 夜用户需求：四周边缘线和角）
// 覆盖：palette e/s 把手（宽/高）、right w/s 把手（宽/高，h 原为拉伸态→拖后定高）、geom 持久化。
export async function run({ cdp, evaluate, waitFor, ok }) {
  // ★ 确定性：清掉可能残留的几何（同 Chrome 跨轮复用时 localStorage 会留存），reload 后从默认值起测
  await evaluate(cdp, `localStorage.removeItem('dag-flow:palette-geom'); localStorage.removeItem('dag-flow:right-geom'); true;`);
  try { await evaluate(cdp, `location.reload(); true;`); } catch { /* reload 中断执行上下文属预期 */ }
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette:not(.min)')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-right:not(.min)')`, { timeout: 5000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-resize.se')`, { timeout: 5000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-right-resize.sw')`, { timeout: 5000 });

  const drag = (sel, dx, dy) => `
    (() => {
      const h = document.querySelector('${sel}');
      const x = h.getBoundingClientRect().left + h.getBoundingClientRect().width / 2;
      const y = h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2;
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + ${dx}, clientY: y + ${dy} }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    })();
    true;`;

  // ① palette e 把手向右拖 +80 → 变宽
  const w1 = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-palette').getBoundingClientRect().width`);
  await evaluate(cdp, drag('.dsh-wf-fg-palette-resize.e', 80, 0));
  await waitFor(cdp, `document.querySelector('.dsh-wf-fg-palette').getBoundingClientRect().width > ${w1 + 60}`, { timeout: 3000 });

  // ② palette s 把手向下拖 +80 → 变高（原为上下拉伸态，拖后转定高）
  const h1 = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-palette').getBoundingClientRect().height`);
  await evaluate(cdp, drag('.dsh-wf-fg-palette-resize.s', 0, 80));
  await waitFor(cdp, `document.querySelector('.dsh-wf-fg-palette').getBoundingClientRect().height > ${h1 + 60}`, { timeout: 3000 });

  // ③ right w 把手向左拖 -80 → 变宽
  const r1 = await evaluate(cdp, `document.querySelector('.dsh-wf-right').getBoundingClientRect().width`);
  await evaluate(cdp, drag('.dsh-wf-right-resize.w', -80, 0));
  await waitFor(cdp, `document.querySelector('.dsh-wf-right').getBoundingClientRect().width > ${r1 + 60}`, { timeout: 3000 });

  // ④ right s 把手向下拖 +80 → 变高
  const rh1 = await evaluate(cdp, `document.querySelector('.dsh-wf-right').getBoundingClientRect().height`);
  await evaluate(cdp, drag('.dsh-wf-right-resize.s', 0, 80));
  await waitFor(cdp, `document.querySelector('.dsh-wf-right').getBoundingClientRect().height > ${rh1 + 60}`, { timeout: 3000 });

  // ⑤ geom 持久化（JSON：宽高均为数字）
  ok(await evaluate(cdp, `(() => { const g = JSON.parse(localStorage.getItem('dag-flow:palette-geom') || '{}'); return typeof g.w === 'number' && typeof g.h === 'number'; })()`),
    'palette geom 已持久化');
  ok(await evaluate(cdp, `(() => { const g = JSON.parse(localStorage.getItem('dag-flow:right-geom') || '{}'); return typeof g.w === 'number' && typeof g.h === 'number'; })()`),
    'right geom 已持久化');
}
