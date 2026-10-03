// tmp-test/cdp/test-branch-labels.mjs — 分支条件在画布上显形 + 就地编辑（2026-10-03 需求 B + 方案 C）
// 背景：分支键（def.edges[].when）一直存在，但 FlowGram 化时 toFG() 只传了 sourcePortID，
//       线的 label/stroke 被丢掉 → 用户看不到「这条线走什么条件」。
// 覆盖：
//   B ①连线中点显示 真/假/quick/full 标签；②true 绿 / false 红；③普通线不打扰；④端口标签与端口同高
//   C ⑤无分支键的线 → 琥珀「未设分支」标签 + 问题面板告警；⑥点标签就地改分支键（写回 def.edges）
//   C ⑦switch 新建 case：同时写进节点 params.cases 并指向本线目标
// 夹具：cdp-host.html?branch=1（grab-test 内置的分支工作流，形状=画布保存后的真实产物）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&branch=1`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 4`, { timeout: 20000 });
  await installHelpers(cdp); // 重载后补注入 fetch 记录器（后续断言要用 __df_def）

  // ① 连线标签出现：真/假/quick/full 四个分支键
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length >= 4`, { timeout: 8000 });
  const texts = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-line-label')].map((el) => el.textContent.trim()).sort()`);
  ok(['quick', 'full', '假', '真'].every((k) => texts.includes(k)), '连线上出现 真/假/quick/full（实际：' + JSON.stringify(texts) + '）');

  // ② 配色：真=绿 / 假=红（标签色 + 线条渐变 stop 色）
  ok(await evaluate(cdp, `(() => {
    const t = document.querySelector('.dsh-wf-fg-line-label.is-true');
    const f = document.querySelector('.dsh-wf-fg-line-label.is-false');
    if (!t || !f) return false;
    return getComputedStyle(t).color === 'rgb(16, 185, 129)' && getComputedStyle(f).color === 'rgb(244, 63, 94)';
  })()`), '真=绿、假=红');
  ok(await evaluate(cdp, `(() => {
    const stops = [...document.querySelectorAll('.gedit-flow-activity-edge stop')].map((s) => (s.getAttribute('stop-color') || '').toLowerCase());
    return stops.includes('#10b981') && stops.includes('#f43f5e');
  })()`), '线的渐变描边含绿/红——customLineProps 生效');

  // ③ 普通连线（start→if_1，源节点非 if/switch）不打标签
  ok(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length === 5`), '4 条分支线有标签 + 1 条未设键的警示，普通线不打扰');

  // ⑤ 未设分支键 → 琥珀警示（方案 C 的兜底）
  ok(await evaluate(cdp, `(() => {
    const w = document.querySelector('.dsh-wf-fg-line-label.is-warn');
    return !!w && w.textContent.includes('未设分支') && getComputedStyle(w).cursor === 'pointer';
  })()`), '无分支键的线显示琥珀「未设分支」可点警示');
  await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-fg-tb')].find((x) => (x.textContent || '').includes('问题')); b && b.click(); })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-problems')`, { timeout: 4000 });
  ok(await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-problem')].some((el) => el.textContent.includes('没设分支键'))`), '问题面板列出「这条分支线没设分支键」');
  await evaluate(cdp, `(() => { const c = document.querySelector('.dsh-wf-fg-problems-close'); c && c.click(); })(); true;`);

  // ④ 端口标签：if 保持两个（真/假）+ 与端口同高；switch 改为「端口行删除、只留一行 chips」（2026-10-03 拍板 B）
  const portLabels = await evaluate(cdp, `(() => {
    const card = (kw) => [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.textContent.includes(kw));
    const ifCard = card('条件：有结果？');
    const swCard = card('模式分支');
    const txt = (el) => [...(el?.querySelectorAll('.dsh-wf-fg-branch-label') ?? [])].map((x) => x.textContent.trim());
    return {
      ifs: txt(ifCard), sw: txt(swCard),
      ifTops: [...(ifCard?.querySelectorAll('.dsh-wf-fg-branch-label') ?? [])].map((x) => x.style.top),
      swChips: [...(swCard?.querySelectorAll('.dsh-wf-fg-chip') ?? [])].map((c) => c.textContent.trim()),
      swRows: swCard?.querySelectorAll('.dsh-wf-fg-rou').length ?? -1,
      swH: Math.round(swCard.getBoundingClientRect().height),
    };
  })()`);
  ok(JSON.stringify(portLabels.ifs) === JSON.stringify(['真', '假']), 'if 卡上 真/假 两个端口标签（实际：' + JSON.stringify(portLabels.ifs) + '）');
  ok(JSON.stringify(portLabels.sw) === JSON.stringify([]), 'switch 卡内逐行端口标签已删除（实际：' + JSON.stringify(portLabels.sw) + '）');
  ok(portLabels.swRows === 0, 'switch 卡内行序号也已删除（实际：' + portLabels.swRows + '）');
  ok(JSON.stringify(portLabels.swChips) === JSON.stringify(['quick', 'full', '其他']),
    'switch 卡上 quick/full/其他 三个 chips（实际：' + JSON.stringify(portLabels.swChips) + '）');
  ok(JSON.stringify(portLabels.ifTops) === JSON.stringify(['22px', '52px']), 'if 端口标签与端口同高（22px/52px）');
  ok(portLabels.swH === 91, 'switch 卡高度恒定 91px（普通节点 78px + 一行 chips，不再随分支数增高）实际：' + portLabels.swH);

  // ⑥ 点标签就地改分支键：把 if 的「假」线改成…先点 quick 标签改成一个新 case（⑦ 一并验证）
  await evaluate(cdp, `(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === 'quick');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  ok(true, '点连线标签弹出分支键编辑器');
  ok(await evaluate(cdp, `(() => {
    const p = document.querySelector('.dsh-wf-fg-bedit');
    const keys = [...p.querySelectorAll('.dsh-wf-fg-bedit-key')].map((b) => b.textContent.trim());
    return keys.some((k) => k.includes('quick')) && keys.some((k) => k.includes('full')) && keys.some((k) => k.includes('* 其他'));
  })()`), '编辑器列出该 switch 的已有 case + 其他兜底');

  // ⑦ 新建 case：输入新键 → 回车 → 同时写进 params.cases + 该线 when
  await evaluate(cdp, `(() => {
    const input = document.querySelector('.dsh-wf-fg-bedit-custom input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'turbo');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })(); true;`);
  await waitFor(cdp, `(window.__df_def?.nodes ?? []).some((n) => n.type === 'switch' && n.params && n.params.cases && n.params.cases.turbo === 'log_t')`, { timeout: 5000 });
  ok(true, '新 case 写进了 switch 节点 params.cases（turbo → log_t）');
  ok(await evaluate(cdp, `(window.__df_def?.edges ?? []).some((e) => e.from === 'sw_1' && e.to === 'log_t' && e.when === 'turbo')`), '该线的 when 同步改成了 turbo');
  ok(!(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`)), '应用后编辑器自动关闭');

  // ⑥b 清空分支键：把「假」线清掉 → def 里该线 when 变空 + 画布出现第二条未设分支警示
  await evaluate(cdp, `(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === '假');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-bedit-clear')`, { timeout: 4000 });
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-fg-bedit-clear').click(); })(); true;`);
  await waitFor(cdp, `!(window.__df_def?.edges ?? []).some((e) => e.from === 'if_1' && e.to === 'log_f' && e.when === 'false')`, { timeout: 5000 });
  ok(await evaluate(cdp, `(window.__df_def?.edges ?? []).some((e) => e.from === 'if_1' && e.to === 'log_f' && !e.when)`), '清空后该线在 def 里没有 when（回到恒激活语义）');

  // ⑧ 回归锁（2026-10-03 用户报「switch 在线上改分支键：切不回原 case、切换很慢」）：
  //    根因=改键走整文档重建，FlowGram 对被替换的线回收不完整 → 每改一次多一条幽灵线（带旧分支键），
  //    看着像没切过去，且线越积越多越慢。修后改键走「就地改线」，DOM 线数必须守恒。
  const domLines0 = await evaluate(cdp, `document.querySelectorAll('.gedit-flow-activity-edge').length`);
  const labelMultiset = () => evaluate(cdp, `(() => {
    const m = {};
    for (const el of document.querySelectorAll('.dsh-wf-fg-line-label')) { const t = el.textContent.trim(); m[t] = (m[t] ?? 0) + 1; }
    return m;
  })()`);
  /** 等标签收敛到期望（画布标签更新要经 FlowGram 渲染周期，实测 3-60ms；不能 def 一变就断言） */
  const waitLabels = async (expect, ms = 4000) => {
    const t0 = Date.now();
    for (;;) {
      const m = await labelMultiset();
      if (Object.entries(expect).every(([k, v]) => (v === 0 ? !m[k] : m[k] === v))) return { m, ms: Date.now() - t0 };
      if (Date.now() - t0 > ms) return { m, ms: Date.now() - t0 };
      await sleep(50);
    }
  };
  /** 点某个分支键标签并校验编辑器指向的目标（同文本标签可能多个，靠标题里的 → target 认线） */
  const openEditorFor = async (labelText, targetId) => {
    const n = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-line-label')].filter((x) => x.textContent.trim() === ${JSON.stringify(labelText)}).length`);
    for (let i = 0; i < n; i++) {
      await evaluate(cdp, `(() => {
        const els = [...document.querySelectorAll('.dsh-wf-fg-line-label')].filter((x) => x.textContent.trim() === ${JSON.stringify(labelText)});
        const el = els[${i}];
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
      })(); true;`);
      await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
      const title = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-bedit-node')?.textContent ?? ''`);
      if (title.includes(targetId)) return true;
      await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-fg-bedit-close').click(); })(); true;`);
      await sleep(150);
    }
    return false;
  };
  const pickKey = async (contains) => {
    await evaluate(cdp, `(() => {
      const b = [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].find((x) => x.textContent.includes(${JSON.stringify(contains)}));
      if (!b) throw new Error('找不到候选键');
      b.click();
    })(); true;`);
    await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  };
  // 先把 sw_1 → log_f 那条 full 线切回 quick，让两条 case 线可区分（quick/full 各一条）
  ok(await openEditorFor('full', 'log_f'), '打开 sw_1 → log_f 那条线的编辑器');
  await pickKey('quick');
  await waitFor(cdp, `(window.__df_def?.edges ?? []).some((e) => e.from === 'sw_1' && e.to === 'log_f' && e.when === 'quick')`, { timeout: 5000 });
  // 主路径：把 sw_1 → log_t 的 turbo 线切到已有 case full
  ok(await openEditorFor('turbo', 'log_t'), '打开 sw_1 → log_t 那条线的编辑器（当前 turbo）');
  await pickKey('full');
  await waitFor(cdp, `(window.__df_def?.edges ?? []).some((e) => e.from === 'sw_1' && e.to === 'log_t' && e.when === 'full')`, { timeout: 5000 });
  ok(true, '[回归] 切到已有 case：def 里该线 when=full');
  ok(await evaluate(cdp, `window.__df_lastBranchEdit?.inPlace === true`), '[回归] 改键走「就地改线」路径（不整文档重建）');
  const afterSwitch = await waitLabels({ full: 1, turbo: 0 });
  ok(afterSwitch.m.full === 1 && !afterSwitch.m.turbo, `[回归] 画布标签即时跟着变（turbo → full，${afterSwitch.ms}ms）：` + JSON.stringify(afterSwitch.m));
  ok((await evaluate(cdp, `document.querySelectorAll('.gedit-flow-activity-edge').length`)) === domLines0, '[回归] 改分支键不产生幽灵线（DOM 线数守恒）');
  // 切回原 case
  ok(await openEditorFor('full', 'log_t'), '重新打开该线（标签已变 full）');
  await pickKey('turbo');
  await waitFor(cdp, `(window.__df_def?.edges ?? []).some((e) => e.from === 'sw_1' && e.to === 'log_t' && e.when === 'turbo')`, { timeout: 5000 });
  const backMultiset = await waitLabels({ turbo: 1, full: 0 });
  ok(backMultiset.m.turbo === 1 && !backMultiset.m.full, `[回归] 能切回原 case（${backMultiset.ms}ms 内 turbo 复原）：` + JSON.stringify(backMultiset.m));
  ok((await evaluate(cdp, `document.querySelectorAll('.gedit-flow-activity-edge').length`)) === domLines0, '[回归] 往返切换后 DOM 线数仍守恒');

  await sleep(200);
}
