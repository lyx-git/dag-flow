// tmp-test/cdp/test-node-result-tip.mjs — ①节点「最终执行结果」悬浮卡（2026-10-03 用户需求：
// 「每个节点执行完最好有个最终执行结果可以在节点上看，无论失败还是成功，方便定位，可以是悬浮查看」）
// ②A 方案「失败不影响流程」勾选框（面板 → def 写入/删除）。
//
// 关键实现约定（断言依赖它，改实现前先看这里）：
//   · 悬浮卡 Portal 到 document.body + position:fixed（画布容器带 transform，留在卡内会被缩放/裁切）
//   · 用**原生** mouseenter/mouseleave 监听（节点层 stopPropagation 掉委托事件，React 的
//     onMouseEnter（由 mouseover 合成）在卡内收不到——与 chips 同坑位）；所以这里直接
//     dispatchEvent(new MouseEvent('mouseenter')) 即可命中。
import { confirmSelfcheck } from './driver.mjs';
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
  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认
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

  // ⑨ 失败策略：选中节点 → 面板出现**唯一的**「本节点失败后」下拉（2026-10-04 轮 2 合并了两个旧入口）
  await evaluate(cdp, `window.__df_clickNode(0); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-failpolicy')`, { timeout: 8000 });
  ok(true, '⑬ 选中节点后面板出现「🛟 本节点失败后」下拉');
  eq(await evaluate(cdp, `
    [...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => r.textContent.includes('本节点失败后') && r.querySelector('.dsh-wf-failpolicy'))
  `), true, '⑭ 下拉包在 .dsh-wf-panel-row 里（样式/定位约定）');
  eq(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-failpolicy').length`), 1, '⑭b 面板上只有**一个**失败策略入口（旧的「失败不影响流程」勾选框已合并进来）');
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-tolerate-check')`), false, '⑭c 旧的 tolerate 勾选框已不存在（避免歧义）');
  eq(await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-failpolicy option')].map((o) => o.value).join(',')`), 'stop,skip,ignore,goto',
    '⑭d 四个选项：停止这条支路 / 跳过这条支路不算失败 / 忽略失败继续下游 / 失败后跳转');
  const nodeId = await evaluate(cdp, `window.__df_def.nodes[0].id`);

  // 选「🛟 忽略失败，下游照常执行」→ def 写 tolerate:true，且**清掉 onError**（两字段互斥）
  await evaluate(cdp, `
    (() => {
      const sel = document.querySelector('.dsh-wf-failpolicy');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
      desc.set.call(sel, 'ignore');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.tolerate === true`, { timeout: 5000 });
  ok(true, '⑮ 选「忽略失败」后 def 写入 tolerate:true');
  // ★ 2026-10-04 轮 7「fail 策略显形」：策略必须同时出现在**画布卡片**上（此前只在右侧面板里）
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-failchip.is-ignore')`, { timeout: 5000 });
  ok(true, '⑮b 卡片上出现「🛟 忽略失败」chip（绿，策略显形）');
  ok(await evaluate(cdp, `!('onError' in window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)}))`), '⑯ 同时清掉 onError（互斥，不留两个字段打架）');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-failpolicy-hint')?.textContent ?? '').includes('忽略失败') || (document.querySelector('.dsh-wf-failpolicy-hint')?.textContent ?? '').includes('照常执行')`),
    '⑯b 下方提示随选项切换（说明这一档的确切语义）');

  // 选回「⛔ 停止这条支路」→ 删 tolerate、写 onError:'stop'
  await evaluate(cdp, `
    (() => {
      const sel = document.querySelector('.dsh-wf-failpolicy');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
      desc.set.call(sel, 'stop');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.tolerate === undefined`, { timeout: 5000 });
  ok(true, '⑰ 切回「停止这条支路」后 tolerate 键被删除（不写 tolerate:false）');
  eq(await evaluate(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.onError`), 'stop', '⑰b 并写入 onError:"stop"');
  eq(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-failchip')`), false, '⑰c 切回默认「停止这条支路」后画布 chip 消失（默认策略不制造噪音）');

  // 选「⏭ 跳过这条支路，不算运行失败」→ 写 onError:'continue'（旧字段，语义见引擎 policyOf）
  await evaluate(cdp, `
    (() => {
      const sel = document.querySelector('.dsh-wf-failpolicy');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
      desc.set.call(sel, 'skip');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.onError === 'continue'`, { timeout: 5000 });
  ok(true, '⑱ 选「跳过这条支路」写入 onError:"continue"（零数据迁移：旧字段继续承载新语义）');
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-failchip.is-skip')`, { timeout: 5000 });
  ok(true, '⑱b 卡片 chip 切到「⏭ 跳过支路」（青）');

  // ★ 轮 3：第 4 个选项「↪ 失败后跳转到指定节点」可选，且选中后出现「跳转目标」行
  await evaluate(cdp, `
    (() => {
      const sel = document.querySelector('.dsh-wf-failpolicy');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value');
      desc.set.call(sel, 'goto');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })(); true;
  `);
  await waitFor(cdp, `typeof window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.onError === 'object'`, { timeout: 5000 });
  const gotoVal = await evaluate(cdp, `window.__df_def.nodes.find((n) => n.id === ${JSON.stringify(nodeId)})?.onError?.goto ?? ''`);
  ok(typeof gotoVal === 'string' && gotoVal.length > 0, `⑲ 选「失败后跳转」写入 onError:{goto:"${gotoVal}"}`);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => r.textContent.includes('跳转目标'))`, { timeout: 5000 });
  ok(true, '⑳ 「↪ 跳转目标」行出现（选中 goto 才出现）');
  const gotoOpts = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].filter((r) => r.textContent.includes('跳转目标')).map((r) => [...r.querySelectorAll('option')].map((o) => o.textContent))[0] ?? []`);
  ok(Array.isArray(gotoOpts) && gotoOpts.length > 0, `㉑ 目标下拉有候选（${gotoOpts.length} 个；上游候选会带"⚠ 在本节点之前执行，跳转不会生效"标注）`);
  ok((await evaluate(cdp, `(document.querySelector('.dsh-wf-failpolicy-hint')?.textContent ?? '').includes('只执行一次')`)), '㉒ goto 的提示写明「目标只执行一次」');
}
