// tmp-test/cdp/test-schedule-dialog.mjs — ⏰ 定时任务弹窗（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §6）
// 夹具：cdp-host.html?name=<唯一名>&vars=1（6 节点 / 5 条边，用作「画布不受影响」的基线）
// 桩：picker-server.mjs 的 /api/dag-flow/schedules{,/save,/delete,/run} + /__sched-log 诊断口
// 覆盖：①⏰ 按钮 → 弹窗 ②标题/工作流名/黄色费用提示 ③心跳「运行中」 ④空态 ⑤新增默认 0 9 * * *
//   ⑥改 cron 走 1.2s 防抖后才 save + 中文预览 ⑦非法 cron 本地拦截（行内红字 + 预览告警 + 一条请求都不发）
//   ⑧⑨启停开关即时 save ⑩「▶ 立即运行一次」（**应用内**确认弹窗 → meta「✓ 成功（4.1s）」）+ 按钮在 cron 同一行 ⑪删除 ⑫关闭
//   ⑬全程画布节点/边数不变 ⑭变体：不属于当前工作流的定时项被 workflow 过滤掉（**选 A：断言「不显示」**）
// React 受控 input 必须原生 setter + 派发 input 事件（React 18 劫持 value 描述符），见 test-inputs / test-var-refs。
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, eq, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&vars=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(300);

  // —— 页面内小助手：原生 setter 派发 input / 按选择器点选（找不到即抛）/ 读桩日志 ——
  await evaluate(cdp, `(() => {
    window.__sa_setVal = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.__sa_click = (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('找不到元素：' + sel);
      el.click();
      return true;
    };
    window.__sa_log = async () => ((await (await fetch('/__sched-log')).json()).log ?? []);
    return true;
  })()`);
  /** 夹具侧定时请求日志（/__sched-log；按发生顺序） */
  const log = () => evaluate(cdp, `window.__sa_log()`);
  /** 本用例工作流名下的最后一条 save */
  const lastSave = async () => [...(await log())].reverse().find((e) => e.op === 'save' && e.workflow === name) ?? null;

  // ===== 基线：打开弹窗前的画布（断言⑬的对照）=====
  const nodes0 = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-node').length`);
  const edges0 = await evaluate(cdp, `document.querySelectorAll('.gedit-flow-activity-edge').length`);
  ok(nodes0 >= 6, '基线：画布上有 ' + nodes0 + ' 个节点（?vars=1 夹具 6 个）');
  ok(edges0 >= 5, '基线：画布上有 ' + edges0 + ' 条连线（?vars=1 夹具 5 条）');

  // ① ⏰ 按钮 → 弹窗
  ok(await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    if (!b) return false;
    window.__sa_icon = (b.textContent || '').trim();
    b.click();
    return true;
  })()`), '① 头部有 ⏰ 按钮（title 以「定时任务（」开头）');
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker.dsh-wf-sched')`, { timeout: 8000 });
  ok(true, '① 点开后出现弹窗根 .dag-flow-picker.dsh-wf-sched');
  // ★ 2026-10-04：`.dsh-wf-sched { width: min(720px,92vw) }` 此前被运行时注入的 `.dag-flow-picker{width:680px}`
  //   压掉（同权重、注入的更靠后）→ 实测所有弹窗都是 680。修法=把该规则提权成 `.dag-flow-picker.dsh-wf-sched`。
  eq(await evaluate(cdp, `Math.round(document.querySelector('.dag-flow-picker.dsh-wf-sched').getBoundingClientRect().width)`),
    720, '①b 定时弹窗宽度 = 720（宽度规则真的生效了，不再被压成 680）');
  eq(await evaluate(cdp, `window.__sa_icon`), '⏰', '① 按钮文案就是 ⏰');
  // ★ 2026-10-04：底部说明曾写成「cron 为**本机时区**的」→ 纯文本里星号原样显示。锁"弹窗可见文案无 **"。
  const schedText = await evaluate(cdp, `document.querySelector('.dag-flow-picker.dsh-wf-sched').textContent`);
  ok(!schedText.includes('**'), '①c 定时弹窗可见文案里没有 Markdown 星号（此前底部说明带 **）');

  // ② 标题 / 工作流名 / 黄色费用提示
  const head = await evaluate(cdp, `(() => {
    const warn = document.querySelector('.dsh-wf-sched .dsh-wf-sched-warn');
    return {
      title: document.querySelector('.dsh-wf-sched .dag-flow-picker-title')?.textContent ?? '',
      wf: document.querySelector('.dsh-wf-sched .dsh-wf-sched-title-wf')?.textContent ?? '',
      warn: warn?.textContent ?? '',
      warnColor: warn ? getComputedStyle(warn).color : '',
    };
  })()`);
  ok(head.title.includes('⏰ 定时任务'), '② 弹窗标题含「⏰ 定时任务」（实际：' + head.title + '）');
  eq(head.wf, name, '② 标题右侧 .dsh-wf-sched-title-wf 显示当前工作流名');
  ok(head.warn.includes('会产生费用'), '② 费用提示含「会产生费用」（实际：' + head.warn.slice(0, 40) + '…）');
  const rgbw = /rgb\((\d+), (\d+), (\d+)\)/.exec(head.warnColor) ?? [];
  ok(Number(rgbw[1]) > 200 && Number(rgbw[2]) > 140 && Number(rgbw[3]) < 120,
    '② 费用提示是黄色系（实际 color=' + head.warnColor + '）');

  // ③ 调度器心跳
  const beat = await evaluate(cdp, `(() => {
    const el = document.querySelector('.dsh-wf-sched .dsh-wf-sched-beat');
    return { text: el?.textContent ?? '', on: !!el?.classList.contains('is-on') };
  })()`);
  ok(beat.on, '③ 心跳带 is-on 类（= 调度器运行中）');
  ok(beat.text.includes('调度器运行中') && beat.text.includes('心跳'), '③ 心跳文案「● 调度器运行中（心跳 …」（实际：' + beat.text + '）');

  // ④ 空态
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-sched-list')?.textContent || '').includes('还没有定时任务')`),
    '④ 空列表显示「还没有定时任务」');

  // ⑤ ＋ 添加定时 → 1 条（默认 0 9 * * *）
  const addText = await evaluate(cdp, `document.querySelector('.dsh-wf-sched .dsh-wf-inputs-add')?.textContent ?? ''`);
  ok(addText.includes('＋ 添加定时'), '⑤ 底部按钮文案「＋ 添加定时」（实际：' + addText + '）');
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched .dsh-wf-inputs-add')`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-sched-item').length === 1`, { timeout: 8000 });
  const it1 = await evaluate(cdp, `(() => {
    const it = document.querySelector('.dsh-wf-sched-item');
    return {
      cron: it.querySelector('.dsh-wf-sched-cron')?.value ?? '',
      preview: it.querySelector('.dsh-wf-sched-preview')?.textContent ?? '',
      off: it.classList.contains('is-off'),
      checked: !!it.querySelector('.dsh-wf-sched-toggle input[type="checkbox"]')?.checked,
    };
  })()`);
  eq(it1.cron, '0 9 * * *', '⑤ 新增的一条默认 cron = 0 9 * * *');
  ok(it1.preview.includes('09:00'), '⑤ 中文预览含「09:00」（实际：' + it1.preview + '）');
  ok(it1.checked && !it1.off, '⑤ 新条默认启用（勾选、无 is-off）');
  ok((await log()).some((e) => e.op === 'save' && e.workflow === name && e.cron === '0 9 * * *'),
    '⑤ 夹具 log 里有一条 save（cron=0 9 * * *）');

  // ⑥ 改 cron → 1.2s 防抖后才 save；预览变「每 30 分钟」
  await evaluate(cdp, `window.__sa_setVal(document.querySelector('.dsh-wf-sched-cron'), '*/30 * * * *')`);
  await sleep(300);
  ok(!(await log()).some((e) => e.op === 'save' && e.cron === '*/30 * * * *'),
    '⑥ 改完 300ms 还没发 save（1.2s 防抖生效）');
  await waitFor(cdp, `(async () => (await window.__sa_log()).some((e) => e.op === 'save' && e.workflow === ${JSON.stringify(name)} && e.cron === '*/30 * * * *'))()`,
    { timeout: 6000 });
  const after6 = await evaluate(cdp, `(() => ({
    cron: document.querySelector('.dsh-wf-sched-cron')?.value ?? '',
    preview: document.querySelector('.dsh-wf-sched-preview')?.textContent ?? '',
  }))()`);
  ok(after6.preview.includes('每 30 分钟'), '⑥ 防抖保存后预览变成「每 30 分钟」（实际：' + after6.preview + '）');
  eq(after6.cron, '*/30 * * * *', '⑥ 输入框回显 */30 * * * *');
  eq((await lastSave())?.cron, '*/30 * * * *', '⑥ log 里最后一条 save 的 cron = */30 * * * *');

  // ⑦ 非法 cron：本地就拦下（不发请求）+ 行内红字 + 预览告警
  const lenBefore7 = (await log()).length;
  await evaluate(cdp, `window.__sa_setVal(document.querySelector('.dsh-wf-sched-cron'), '99 * * * *')`);
  await sleep(250);
  const bad7 = await evaluate(cdp, `(() => ({
    preview: document.querySelector('.dsh-wf-sched-preview')?.textContent ?? '',
    bad: document.querySelector('.dsh-wf-sched-bad')?.textContent ?? '',
  }))()`);
  ok(bad7.bad.includes('越界') || bad7.bad.includes('不合法'), '⑦ 行内红字 .dsh-wf-sched-bad 含「越界/不合法」（实际：' + bad7.bad + '）');
  eq(bad7.preview, '⚠ 表达式不合法', '⑦ 预览显示「⚠ 表达式不合法」');
  await sleep(1600);
  const log7 = await log();
  ok(!log7.some((e) => e.op === 'save' && e.cron === '99 * * * *'),
    '⑦ 等 1.6s 后 log 里没有任何针对非法值的 save（本地非法 → 客户端根本不发请求）');
  eq(log7.length, lenBefore7, '⑦ 同一窗口内 log 长度不变（没有多余请求）');

  // ⑦b 改回合法值 → 红字消失并重新落盘（证明闸门只挡非法值）
  await evaluate(cdp, `window.__sa_setVal(document.querySelector('.dsh-wf-sched-cron'), '*/30 * * * *')`);
  await waitFor(cdp, `document.querySelector('.dsh-wf-sched-bad') === null`, { timeout: 5000 });
  await waitFor(cdp, `(async () => (await window.__sa_log()).filter((e) => e.op === 'save' && e.cron === '*/30 * * * *').length >= 2)()`,
    { timeout: 6000 });
  ok(true, '⑦b 改回合法值 → 红字消失并重新落盘');

  // ⑧ 取消勾选启用 → is-off + 最后一条 save 的 enabled === false
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched-item .dsh-wf-sched-toggle input[type="checkbox"]')`);
  await waitFor(cdp, `document.querySelector('.dsh-wf-sched-item')?.classList.contains('is-off') === true`, { timeout: 6000 });
  const off8 = await evaluate(cdp, `(() => {
    const it = document.querySelector('.dsh-wf-sched-item');
    return {
      off: it.classList.contains('is-off'),
      toggle: it.querySelector('.dsh-wf-sched-toggle')?.textContent ?? '',
      checked: !!it.querySelector('input[type="checkbox"]')?.checked,
    };
  })()`);
  ok(off8.off, '⑧ 取消勾选后该条加 is-off 类');
  ok(off8.toggle.includes('停用') && !off8.checked, '⑧ 开关文案变「停用」且勾选框已取消（实际：' + off8.toggle + '）');
  await waitFor(cdp, `(async () => { const s = [...(await window.__sa_log())].reverse().find((e) => e.op === 'save' && e.workflow === ${JSON.stringify(name)}); return !!s && s.enabled === false; })()`,
    { timeout: 6000 });
  eq((await lastSave())?.enabled, false, '⑧ log 里最后一条 save 的 enabled === false');

  // ⑨ 再勾回启用 → is-off 消失
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched-item .dsh-wf-sched-toggle input[type="checkbox"]')`);
  await waitFor(cdp, `document.querySelector('.dsh-wf-sched-item')?.classList.contains('is-off') === false`, { timeout: 6000 });
  ok(true, '⑨ 再勾回启用 → is-off 消失');
  await waitFor(cdp, `(async () => { const s = [...(await window.__sa_log())].reverse().find((e) => e.op === 'save' && e.workflow === ${JSON.stringify(name)}); return !!s && s.enabled === true; })()`,
    { timeout: 6000 });
  eq((await lastSave())?.enabled, true, '⑨ log 里最后一条 save 的 enabled === true');

  // ⑩ ▶ 立即运行一次 —— 2026-10-04 用户反馈两条：
  //    (a) 二次确认原来是 window.confirm（Windows 原生弹窗）→ 改成**应用内**确认弹窗；
  //    (b) 按钮不要单独占第二行 → 挪到 cron 表达式右边（同一行）。
  await evaluate(cdp, `(() => { window.__sa_confirm = 0; window.confirm = () => { window.__sa_confirm++; return true; }; return true; })()`);
  const runBtn = await evaluate(cdp, `(() => {
    const b = document.querySelector('.dsh-wf-sched-run');
    return { title: b?.title ?? '', text: (b?.textContent ?? '').trim(), cls: b?.className ?? '' };
  })()`);
  ok(runBtn.title.startsWith('立刻真实执行一次'), '⑩ 运行按钮 title 以「立刻真实执行一次」开头（实际：' + runBtn.title + '）');
  ok(runBtn.text.includes('▶ 立即运行一次'), '⑩ 按钮文案「▶ 立即运行一次」（实际：' + runBtn.text + '）');

  // (b) 布局：按钮与 cron 输入框在**同一行**（垂直重叠 + 按钮在输入框右侧），且第二行不再有按钮
  const geo = await evaluate(cdp, `(() => {
    const row = document.querySelector('.dsh-wf-sched-row');
    const inp = row?.querySelector('.dsh-wf-sched-cron');
    const btn = row?.querySelector('.dsh-wf-sched-run');
    if (!inp || !btn) return { inRow: false };
    const a = inp.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { inRow: true, leftOf: b.left >= a.right - 1, overlapY: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), actionsRow: !!document.querySelector('.dsh-wf-sched-actions') };
  })()`);
  ok(geo.inRow, '⑩b ★按钮就在 cron 那一行里（.dsh-wf-sched-row 内）');
  ok(geo.leftOf, '⑩c ★按钮在 cron 输入框的右边');
  ok(geo.overlapY > 0, `⑩d 与输入框垂直重叠 = 同一行（overlap=${Math.round(geo.overlapY || 0)}px）`);
  ok(geo.actionsRow === false, '⑩e 旧的第二行操作区（.dsh-wf-sched-actions）已移除');

  // (a) 点按钮 → 弹**应用内**确认弹窗（不是原生 confirm），且此时还没发运行请求
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched-run')`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-sched-confirm')`, { timeout: 6000 });
  ok(true, '⑩f 点按钮后出现应用内确认弹窗');
  eq(await evaluate(cdp, `Math.round(document.querySelector('.dsh-wf-sched-confirm').getBoundingClientRect().width)`),
    460, '⑩f2 确认弹窗宽度 = 460（小确认框的宽度规则生效）');
  eq(await evaluate(cdp, `window.__sa_confirm`), 0, '⑩g ★没有调用 window.confirm（原生弹窗已废弃）');
  const ctext = await evaluate(cdp, `document.querySelector('.dsh-wf-sched-confirm')?.textContent ?? ''`);
  ok(ctext.includes('费用'), '⑩h 确认弹窗写明会产生费用');
  ok(ctext.includes('不等人确认'), '⑩i 确认弹窗写明执行期间不等人确认');
  ok(ctext.includes('不会改变定时档期'), '⑩j 确认弹窗说明不影响定时档期');
  eq((await log()).some((e) => e.op === 'run'), false, '⑩k 弹窗出现时**还没有**发出运行请求（确认前不执行）');

  // 先点「✕ 取消」→ 弹窗关闭且不运行（负向断言）
  await evaluate(cdp, `
    (() => {
      const b = [...document.querySelectorAll('.dsh-wf-sched-confirm button')].find((x) => (x.textContent || '').includes('取消'));
      b?.click(); return true;
    })(); true;
  `);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-sched-confirm')`, { timeout: 5000 });
  eq((await log()).some((e) => e.op === 'run'), false, '⑩l 取消后仍无运行请求（安全）');

  // 再来一次，这次点「▶ 确认运行」→ 真发请求
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched-run')`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-sched-confirm')`, { timeout: 6000 });
  await evaluate(cdp, `
    (() => {
      const b = [...document.querySelectorAll('.dsh-wf-sched-confirm button')].find((x) => (x.textContent || '').includes('确认运行'));
      b?.click(); return true;
    })(); true;
  `);
  await waitFor(cdp, `(async () => (await window.__sa_log()).some((e) => e.op === 'run' && e.id))()`, { timeout: 8000 });
  const log10 = await log();
  ok(log10.some((e) => e.op === 'run' && typeof e.id === 'string' && e.id.startsWith('sch_')),
    '⑩ 夹具 log 里有 run 请求（带 sch_ id）');
  await waitFor(cdp, `!document.querySelector('.dsh-wf-sched-confirm')`, { timeout: 5000 });
  ok(true, '⑩m 确认后弹窗自动关闭');
  await waitFor(cdp, `(document.querySelector('.dsh-wf-sched-meta')?.textContent || '').includes('✓ 成功')`, { timeout: 8000 });
  const meta10 = await evaluate(cdp, `document.querySelector('.dsh-wf-sched-meta')?.textContent ?? ''`);
  ok(meta10.includes('✓ 成功') && meta10.includes('4.1s'), '⑩ meta 显示「上次 ✓ 成功（4.1s）」（实际：' + meta10 + '）');
  ok(meta10.includes('下次'), '⑩ meta 同时带「下次 …」（实际：' + meta10 + '）');

  // ⑪ 行尾 ✕ 删除 → 该条消失 + log 有 delete
  const delTitle = await evaluate(cdp, `document.querySelector('.dsh-wf-sched-item button[title^="删除该定时"]')?.title ?? ''`);
  ok(delTitle.includes('不影响其它定时'), '⑪ 行尾 ✕ 的 title 说明只删该条（实际：' + delTitle + '）');
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched-item button[title^="删除该定时"]')`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-sched-item').length === 0`, { timeout: 8000 });
  ok(true, '⑪ 删除后该条从列表消失');
  const lastDel = [...(await log())].reverse().find((e) => e.op === 'delete');
  ok(!!lastDel && typeof lastDel.id === 'string' && lastDel.id.startsWith('sch_'), '⑪ 夹具 log 里有 delete（id=' + (lastDel?.id ?? '') + '）');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-sched-list')?.textContent || '').includes('还没有定时任务')`),
    '⑪ 删空后回到空态文案');

  // ⑫ 右上角 ✕ 关闭
  await evaluate(cdp, `window.__sa_click('.dsh-wf-sched .dag-flow-picker-close')`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-sched')`, { timeout: 6000 });
  ok(true, '⑫ 关掉弹窗后 .dsh-wf-sched 不存在');

  // ⑬ 整个过程画布不受影响
  eq(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-node').length`), nodes0, '⑬ 全程结束后节点数与打开弹窗前一致');
  eq(await evaluate(cdp, `document.querySelectorAll('.gedit-flow-activity-edge').length`), edges0, '⑬ 边数与打开弹窗前一致');

  // ⑭ 变体（选 A：按 workflow 过滤）：造一条指向「不存在的工作流」的定时项 → 打开当前工作流的弹窗
  //     → 它必须**不被显示**；同时按它自己的 workflow 反查，证明桩里确实存着（差异只来自过滤）。
  const orphanWf = `${name}-不存在的流程`;
  eq(await evaluate(cdp, `(async () => (await fetch('/api/dag-flow/schedules/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflow: ${JSON.stringify(orphanWf)}, cron: '0 8 * * *', enabled: true }),
  })).status)()`), 200, '⑭ 用 save 桩预置一条指向不存在工作流的定时项（HTTP 200）');
  const orphan = await evaluate(cdp, `(async () => {
    const d = await (await fetch('/api/dag-flow/schedules?workflow=' + encodeURIComponent(${JSON.stringify(orphanWf)}))).json();
    return { n: (d.items ?? []).length, cron: (d.items ?? [])[0]?.cron ?? '' };
  })()`);
  ok(orphan.n === 1 && orphan.cron === '0 8 * * *', '⑭ 桩里确实存了这条孤儿定时（按它自己的 workflow 能查到，实际 ' + JSON.stringify(orphan) + '）');
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    b.click();
    return true;
  })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-sched')`, { timeout: 8000 });
  await sleep(400);
  eq(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-sched-item').length`), 0, '⑭ 不属于当前工作流的定时项不显示（列表 0 条）');
  ok(await evaluate(cdp, `(document.querySelector('.dsh-wf-sched-list')?.textContent || '').includes('还没有定时任务')`),
    '⑭ 当前工作流仍是空态（只有孤儿项存在）');
  ok(await evaluate(cdp, `![...document.querySelectorAll('.dsh-wf-sched-cron')].some((i) => i.value === '0 8 * * *')`),
    '⑭ 面板里没有 0 8 * * * 这条（workflow 过滤生效）');
}
