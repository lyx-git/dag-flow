// tmp-test/cdp/test-palette-drag.mjs — 左侧节点面板「仅拖拽添加」（2026-10-02 用户需求）：
// ①原位单击节点项（按下即松开、无位移）→ 画布不新增节点；②按下后拖到画布松开 → 节点创建。
// 实现机制：mousedown 记起点 → window capture mousemove 位移 ≥4px 才 startDragCard →
// mouseup 无位移 = 清理监听无副作用。
// ★ 合成事件派发到页面内元素（window 派发不经过 document capture，FlowGram 收不到）。
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  const before = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);

  // ① 原位单击 → 不加节点
  await evaluate(cdp, `
    (() => {
      const item = document.querySelector('.dsh-wf-fg-palette-item');
      const r = item.getBoundingClientRect();
      const x = r.left + 5, y = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    })(); true;
  `);
  await sleep(400);
  const afterClick = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);
  eq(afterClick, before, '原位单击不添加节点（节点数 ' + before + ' → ' + afterClick + '）');

  // ② 按下 → 拖到画布 → 松开 = 创建节点
  await evaluate(cdp, `
    (() => {
      const item = document.querySelectorAll('.dsh-wf-fg-palette-item')[2];
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.6, ey = er.top + er.height * 0.6;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      window.__df_dragEx = ex; window.__df_dragEy = ey;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);
  // 拖影出现：克隆的面板项挂在 body（absolute + zIndex:1000）且跟随光标
  await waitFor(cdp, `
    (() => {
      const ghosts = [...document.body.children].filter((el) =>
        el.classList?.contains('dsh-wf-fg-palette-item') && (el.style?.zIndex || '') !== '');
      if (!ghosts.length) return false;
      const g = ghosts[0].getBoundingClientRect();
      return Math.abs((g.left + g.width / 2) - window.__df_dragEx) < 260
          && Math.abs((g.top + g.height / 2) - window.__df_dragEy) < 260;
    })()
  `, { timeout: 5000 });
  ok(true, '拖拽时鼠标下有节点拖影（克隆面板项跟随光标）');
  await evaluate(cdp, `
    (() => {
      const editor = document.querySelector('.dsh-wf-fg-editor');
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: window.__df_dragEx, clientY: window.__df_dragEy }));
    })(); true;
  `);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${typeof before === 'number' && before >= 0 ? before : 0}`, { timeout: 8000 });
  const afterDrag = await evaluate(cdp, `window.__df_def?.nodes?.length`);
  ok(afterDrag === (before >= 0 ? before + 1 : afterDrag), '拖拽到画布创建节点（节点数 ' + before + ' → ' + afterDrag + '）');

  // ③ 画布上出现新节点卡（def 镜像先行、React 卡片渲染晚几帧——waitFor 而非立即断言）
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 8000 });
  ok(true, '画布节点卡 ≥3（含新拖入节点）');
}
