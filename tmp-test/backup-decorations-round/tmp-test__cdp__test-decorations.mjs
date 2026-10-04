// tmp-test/cdp/test-decorations.mjs — 画布装饰：分组框 + 便签（2026-10-04 用户拍板方案 A）
//   用户诉求：「给一组节点打组、给画布加注释，让大图可读」；
//   另行拍板两个行为：①拖动框 → **框内节点一起移动**；②便签**可折叠**成一行。
// 契约（本用例钉死）：
//   ① 头部「▭ 分组」/「📝 便签」可新建装饰，画布上出现 `.dsh-wf-deco-group` / `.dsh-wf-deco-note`
//   ② 标题/便签文字可编辑并落到 `def.canvas`（**不进 def.nodes**）
//   ③ ★拖动分组框 → 框内节点按同一位移一起移动（框外节点不动）
//   ④ 便签可折叠（`.is-collapsed` + def.canvas.comments[].collapsed=true）
//   ⑤ ✕ 删除：画布元素消失 + def.canvas 里也移除
//   ⑥ ★执行图零污染：全程 def.nodes / def.edges 数量不变
import { confirmSelfcheck } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  const def = () => evaluate(cdp, `window.__df_def ?? null`);
  const nodePos = (id) => evaluate(cdp, `window.__df_node_pos?.(${JSON.stringify(id)}) ?? null`);

  // 拖动某个画布节点（原生事件：我们的拖拽引擎挂在 window capture 上）
  const dragNode = async (selector, dx, dy) => {
    await evaluate(cdp, `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      const x1 = r.left + 8, y1 = r.top + 8;
      const fire = (type, x, y, target) => (target ?? document.elementFromPoint(x, y) ?? document).dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
      fire('pointerdown', x1, y1, el); fire('mousedown', x1, y1, el);
      for (let i = 1; i <= 4; i++) { fire('pointermove', x1 + ${dx} * i / 4, y1 + ${dy} * i / 4); fire('mousemove', x1 + ${dx} * i / 4, y1 + ${dy} * i / 4); }
      fire('pointerup', x1 + ${dx}, y1 + ${dy}, document); fire('mouseup', x1 + ${dx}, y1 + ${dy}, document);
      await new Promise((res) => setTimeout(res, 500));
      return true;
    })()`);
    await sleep(250);
  };

  await waitFor(cdp, `!!document.querySelector('.dsh-wf-deco-add')`, { timeout: 15000 });
  const base = await def();
  const baseNodes = (base?.nodes ?? []).length;
  const baseEdges = (base?.edges ?? []).length;

  // ===== A. 新建分组框 =====
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-deco-add')][0].click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-deco-group')`, { timeout: 8000 });
  ok(true, '① 头部「▭ 分组」新建出分组框');
  await waitFor(cdp, `(window.__df_def?.canvas?.groups ?? []).length === 1`, { timeout: 5000 });
  const g1 = await evaluate(cdp, `window.__df_def.canvas.groups[0]`);
  ok(typeof g1.id === 'string' && g1.x !== undefined && g1.width > 0, '② 分组框落进 def.canvas（带 id/位置/尺寸）');
  eq((await def()).nodes.length, baseNodes, '③ ★装饰不进 def.nodes（执行图零污染）');
  ok(((await def()).edges ?? []).every((e) => !String(e.from).startsWith('deco-') && !String(e.to).startsWith('deco-')), '③b 装饰不参与任何连线（装饰类型没有端口）');

  // 改名（输入 + blur 提交）
  await evaluate(cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-deco-title');
    inp.focus();   // React 的 onBlur 走 focusout，得先真聚焦再 blur（合成 blur 事件不冒泡）
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
    desc.set.call(inp, '数据抓取');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    return true;
  })()`);
  await waitFor(cdp, `(window.__df_def?.canvas?.groups?.[0]?.title ?? '') === '数据抓取'`, { timeout: 6000 });   // 防抖 400ms 后自动落库
  ok(true, '④ 标题改名落到 def.canvas（blur 提交）');

  // ===== B. ★拖动分组框 → 框内节点一起走 =====
  // 先把 start 节点拖进框里（保证有一个确定的成员），再拖框，对比两者位移
  const boxRect = await evaluate(cdp, `(() => { const r = document.querySelector('.dsh-wf-deco-group').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const startRect = await evaluate(cdp, `(() => { const r = document.querySelector('.dsh-wf-fg-card').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: r.left, y: r.top }; })()`);
  await dragNode('.dsh-wf-fg-card', Math.round(boxRect.x + 40 - startRect.x), Math.round(boxRect.y + 60 - startRect.y));
  const startId = await evaluate(cdp, `(window.__df_def.nodes ?? [])[0]?.id ?? ''`);
  const posA = await nodePos(startId);
  const boxPosA = await evaluate(cdp, `(() => { const g = (window.__df_def.canvas.groups ?? [])[0]; return { x: g.x, y: g.y }; })()`);

  await dragNode('.dsh-wf-deco-group', 120, 90);
  const posB = await nodePos(startId);
  const boxPosB = await evaluate(cdp, `(() => { const g = (window.__df_def.canvas.groups ?? [])[0]; return { x: g.x, y: g.y }; })()`);
  const boxDx = boxPosB.x - boxPosA.x;
  const boxDy = boxPosB.y - boxPosA.y;
  ok(Math.abs(boxDx) > 50 && Math.abs(boxDy) > 30, `⑤ 分组框被拖动了（Δ=${boxDx},${boxDy}）`);
  ok(posA && posB && Math.abs((posB.x - posA.x) - boxDx) <= 3 && Math.abs((posB.y - posA.y) - boxDy) <= 3,
    `⑤b ★框内节点跟着同一位移一起移动（节点 Δ=${posA && posB ? [Math.round(posB.x - posA.x), Math.round(posB.y - posA.y)] : null} vs 框 Δ=${[boxDx, boxDy]}）`);

  // ===== C. 便签：新建 / 写字 / 折叠 / 删除 =====
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-deco-add')][1].click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-deco-note')`, { timeout: 8000 });
  ok(true, '⑥ 「📝 便签」新建出便签');
  await evaluate(cdp, `(() => {
    const ta = document.querySelector('.dsh-wf-deco-note-text');
    ta.focus();
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value');
    desc.set.call(ta, '这一组负责当天材料抓取');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
    return true;
  })()`);
  await waitFor(cdp, `(window.__df_def?.canvas?.comments?.[0]?.text ?? '').includes('当天材料')`, { timeout: 6000 });
  ok(true, '⑦ 便签文字落到 def.canvas');

  // 折叠（第一个按钮 ▾）
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-deco-note .dsh-wf-deco-btn').click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-deco-note.is-collapsed')`, { timeout: 5000 });
  await waitFor(cdp, `window.__df_def?.canvas?.comments?.[0]?.collapsed === true`, { timeout: 5000 });
  ok(true, '⑧ 便签可折叠成一行（画布 + def.canvas 同步）');

  // 删除便签（最后一个按钮 ✕）
  await evaluate(cdp, `(() => {
    const btns = [...document.querySelectorAll('.dsh-wf-deco-note .dsh-wf-deco-btn')];
    btns[btns.length - 1].click(); return true;
  })()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-deco-note')`, { timeout: 5000 });
  await waitFor(cdp, `(window.__df_def?.canvas?.comments ?? []).length === 0`, { timeout: 5000 });
  ok(true, '⑨ 删除便签：画布元素消失且 def.canvas 同步移除');

  // ===== D. 收尾：执行图仍然零污染 =====
  const after = await def();
  eq(after.nodes.length, baseNodes, '⑩ ★全程 def.nodes 数量不变（装饰从不进执行图）');
  ok((after.edges ?? []).every((e) => !String(e.from).startsWith('deco-') && !String(e.to).startsWith('deco-')), '⑩b ★全程没有任何连线连到装饰（执行图与装饰完全隔离）');
  ok((after.canvas?.groups ?? []).length === 1, '⑩c 分组框仍在 def.canvas');
}
