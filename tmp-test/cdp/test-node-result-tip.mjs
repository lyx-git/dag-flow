// tmp-test/cdp/test-node-result-tip.mjs — ①节点「最终执行结果」悬浮卡（2026-10-03 用户需求：
// 「每个节点执行完最好有个最终执行结果可以在节点上看，无论失败还是成功，方便定位，可以是悬浮查看」）
// ②A 方案「失败不影响流程」勾选框（面板 → def 写入/删除）。
//
// 关键实现约定（断言依赖它，改实现前先看这里）：
//   · 悬浮卡 Portal 到 document.body + position:fixed（画布容器带 transform，留在卡内会被缩放/裁切）
//   · 用**原生** mouseenter/mouseleave 监听（节点层 stopPropagation 掉委托事件，React 的
//     onMouseEnter（由 mouseover 合成）在卡内收不到——与 chips 同坑位）；所以这里直接
//     dispatchEvent(new MouseEvent('mouseenter')) 即可命中。
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });

  // ① 还没运行 → 悬浮不弹（不做无信息噪声）
  await evaluate(cdp, `
    (() => { document.querySelector('.dsh-wf-fg-card').dispatchEvent(new MouseEvent('mouseenter')); })(); true;
  `);
  await sleep(250);
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`), false, '① 未运行时悬浮不弹卡（无信息不打扰）');

  // ② 运行一次（fixture /run stub 每个节点都返回 success + out）
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-badge')`, { timeout: 8000 });

  // ③ 悬浮「有结果」的节点卡 → 弹出最终执行结果
  await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge'));
      el.dispatchEvent(new MouseEvent('mouseenter'));
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`, { timeout: 3000 });
  const tip = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip').textContent`);
  ok(tip.includes('✓ 成功'), `③ 悬浮卡显示最终状态（${JSON.stringify(tip.slice(0, 50))}）`);
  ok(/\d+ms/.test(tip), '④ 悬浮卡带耗时');
  const code = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip-line.is-code')?.textContent ?? ''`);
  ok(code.length > 0, `⑤ 悬浮卡展示该节点的输出内容（${JSON.stringify(code.slice(0, 60))}）`);

  // ⑥⑦ Portal + fixed（画布缩放/平移不影响它）
  eq(await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip').parentElement === document.body`), true,
    '⑥ 悬浮卡 Portal 到 document.body（不留在画布 transform 容器里）');
  eq(await evaluate(cdp, `getComputedStyle(document.querySelector('.dsh-wf-fg-tip')).position`), 'fixed', '⑦ 定位是 fixed');

  // ⑧ 浮窗可交互（2026-10-03 用户反馈「无法把鼠标移到浮窗上复制错误」）：
  //    卡片 mouseleave 只安排延迟隐藏；鼠标进入浮窗 → 取消隐藏（不收起）→ 可选中文本 / 点复制
  await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge'));
      el.dispatchEvent(new MouseEvent('mouseleave'));
    })(); true;
  `);
  // 立刻进入浮窗（在 260ms 延迟窗口内）→ 必须仍在
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip')?.dispatchEvent(new MouseEvent('mouseenter')); true;`);
  await sleep(450);
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`), true, '⑧ 鼠标移进浮窗后不收起（可选中/可复制）');
  ok(await evaluate(cdp, `getComputedStyle(document.querySelector('.dsh-wf-fg-tip')).pointerEvents === 'auto'`), '⑨ 浮窗可接收鼠标事件（pointer-events:auto）');

  // ⑩ 📋 复制按钮：点一下 → 文案变「已复制」
  const btnOk = await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-tip-copy')`);
  ok(btnOk, '⑩ 浮窗有 📋 复制按钮');
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip-copy').click(); true;`);
  await waitFor(cdp, `(document.querySelector('.dsh-wf-fg-tip-copy')?.textContent ?? '').includes('已复制')`, { timeout: 3000 });
  ok(true, '⑪ 点击复制后按钮反馈「✓ 已复制」');

  // ⑫ 离开浮窗 → 延迟后收起
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip').dispatchEvent(new MouseEvent('mouseleave')); true;`);
  await sleep(600);
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`), false, '⑫ 鼠标移出浮窗后收起');

  // ⑨ A 方案容错开关：选中节点 → 面板出现勾选框（且包在 panel-row 里）
  await evaluate(cdp, `window.__df_clickNode(0); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-tolerate-check')`, { timeout: 8000 });
  ok(true, '⑬ 选中节点后面板出现「🛟 失败不影响流程」勾选框');
  eq(await evaluate(cdp, `
    [...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => r.textContent.includes('失败不影响流程') && r.querySelector('.dsh-wf-tolerate-check'))
  `), true, '⑭ 勾选框包在 .dsh-wf-panel-row 里（样式/定位约定）');
  const nodeId = await evaluate(cdp, `window.__df_def.nodes[0].id`);

  // ⑪ 勾选 → def 写 tolerate:true（并存盘链路由既有防抖自动保存负责）
  await evaluate(cdp, `document.querySelector('.dsh-wf-tolerate-check').click(); true;`);
  await waitFor(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.tolerate === true`, { timeout: 5000 });
  ok(true, '⑮ 勾选后 def 写入 tolerate:true');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-tolerate-text')?.textContent ?? '').includes('已开启')`), '⑯ 文案切到「已开启」');

  // ⑬ 再点一次 → 删键（不落 tolerate:false，与 handleNodeChange 的 null 语义一致）
  await evaluate(cdp, `document.querySelector('.dsh-wf-tolerate-check').click(); true;`);
  await waitFor(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.tolerate === undefined`, { timeout: 5000 });
  ok(true, '⑰ 取消勾选后 tolerate 键被删除（不写 tolerate:false）');
}
