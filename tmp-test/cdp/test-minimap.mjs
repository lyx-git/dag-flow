// tmp-test/cdp/test-minimap.mjs — 缩略图（2026-10-01 夜）：不与右面板互相遮挡 + 八向缩放 + 最小化/展开
export async function run({ cdp, evaluate, waitFor, ok }) {
  // ★ 确定性：清掉可能残留的尺寸（同 Chrome 跨轮复用时 localStorage 会留存，残留值会撞钳位）
  await evaluate(cdp, `localStorage.removeItem('dag-flow:minimap-w'); true;`);
  try { await evaluate(cdp, `location.reload(); true;`); } catch { /* reload 中断执行上下文属预期 */ }
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-minimap')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-right:not(.min)')`, { timeout: 5000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-minimap-rs.e')`, { timeout: 5000 });

  // ① 不互相遮挡：缩略图右缘 ≤ 右面板左缘
  ok(await evaluate(cdp, `(() => {
    const m = document.querySelector('.dsh-wf-fg-minimap').getBoundingClientRect();
    const r = document.querySelector('.dsh-wf-right').getBoundingClientRect();
    return m.right <= r.left + 2;
  })()`), '缩略图完全在右面板左侧（不互相遮挡）');

  // ② 边把手缩放：拖 e 把手 +60 → 变宽
  const w1 = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-minimap').getBoundingClientRect().width`);
  await evaluate(cdp, `
    (() => {
      const h = document.querySelector('.dsh-wf-fg-minimap-rs.e');
      const x = h.getBoundingClientRect().left + h.getBoundingClientRect().width / 2;
      const y = h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2;
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + 60, clientY: y }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    })();
    true;
  `);
  await waitFor(cdp, `document.querySelector('.dsh-wf-fg-minimap').getBoundingClientRect().width > ${w1 + 40}`, { timeout: 3000 });

  // ③ 角把手缩放：拖 se 角（右 +40 / 下 +24，按纵横比折算）→ 继续变宽
  const w2 = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-minimap').getBoundingClientRect().width`);
  await evaluate(cdp, `
    (() => {
      const h = document.querySelector('.dsh-wf-fg-minimap-rs.se');
      const x = h.getBoundingClientRect().left + 6;
      const y = h.getBoundingClientRect().top + 6;
      h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x + 40, clientY: y + 24 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    })();
    true;
  `);
  await waitFor(cdp, `document.querySelector('.dsh-wf-fg-minimap').getBoundingClientRect().width > ${w2 + 25}`, { timeout: 3000 });

  // ④ 最小化 → stub → 展开
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-minimap-min').click()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-minimap-stub') && !document.querySelector('.dsh-wf-fg-minimap')`, { timeout: 3000 });
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-minimap-stub').click()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-minimap')`, { timeout: 3000 });

  // ⑤ 尺寸持久化
  ok(await evaluate(cdp, `Number(localStorage.getItem('dag-flow:minimap-w')) >= 120`), '缩略图尺寸已持久化');
}
