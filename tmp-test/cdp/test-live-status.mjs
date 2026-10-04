// tmp-test/cdp/test-live-status.mjs — 运行过程态（2026-10-03 用户需求原话：
//   「工作流运行的时候，画布中的每个节点都要有状态，待运行，运行中，执行完成，执行失败，要按照工作流的
//     运行路径依次显示，不要最后一次性显示状态，中间状态都没有」+「运行按钮要变成动态运行按钮，取消按钮要红色」）
//
// 手段：夹具控制口 POST /__run-mode {mode:'slow'} 让 /run 分阶段推进（每节点 500ms），
//       画布每 600ms 轮询 /run/status?name= → 于是能观察到「待运行 → 运行中 → 完成」的中间态。
import { confirmSelfcheck } from './driver.mjs';
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep, name, base }) {
  // 打开慢速运行模式
  const setMode = async (mode) => evaluate(cdp, `
    fetch(${JSON.stringify(base + '/__run-mode')}, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: ${JSON.stringify(mode)} }) }).then((r) => r.json())
  `);
  const mode = await setMode('slow');
  ok(mode?.mode === 'slow', '⓪ 夹具切到慢速运行模式（分阶段推进）');

  // ★ 用 6 节点的 ?vars=1 夹具（start→set_var→web_search→python→subagent→end）：才看得清"依次点亮"
  await evaluate(cdp, `(() => { location.href = ${JSON.stringify(`${base}/cdp-host.html?name=${name}&vars=1`)}; return true; })()`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 4`, { timeout: 20000 });
  const nodeCount = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length`);

  // ① 起跑 → **立刻**全部是「待运行」（不是空白，也不是等结束一次性出结果）
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length >= 1`, { timeout: 4000 });
  const waits = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length`);
  ok(waits >= 2, `① 起跑后立刻显示「待运行」（${waits} / ${nodeCount} 个节点）`);

  // ② 中间态：出现「运行中…」（说明过程态真的推到了画布）
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-run').length >= 1`, { timeout: 6000 });
  ok(true, '② 出现「运行中…」状态（不是最后一次性显示）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-card.is-running')`), '③ 正在执行的节点卡有蓝色高亮（is-running）');

  // ④ 「已完成 + 运行中/待运行」在同一时刻并存 = 沿运行路径依次点亮
  //   ★ 必须**等到该时刻**再断言：刚起跑那一帧只有「1 个运行中 + 其余待运行」，还没有任何节点完成
  //   （本用例第一版就在那一帧断言，假失败：已完成 0 / 运行中 1 / 待运行 5）
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length >= 1
    && (document.querySelectorAll('.dsh-wf-fg-badge.is-run').length + document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length) >= 1`, { timeout: 10000 });
  const mid = await evaluate(cdp, `({
    ok: document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length,
    run: document.querySelectorAll('.dsh-wf-fg-badge.is-run').length,
    wait: document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length,
  })`);
  ok(mid.ok >= 1 && (mid.run + mid.wait) >= 1,
    `④ 同一时刻多种状态并存（已完成 ${mid.ok} / 运行中 ${mid.run} / 待运行 ${mid.wait}）`);

  // ⑤⑥⑦⑧⑨⑩⑪ 头部按钮：动态「运行中」（方案 D 弧线环 + 呼吸外发光）+ 红色取消，且**运行按钮排在取消前面**
  //   （2026-10-03 用户要求「运行中的按钮要放到取消按钮前面」；动态样式在原型里拍板 D）
  const btnText = await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success')?.textContent ?? ''`);
  ok(btnText.includes('运行中'), `⑤ 运行按钮变成动态「运行中」（实际 ${JSON.stringify(btnText.trim())}）`);
  ok(await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success')?.classList.contains('is-running')`), '⑥ 运行按钮带 is-running（扫光/发光动画类）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn-success .dsh-wf-run-ring')`), '⑦ 运行按钮里是**弧线旋转环**（.dsh-wf-run-ring，方案 D）');
  ok(await evaluate(cdp, `(() => { const s = getComputedStyle(document.querySelector('.dsh-wf-run-ring')); return s.animationName !== 'none' && /rotate/.test(s.animationName); })()`), '⑧ 弧线环带旋转动画（animation-name 含 rotate）');
  ok(await evaluate(cdp, `(() => { const s = getComputedStyle(document.querySelector('.dsh-wf-run-ring')); return s.borderTopColor !== s.borderRightColor && s.borderRadius === '50%'; })()`), '⑧b 环是「弧线」而非整圆（top/bottom 边框色不同 + 圆角 50%）');
  ok(await evaluate(cdp, `(() => { const s = getComputedStyle(document.querySelector('.dsh-wf-btn.is-running')); return s.animationName !== 'none' && /glow/.test(s.animationName); })()`), '⑧c 按钮带呼吸外发光（animation-name 含 glow，方案 D 的强化项）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn.is-danger')`), '⑨ 取消按钮出现且为红色（.is-danger）');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-btn.is-danger')?.textContent ?? '').includes('取消')`), '⑩ 取消按钮文案含「取消」');
  // ★ 顺序：运行按钮必须在取消按钮**前面**（同属 header 的按钮序列）
  ok(await evaluate(cdp, `
    (() => {
      const btns = [...document.querySelectorAll('header .dsh-wf-btn')];
      const run = btns.findIndex((b) => b.classList.contains('dsh-wf-btn-success'));
      const cancel = btns.findIndex((b) => b.classList.contains('is-danger'));
      return run >= 0 && cancel >= 0 && run < cancel;
    })()
  `), '⑪ 运行按钮排在取消按钮前面（用户要求）');
  // ★ ⑪b 几何证据：运行按钮的**左边缘**必须在取消按钮左边缘的左侧（肉眼可见的前后关系，不只是 DOM 顺序）
  const order = await evaluate(cdp, `(() => {
    const run = document.querySelector('.dsh-wf-btn-success')?.getBoundingClientRect();
    const cancel = document.querySelector('.dsh-wf-btn.is-danger')?.getBoundingClientRect();
    const ring = document.querySelector('.dsh-wf-run-ring')?.getBoundingClientRect();
    return run && cancel ? { runLeft: Math.round(run.left), cancelLeft: Math.round(cancel.left),
      runRight: Math.round(run.right), cancelRight: Math.round(cancel.right),
      ringW: ring ? Math.round(ring.width) : 0, ringH: ring ? Math.round(ring.height) : 0 } : null;
  })()`);
  ok(!!order && order.runLeft < order.cancelLeft && order.runRight <= order.cancelLeft + 1,
    `⑪b 几何顺序：运行按钮在取消按钮左侧且不重叠（run ${order?.runLeft}~${order?.runRight} / cancel ${order?.cancelLeft}~${order?.cancelRight}）`);
  ok(order?.ringW > 0 && order?.ringH > 0, `⑪c 弧线环有实际尺寸（${order?.ringW}×${order?.ringH}px）`);
  const dangerColor = await evaluate(cdp, `getComputedStyle(document.querySelector('.dsh-wf-btn.is-danger')).color`);
  ok(/25[0-5]|24[0-9]/.test(dangerColor) || dangerColor.includes('252'), `⑫ 取消按钮确实是红色系（color=${dangerColor}）`);

  // ★ ⑭ 运行中就能看到节点输出（2026-10-03 用户反馈：「节点悬浮弹窗的执行结果，为何要等工作流全部执行完
  //   才能显示，不应该执行完一个节点悬浮窗就显示执行结果吗」）——此刻流程**仍在跑**，
  //   悬浮一个刚完成的节点，悬浮卡必须已经带着它的 out（宿主 /run/status 逐节点带 out）。
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => c.querySelector('.dsh-wf-fg-badge.is-ok') && (c.textContent || '').includes('写全局变量'))`, { timeout: 5000 });
  await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge.is-ok') && (c.textContent || '').includes('写全局变量'));
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return true;
  })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`, { timeout: 4000 });
  const tipText = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip')?.textContent ?? ''`);
  const stillRunning = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-run').length + document.querySelectorAll('.dsh-wf-fg-badge.is-wait').length`);
  ok(stillRunning >= 1, `⑭a 悬浮时流程仍在跑（运行中/待运行 ${stillRunning} 个）——证明不是"等全部跑完才显示"`);
  ok(tipText.includes('AI 日报'),
    `⑭b 运行中悬浮卡已显示该节点输出（set_var 的 out.topic；实际：${JSON.stringify(tipText.slice(0, 90))}）`);


  // ⑩ 取消真的能中止（点一次，按钮状态必须收回来）
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn.is-danger').click(); true;`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-btn.is-danger')`, { timeout: 8000 });
  ok(true, '⑩ 点取消后运行态收起（取消按钮消失）');

  // ⑪ 再跑一次慢速，等它自然跑完 → 恢复静态 ▶、全部完成态
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-badge.is-run')`, { timeout: 6000 });
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-badge.is-wait') && !document.querySelector('.dsh-wf-fg-badge.is-run')`, { timeout: 20000 });
  await waitFor(cdp, `(document.querySelector('.dsh-wf-btn-success')?.textContent ?? '').trim() === '▶'`, { timeout: 8000 });
  ok(true, '⑪ 跑完恢复静态 ▶ 按钮');
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn.is-danger')`), false, '⑫ 跑完取消按钮消失');
  const doneOk = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length`);
  ok(doneOk >= 2, `⑬ 结束时节点都是完成态（${doneOk} 个 ✓）`);

  await setMode('fast'); // 兜底还原，避免影响其它用例
}
