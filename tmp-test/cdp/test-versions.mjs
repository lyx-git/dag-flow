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
  const h1 = await evaluate(cdp, `document.querySelector('.dag-flow-picker').getBoundingClientRect().height`);
  await evaluate(cdp, `
    const handle = document.querySelector('.dag-flow-picker-resize-y');
    const y = handle.getBoundingClientRect().top + 5;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: y, button: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientY: y - 120 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    true;
  `);
  await waitFor(cdp, `document.querySelector('.dag-flow-picker').getBoundingClientRect().height > ${h1 + 100}`, { timeout: 3000 });
  await evaluate(cdp, `document.querySelector('.dag-flow-picker-close').click()`);
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker')`, { timeout: 3000 });
  await evaluate(cdp, `window.__df_clickBtn('🕘')`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  eq(await evaluate(cdp, `document.querySelectorAll('.dag-flow-picker .dsh-wf-btn').length`), 2, '✕ 关闭重开后仍渲染 2 行');

  // 5c. 标题去工作流名后缀 + 数据存储位置标注（2026-10-01 夜用户要求）
  ok(await evaluate(cdp, `(() => { const t = document.querySelector('.dag-flow-picker-ver .dag-flow-picker-title').textContent; return t.includes('历史版本') && !t.includes(${JSON.stringify(name)}); })()`),
    'title 只剩「🕘 历史版本」（不带工作流名）');
  ok(await evaluate(cdp, `(() => { const t = (document.querySelector('.dag-flow-picker-ver-path')?.textContent) ?? ''; return t.includes('数据存于') && t.includes('versions') && t.includes(${JSON.stringify(name)}); })()`),
    '标注了数据存储位置（dir\\versions\\<名>\\）');

  // 6. 回载旧版本（第 2 行 = 初始 2 节点内容）→ def 恢复、弹窗关闭、落盘、版本数不虚增
  await evaluate(cdp,
    `[...document.querySelectorAll('.dag-flow-picker .dsh-wf-btn')].filter(b => b.textContent.includes('回载'))[1].click()`);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? -1) === 2`, { timeout: 8000 });
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  await waitFor(cdp, `${getNodes}.then(v => v === 2)`, { timeout: 8000 });
  eq(await evaluate(cdp, getVersions), 2, '回载不产生重复版本（回载前内容与最新版本相同 → 去重）');
}
