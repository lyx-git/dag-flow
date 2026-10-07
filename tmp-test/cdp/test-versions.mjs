// tmp-test/cdp/test-versions.mjs — 版本功能（用户 2026-10-01 夜：手动保存生成版本方便回退，
// 自动保存不生成——否则版本太多；🕘 弹窗此前从未渲染）。
// 全部经 HTTP GET 断言 fixture 服务器状态（黑盒，与客户端同一 API 面）。
export async function run({ cdp, evaluate, waitFor, ok, eq, name, sleep }) {
  const enc = encodeURIComponent(name);
  const getVersions = `fetch('/api/dag-flow/workflows/${enc}/versions').then(r=>r.json()).then(d=>d.versions.length).catch(()=>-1)`;
  const getNodes = `fetch('/api/dag-flow/workflows/${enc}').then(r=>r.json()).then(d=>d.workflow?.nodes?.length ?? -1).catch(()=>-1)`;

  // 初始：无版本、未落盘
  eq(await evaluate(cdp, getVersions), 0, '初始无版本');

  // 1. 手动保存#1 → 版本=1（存本次保存内容）
  // ★ 注意：比较必须放进 .then 内——(fetchPromise) === 2 是「Promise 与数字比较」恒 false，
  //   evaluate 的 awaitPromise 只 await 最外层表达式
  // ★ 头部按钮为纯图标（2026-10-01 深夜），按 emoji 定位
  await evaluate(cdp, `window.__df_clickBtn('💾')`);
  await waitFor(cdp, `${getNodes}.then(v => v === 2)`, { timeout: 8000 });
  eq(await evaluate(cdp, getVersions), 1, '手动保存#1 生成 1 个版本');

  // 2. 选中节点 → Del 删除 → 自动保存落盘，但版本数不变（snapshot:false）
  await evaluate(cdp, `window.__df_clickNode(0)`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`, { timeout: 5000 });
  await evaluate(cdp, `window.__df_pressKey('Delete')`);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? -1) === 1`, { timeout: 5000 });
  await waitFor(cdp, `${getNodes}.then(v => v === 1)`, { timeout: 10000 }); // 等 2s 防抖自动保存落盘
  eq(await evaluate(cdp, getVersions), 1, '自动保存不生成版本');

  // 3. 手动保存#2（内容与最新版本不同——即便盘上已是该内容也生成版本）→ 版本=2
  await evaluate(cdp, `window.__df_clickBtn('💾')`);
  await waitFor(cdp, `${getVersions}.then(v => v === 2)`, { timeout: 8000 });

  // 4. 重复手动保存（内容未变）→ 去重，版本仍=2
  await evaluate(cdp, `window.__df_clickBtn('💾')`);
  await sleep(500);
  eq(await evaluate(cdp, getVersions), 2, '重复保存同样内容不产生重复版本');

  // 5. 🕘 打开版本弹窗 → 此前从未渲染，现在必须出现且列出 2 行
  await evaluate(cdp, `window.__df_clickBtn('🕘')`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  eq(await evaluate(cdp, `document.querySelectorAll('.dag-flow-picker .dsh-wf-btn').length`), 2,
    '版本弹窗渲染（2 个「回载」行）');

  // 5b. UX（2026-10-01 夜反馈）：title 加大 / hint 小字 / ✕ 右上角（无底部按钮行）/ 上边缘可拖高
  eq(await evaluate(cdp, `getComputedStyle(document.querySelector('.dag-flow-picker-ver .dag-flow-picker-title')).fontSize`),
    '16px', 'title 字号 16px');
  eq(await evaluate(cdp, `getComputedStyle(document.querySelector('.dag-flow-picker-ver .dag-flow-picker-hint')).fontSize`),
    '11px', 'hint 字号 11px');
  ok(await evaluate(cdp, `!!document.querySelector('.dag-flow-picker .dag-flow-picker-close')`), '右上角 ✕ 关闭按钮');
  ok(await evaluate(cdp, `!document.querySelector('.dag-flow-picker-foot')`), '底部按钮行已移除');
  const h1 = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().height`);
  const top1 = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().top`);
  await evaluate(cdp, `
    const handle = document.querySelector('.dag-flow-picker-resize-y');
    const y = handle.getBoundingClientRect().top + 5;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientY: y - 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    true;
  `);
  await waitFor(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().height > ${h1 + 100}`, { timeout: 3000 });
  // 顶边跟随光标上移（顶部锚定后仍然成立——这是 2026-10-01 夜定下的手感，不能被定位改动破坏）
  const top2 = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().top`);
  ok(top2 < top1 - 40, `5b 拖上边缘时顶边跟随光标上移（${top1} → ${top2}）`);
  await evaluate(cdp, `document.querySelector('.dag-flow-picker-close').click()`);
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker')`, { timeout: 3000 });
  await evaluate(cdp, `window.__df_clickBtn('🕘')`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  eq(await evaluate(cdp, `document.querySelectorAll('.dag-flow-picker .dsh-wf-btn').length`), 2, '✕ 关闭重开后仍渲染 2 行');
  // 重开回到默认落点（上移偏移不跨次记忆）
  const top3 = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().top`);
  ok(Math.abs(top3 - top1) <= 4, `5b 重开回到默认落点（${top1} → ${top3}）`);

  // 5c. 标题去工作流名后缀 + 数据存储位置标注（2026-10-01 夜用户要求）
  ok(await evaluate(cdp, `(() => { const t = document.querySelector('.dag-flow-picker-ver .dag-flow-picker-title').textContent; return t.includes('历史版本') && !t.includes(${JSON.stringify(name)}); })()`),
    'title 只剩「🕘 历史版本」（不带工作流名）');
  ok(await evaluate(cdp, `(() => { const t = (document.querySelector('.dag-flow-picker-ver-path')?.textContent) ?? ''; return t.includes('数据存于') && t.includes('versions') && t.includes(${JSON.stringify(name)}); })()`),
    '标注了数据存储位置（dir\\versions\\<名>\\）');

  // 5d. ★ 位置与 ⏰ 定时任务弹窗一致（2026-10-04 用户反馈「历史版本弹窗有点偏中下部了，最好和定时任务弹窗保持一致」）
  //     旧实现内联了 alignItems:'flex-end' + paddingBottom:'8vh'（底部锚定 → 落在中下部）；
  //     现改用 overlay 默认的顶部锚定（align-items:flex-start; padding-top:14vh），与 ⏰ 同一落点。
  const verTop = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().top`);
  const vh = await evaluate(cdp, `window.innerHeight`);
  ok(Math.abs(verTop - vh * 0.14) <= 4,
    `5d 版本弹窗顶部锚在 14vh（实测 top=${verTop}，期望 ${(vh * 0.14).toFixed(1)}）`);
  // 宽度保持 .dag-flow-picker 默认 680（本弹窗没有专属宽度规则 → 确认提权只影响"有规则的"弹窗，没有外溢）
  eq(await evaluate(cdp, `Math.round(document.querySelector('.dag-flow-picker-ver').getBoundingClientRect().width)`),
    680, '5d 版本弹窗保持默认宽度 680（宽度规则没有外溢到它身上）');
  const verText = await evaluate(cdp, `document.querySelector('.dag-flow-picker-ver').textContent`);
  ok(!verText.includes('**'), '5d 版本弹窗可见文案里没有 Markdown 星号');
  // 打开 ⏰ 弹窗量同一参照点 → 两个弹窗必须落在同一水平线上
  await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'))?.click()`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker.dsh-wf-sched')`, { timeout: 8000 });
  const schedTop = await evaluate(cdp, `document.querySelector('.dag-flow-picker.dsh-wf-sched').getBoundingClientRect().top`);
  ok(Math.abs(verTop - schedTop) <= 2,
    `5d 版本弹窗与定时任务弹窗同一落点（版本 ${verTop} vs 定时 ${schedTop}）`);
  // 关掉 ⏰ 弹窗（后面的步骤按 .dag-flow-picker 首个匹配取元素，留着会串味）
  await evaluate(cdp, `document.querySelector('.dsh-wf-sched .dag-flow-picker-close').click()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-sched')`, { timeout: 5000 });
  ok(await evaluate(cdp, `!!document.querySelector('.dag-flow-picker-ver')`), '5d 关掉定时弹窗后版本弹窗仍在（互不干扰）');

  // 6. 回载旧版本（第 2 行 = 初始 2 节点内容）→ def 恢复、弹窗关闭、落盘、版本数不虚增
  await evaluate(cdp,
    `[...document.querySelectorAll('.dag-flow-picker .dsh-wf-btn')].filter(b => b.textContent.includes('回载'))[1].click()`);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? -1) === 2`, { timeout: 8000 });
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  await waitFor(cdp, `${getNodes}.then(v => v === 2)`, { timeout: 8000 });
  eq(await evaluate(cdp, getVersions), 2, '回载不产生重复版本（回载前内容与最新版本相同 → 去重）');
}
