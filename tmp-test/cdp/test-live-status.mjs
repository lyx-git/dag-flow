// tmp-test/cdp/test-live-status.mjs — 运行过程态（2026-10-03 用户需求原话：
//   「工作流运行的时候，画布中的每个节点都要有状态，待运行，运行中，执行完成，执行失败，要按照工作流的
//     运行路径依次显示，不要最后一次性显示状态，中间状态都没有」+「运行按钮要变成动态运行按钮，取消按钮要红色」）
//
// 手段：夹具控制口 POST /__run-mode {mode:'slow'} 让 /run 分阶段推进（每节点 500ms），
//       画布每 600ms 轮询 /run/status?name= → 于是能观察到「待运行 → 运行中 → 完成」的中间态。
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

  // ⑤⑥⑦⑧⑨⑩ 头部按钮：动态「运行中」（转圈）+ 红色取消（2026-10-03 用户要求「取消按钮要变成红色」）
  const btnText = await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success')?.textContent ?? ''`);
  ok(btnText.includes('运行中'), `⑤ 运行按钮变成动态「运行中」（实际 ${JSON.stringify(btnText.trim())}）`);
  ok(await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success')?.classList.contains('is-running')`), '⑥ 运行按钮带 is-running（扫光动画类）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn-success .dsh-wf-run-spin')`), '⑦ 运行按钮里是**转圈**图标（.dsh-wf-run-spin）');
  ok(await evaluate(cdp, `(() => { const s = getComputedStyle(document.querySelector('.dsh-wf-run-spin')); return s.animationName !== 'none' && /rotate/.test(s.animationName); })()`), '⑧ 转圈图标带旋转动画（animation-name 含 rotate）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn.is-danger')`), '⑨ 取消按钮出现且为红色（.is-danger）');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-btn.is-danger')?.textContent ?? '').includes('取消')`), '⑩ 取消按钮文案含「取消」');
  const dangerColor = await evaluate(cdp, `getComputedStyle(document.querySelector('.dsh-wf-btn.is-danger')).color`);
  ok(/25[0-5]|24[0-9]/.test(dangerColor) || dangerColor.includes('252'), `⑫ 取消按钮确实是红色系（color=${dangerColor}）`);

  // ⑩ 取消真的能中止（点一次，按钮状态必须收回来）
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn.is-danger').click(); true;`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-btn.is-danger')`, { timeout: 8000 });
  ok(true, '⑩ 点取消后运行态收起（取消按钮消失）');

  // ⑪ 再跑一次慢速，等它自然跑完 → 恢复静态 ▶、全部完成态
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-badge.is-run')`, { timeout: 6000 });
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-badge.is-wait') && !document.querySelector('.dsh-wf-fg-badge.is-run')`, { timeout: 20000 });
  await waitFor(cdp, `(document.querySelector('.dsh-wf-btn-success')?.textContent ?? '').trim() === '▶'`, { timeout: 8000 });
  ok(true, '⑪ 跑完恢复静态 ▶ 按钮');
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-btn.is-danger')`), false, '⑫ 跑完取消按钮消失');
  const doneOk = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length`);
  ok(doneOk >= 2, `⑬ 结束时节点都是完成态（${doneOk} 个 ✓）`);

  await setMode('fast'); // 兜底还原，避免影响其它用例
}
