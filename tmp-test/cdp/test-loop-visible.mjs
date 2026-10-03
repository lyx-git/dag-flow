// tmp-test/cdp/test-loop-visible.mjs — loop 循环可见化（P1+P2+P3，2026-10-03 用户拍板）
// 背景：loop 在画布上「存在感缺失」——卡片副标题只认 count（配 over/while 显示错的 count=?）、
//       出边与普通线无差别、参数只能去 JSON 视图改。
// 覆盖：P1 副标题按实际生效边界（引擎优先级 over > count > while）+ 无边界问题面板 error；
//       P2 右侧「🔁 循环设置」区（类型下拉/数值回显/切换清旧边界/改值副标题同步）；
//       P3 loop 出边紫色「循环」标 + 运行后徽标「· 循环 N 次」。
// 夹具：cdp-host.html?loop=1（四个不同边界的 loop + 四条出边，形状=画布保存后的真实产物）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&loop=1`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await installHelpers(cdp);

  // —— P1 副标题按实际生效边界显示 ——
  const subs = await evaluate(cdp, `(() => {
    const card = (kw) => [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(kw));
    const sub = (kw) => (card(kw)?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '').trim();
    return { count: sub('循环：固定次数'), over: sub('循环：遍历数组'), w: sub('循环：条件'), none: sub('循环：无边界') };
  })()`);
  ok(subs.count === '循环 3 次 · 上限 100', 'count 边界 → 「循环 3 次 · 上限 100」（实际：' + subs.count + '）');
  ok(subs.over === '遍历 {{web_search1.out.results}} · 上限 50', 'over 边界 → 显示上游引用（实际：' + subs.over + '）');
  ok(subs.w === 'while: true', 'while 边界 → 「while: true」（实际：' + subs.w + '）');
  ok(subs.none === '⚠ 无循环边界', '无边界 → 「⚠ 无循环边界」（实际：' + subs.none + '）');

  // —— P1 问题面板：无边界 loop 记为 error ——
  await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-fg-tb')].find((x) => (x.textContent || '').includes('问题')); b && b.click(); })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-problems')`, { timeout: 4000 });
  ok(await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-problem.error')].some((el) => el.textContent.includes('循环边界缺失'))`), '问题面板把「循环边界缺失」列为 error（运行必 LOOP_NO_BOUND）');
  await evaluate(cdp, `(() => { const c = document.querySelector('.dsh-wf-fg-problems-close'); c && c.click(); })(); true;`);

  // —— P3 连线循环标记：4 条 loop 出边都挂紫色「循环」 ——
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-line-label.is-loop').length >= 4`, { timeout: 8000 });
  ok(await evaluate(cdp, `(() => {
    const l = document.querySelector('.dsh-wf-fg-line-label.is-loop');
    return l.textContent.trim() === '循环' && getComputedStyle(l).color === 'rgb(167, 139, 250)' && getComputedStyle(l).cursor === 'default';
  })()`), 'loop 出边中点挂紫色「循环」标（不可点，与分支标签互不干扰）');
  ok(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length === 4`), '这组夹具里恰好 4 个线标且全是循环标（分支标签逻辑未被污染）');

  // —— P2 右侧「🔁 循环设置」：选中 loop_count ——
  await evaluate(cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('循环：固定次数'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.textContent || '').includes('🔁 循环设置'))`, { timeout: 5000 });
  const panel0 = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    // 行里有两个 number input：第一个=count 值、最后一个=maxIterations（顺序即控件顺序）
    const nums = [...(row?.querySelectorAll('input[type=number]') ?? [])];
    return { bound: row?.querySelector('select')?.value ?? '(无)', count: nums[0]?.value ?? '(无)', maxIter: nums[nums.length - 1]?.value ?? '(无)' };
  })()`);
  ok(panel0.bound === 'count', '边界类型下拉自动识别为 count（实际：' + panel0.bound + '）');
  ok(panel0.count === '3', 'count 值回显 3（实际：' + panel0.count + '）');
  ok(panel0.maxIter === '100', '最大迭代次数回显 100（实际：' + panel0.maxIter + '）');

  // 切换成 over：写入 over、**清掉 count**（不能留下 "count": null 脏数据）
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    const sel = row.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'over');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })(); true;`);
  await waitFor(cdp, `(() => { const p = window.__df_def?.nodes?.find((n) => n.id === 'loop_count')?.params ?? {}; return 'over' in p && !('count' in p); })()`, { timeout: 5000 });
  ok(true, '切到 over：def 里 count 键已删除、over 键已写入（null 语义 = 删除键，不留脏数据）');

  // 改 over 的值 → 副标题跟着变（数据面 + 视觉面双锁）
  // ★ 先等 over 输入框渲染出来：def 变更（waitFor 通过）领先于 React 提交 DOM（老教训：操作前等收敛）
  await waitFor(cdp, `(() => {
    const r = [...document.querySelectorAll('.dsh-wf-panel-row')].find((x) => (x.textContent || '').includes('🔁 循环设置'));
    return !!r?.querySelector('input:not([type])');
  })()`, { timeout: 5000 });
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    const inp = row.querySelector('input:not([type])');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '{{my_list.out.items}}');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  })(); true;`);
  await waitFor(cdp, `(window.__df_def?.nodes?.find((n) => n.id === 'loop_count')?.params?.over ?? '') === '{{my_list.out.items}}'`, { timeout: 5000 });
  await waitFor(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('循环：固定次数'));
    return (c?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '').includes('遍历 {{my_list.out.items}}');
  })()`, { timeout: 5000 });
  ok(true, '改 over 值后卡片副标题同步为「遍历 {{my_list.out.items}}」（数据面 + 视觉面双证）');

  // —— 循环体子工作流选择器（方案 A，2026-10-03 用户拍板）——
  //    ★ 判别词用「迭代序列」：边界类型下拉里也有"不设"（⚠ 不设边界），用"不设"会选错下拉
  await waitFor(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    return !!(row && [...row.querySelectorAll('select')].some((s) => [...s.options].some((o) => (o.textContent || '').includes('迭代序列'))));
  })()`, { timeout: 8000 });
  const bodySel = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    const sel = [...row.querySelectorAll('select')].find((s) => [...s.options].some((o) => (o.textContent || '').includes('迭代序列')));
    return { value: sel.value, optionCount: sel.options.length, opts: [...sel.options].map((o) => o.textContent).slice(0, 4) };
  })()`);
  ok(bodySel.optionCount >= 2, '面板「循环体（可选）」下拉列出了可选子工作流（选项数 ' + bodySel.optionCount + '，前几项：' + JSON.stringify(bodySel.opts) + '）');
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    const sel = [...row.querySelectorAll('select')].find((s) => [...s.options].some((o) => (o.textContent || '').includes('迭代序列')));
    const pick = [...sel.options].map((o) => o.value).filter(Boolean)[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, pick);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })(); true;`);
  await waitFor(cdp, `!!(window.__df_def?.nodes?.find((n) => n.id === 'loop_count')?.params?.body?.workflowName)`, { timeout: 5000 });
  ok(true, '选一个子工作流 → def 写入 params.body.workflowName（面板与引擎同一份数据）');
  ok(await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('🔁 循环设置'));
    return (row?.textContent || '').includes('loopItem');
  })()`), '选中后出现输入映射与 {{vars.loopItem}} 用法提示');

  // —— P3 运行后徽标「· 循环 N 次」（用 fixture 的 /run stub：返回 loop 节点 out.count=7）——
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(cdp, `(window.__df_reqs ?? []).some((r) => r.includes('/api/dag-flow/run'))`, { timeout: 8000 });
  await waitFor(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('循环：固定次数'));
    const b = c?.querySelector('.dsh-wf-fg-badge');
    return !!b && b.textContent.includes('循环 7 次');
  })()`, { timeout: 15000 });
  ok(await evaluate(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('循环：固定次数'));
    const b = c.querySelector('.dsh-wf-fg-badge');
    return b.classList.contains('is-loop') && getComputedStyle(b).color === 'rgb(196, 181, 253)';
  })()`), '运行后徽标追加「· 循环 7 次」并用紫色区分（取自 out.count）');
  await sleep(50);
}
