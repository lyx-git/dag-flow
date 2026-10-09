// tmp-test/cdp/test-run-log.mjs — 🧾 运行日志弹窗（2026-10-04 用户需求）
//   用户原话：「现在每个节点的执行情况没有日志打印，参数传递是否正常，下个节点接收参数是否正常
//             都没有日志可以看到，无法判断流程中间执行日志情况，节点之间的交互情况也没有，工作流执行黑盒」。
// 契约（本用例钉死）：
//   ① 头部有 🧾 按钮；点开弹「🧾 运行日志」，标题/头部说明写清工作流名与节点数
//   ② 每个节点一条：节点 id + 类型 + 状态 + 耗时；展开后能看到「原始参数（含 {{}}）→ 实际入参（已展开）→ 出参」
//   ③ 记着「引用上游」= 节点之间的交互
//   ④ 搜索框能过滤；📋 复制全部 / 复制本节点可用（headless 里把 clipboard 换成桩）
//   ⑤ 没跑过的工作流 → 弹窗给出「暂无日志」而不是空白/报错
import { confirmSelfcheck, goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, eq, sleep, name, base }) {
  // headless 里 clipboard 常被拒 → 换成功桩（真机不受影响）
  await evaluate(cdp, `(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } } });
    return true;
  })()`);

  // ===== A. 没跑过 → 弹窗提示"暂无日志" =====
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-log-btn')`, { timeout: 15000 });
  ok(true, '① 头部有 🧾 运行日志按钮');
  // ★ 位置锁定（2026-10-04 用户要求：「运行日志按钮现在在底部，放到定时任务的后面」）：
  //   必须在**头部那一排**里、且紧跟在 ⏰（定时任务）后面
  const place = await evaluate(cdp, `(() => {
    const btn = document.querySelector('.dsh-wf-log-btn');
    const header = document.querySelector('.dsh-wf-header');
    const prev = btn?.previousElementSibling;
    return {
      inHeader: !!(header && btn && header.contains(btn)),
      prevIsSched: !!prev && /定时任务/.test(prev.getAttribute('title') ?? ''),
      prevText: prev?.textContent ?? '',
      headerChildren: [...(header?.children ?? [])].map((c) => c.textContent.trim()).slice(0, 12),
    };
  })()`);
  ok(place.inHeader, '①c ★日志按钮在**头部**里（不再落在页面底部/弹窗区）');
  ok(place.prevIsSched && place.prevText.includes('⏰'),
    `①d ★它在定时任务 ⏰ 的**后面**（前一个兄弟=${JSON.stringify(place.prevText)}；头部顺序=${JSON.stringify(place.headerChildren)}）`);
  // 顺带锁一条「取景 C」的反面：**小图**（本夹具 2~3 个节点）入口本来就可见 → 不许做多余平移
  //（大图的正面用例在 view-controls ①e）
  const iv = await evaluate(cdp, `window.__df_initialView ?? null`);
  ok(iv?.ensure?.shifted === false, `①b 小图不做多余取景（ensure=${JSON.stringify(iv?.ensure)}）`);
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-log-btn').click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-logdlg')`, { timeout: 8000 });
  // 等首次拉取结果落到界面（打开瞬间还是初始态，直接断言会读到未完成的文案）
  await waitFor(cdp, `(() => { const h = document.querySelector('.dsh-wf-logdlg .dag-flow-picker-hint')?.textContent ?? ''; return h.includes('日志读取失败') || h.includes('暂无日志'); })()`, { timeout: 8000 });
  const empty = await evaluate(cdp, `(() => {
    const d = document.querySelector('.dsh-wf-logdlg');
    return { title: d.querySelector('.dag-flow-picker-title')?.textContent ?? '', hint: d.querySelector('.dag-flow-picker-hint')?.textContent ?? '' };
  })()`);
  ok(empty.title.includes('运行日志'), '② 弹窗标题「🧾 运行日志」（实际：' + empty.title + '）');
  ok(empty.hint.includes('暂无日志') || empty.hint.includes('日志读取失败'), '③ 没跑过时给明确提示（实际：' + empty.hint.slice(0, 60) + '）');
  // ★ 2026-10-04：日志弹窗的宽度规则同样曾被运行时注入的 `.dag-flow-picker{width:680px}` 压掉 → 实测 680。
  eq(await evaluate(cdp, `Math.round(document.querySelector('.dsh-wf-logdlg').getBoundingClientRect().width)`),
    920, '③b 日志弹窗宽度 = 920（大表格用的宽度真的生效了）');
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-logdlg .dag-flow-picker-close').click(); return true; })()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-logdlg')`, { timeout: 5000 });

  // ===== B. 跑一次 → 日志有内容 =====
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await confirmSelfcheck(cdp);
  await waitFor(cdp, `(document.body.textContent || '').includes('运行成功')`, { timeout: 12000 });
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-log-btn').click(); return true; })()`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-log-item').length >= 2`, { timeout: 8000 });
  const list = await evaluate(cdp, `(() => {
    const items = [...document.querySelectorAll('.dsh-wf-log-item')];
    const first = items[0];
    return {
      n: items.length,
      head: first.querySelector('.dsh-wf-log-head')?.textContent ?? '',
      hint: document.querySelector('.dsh-wf-logdlg .dag-flow-picker-hint')?.textContent ?? '',
      hasSearch: !!document.querySelector('.dsh-wf-log-search'),
    };
  })()`);
  ok(list.n >= 2, `④ 每个节点一条日志（实际 ${list.n} 条）`);
  ok(list.hint.includes('节点'), '⑤ 头部说明写清工作流/状态/节点数（实际：' + list.hint.slice(0, 70) + '）');
  ok(/成功|失败|跳过/.test(list.head), '⑥ 每条显示状态（实际：' + list.head.trim().slice(0, 60) + '）');
  ok(list.hasSearch, '⑦ 有搜索框');

  // ===== C. 展开一条 → 看到「原始参数 → 实际入参 → 出参」+ 引用上游 =====
  await evaluate(cdp, `(() => { document.querySelectorAll('.dsh-wf-log-item .dsh-wf-log-head')[0].click(); return true; })()`);
  await sleep(200);
  const detail = await evaluate(cdp, `(() => {
    const it = document.querySelectorAll('.dsh-wf-log-item')[0];
    return {
      secs: [...it.querySelectorAll('.dsh-wf-log-sec-title')].map((x) => x.textContent.trim()),
      pres: [...it.querySelectorAll('.dsh-wf-log-pre')].map((x) => x.textContent),
      refs: it.querySelector('.dsh-wf-log-refs')?.textContent ?? '',
    };
  })()`);
  ok(detail.secs.some((s) => s.includes('原始参数')), '⑧ 展开后有「原始参数（含 {{}} 模板引用）」（实际：' + JSON.stringify(detail.secs) + '）');
  ok(detail.secs.some((s) => s.includes('实际入参')), '⑨ 有「实际入参（模板已展开）」');
  ok(detail.pres.some((p) => p.includes('{{start.out}}')), '⑩ ★原始参数里保留 {{}} 模板引用（能对照"引用→实际值"）');
  // 注意：对象参数在弹窗里是 JSON 渲染（引号会被转义），所以按子串而不是精确文本断言
  ok(detail.pres.some((p) => p.includes('print') && p.includes('ok')), '⑪ ★实际入参是展开后的值（节点真正收到的）');
  ok(detail.refs.includes('引用上游'), '⑫ ★记录「引用上游」= 节点之间的交互（实际：' + detail.refs.slice(0, 40) + '）');

  // ===== D. 复制（clipboard 桩）=====
  await evaluate(cdp, `(() => {
    const btns = [...document.querySelectorAll('.dsh-wf-log-item')[0].querySelectorAll('button')];
    btns.find((b) => b.textContent.includes('复制本节点')).click();
    return true;
  })()`);
  await sleep(200);
  const copied = await evaluate(cdp, `window.__copied ?? []`);
  ok(copied.length === 1 && copied[0].includes('原始参数（含模板引用）') && copied[0].includes('实际入参（模板已展开）'),
    '⑬ 「复制本节点」把原始/实际参数一起复制（实际长度 ' + String(copied[0] ?? '').length + '）');

  // ===== E. 搜索过滤 =====
  const total = list.n;
  await evaluate(cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-log-search');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
    desc.set.call(inp, '肯定搜不到的关键词zzz');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
  const filtered = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-log-item').length`);
  eq(filtered, 0, `⑭ 搜索框能过滤（${total} 条 → 0 条）`);

  // ===== F. 只看失败/跳过（2026-10-04 便利性）=====
  await evaluate(cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-log-search');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
    desc.set.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
  const beforeScope = await evaluate(cdp, `document.querySelectorAll('.dsh-wf-log-item').length`);
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-log-toolbar button')].find((b) => b.textContent.includes('只看失败')).click(); return true; })()`);
  await sleep(300);
  const scope = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-log-item')].map((el) => el.querySelector('.dsh-wf-log-status')?.textContent ?? '')`);
  ok(scope.length >= 1 && scope.every((s) => s.includes('失败') || s.includes('跳过')),
    `⑮ ★「只看失败/跳过」只留问题节点（${beforeScope} 条 → ${scope.length} 条：${JSON.stringify(scope)}）`);

  // ===== G. 失败项默认展开 + AI 调用详情 =====
  const dbg = await evaluate(cdp, `(() => {
    const it = document.querySelector('.dsh-wf-log-item');
    return {
      expanded: !!it?.querySelector('.dsh-wf-log-detail'),
      aiText: it?.querySelector('.dsh-wf-log-aidebug')?.textContent ?? '',
    };
  })()`);
  ok(dbg.expanded, '⑯ ★失败条目**默认展开**（不用手点就能看到原因）');
  ok(dbg.aiText.includes('tokens 入') && dbg.aiText.includes('Stub 模型'),
    `⑰ ★展开里有「AI 调用详情」（模型 + token 用量）（实际：${dbg.aiText.slice(0, 80)}）`);
  ok(dbg.aiText.includes('max-tokens') && dbg.aiText.includes('截断'),
    '⑰b ★撞 maxTokens 时显式提醒"输出被截断"（AI 调试最关键的一条）');

  // ===== H. 点日志条目 → 画布选中该节点 =====
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-log-item .dsh-wf-log-head').click(); return true; })()`);
  await sleep(400);
  const sel = await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`);
  ok(sel, '⑱ ★点日志条目 → 画布上选中了该节点（看完日志能立刻回画布定位）');

  // ===== I. 🧪 试跑带 AI 调试信息（与日志同一份采集口径）=====
  //   注意：默认夹具只有 start/end 两个节点，而 start/end 的试跑按钮是**禁用**的 →
  //   这里切到有中间节点的夹具（?chips=1），选一个真实节点再试跑
  await evaluate(cdp, `(() => { const c = document.querySelector('.dsh-wf-logdlg .dag-flow-picker-close'); if (c) c.click(); return true; })()`);
  await sleep(300);
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}tr&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });
  // 选中第一个**非 start/end** 的节点（__df_clickNode 是夹具的节点点选钩子）
  const picked = await evaluate(cdp, `(() => {
    const ids = (window.__df_def?.nodes ?? []).map((n) => n.id);
    const i = ids.findIndex((id) => id !== 'start' && !String(id).startsWith('end'));
    if (i < 0) return null;
    window.__df_clickNode?.(i);
    return ids[i];
  })()`);
  ok(!!picked, `⑲0 选中了一个可试跑的节点（${picked}）`);
  await sleep(400);
  const tr0 = await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-panel-row button')].find((x) => x.textContent.includes('试跑本节点'));
    return { exists: !!b, disabled: b?.disabled ?? null, text: b?.textContent ?? '' };
  })()`);
  ok(tr0.exists && tr0.disabled === false, `⑲0b 试跑按钮存在且可用（${JSON.stringify(tr0)}）`);
  await evaluate(cdp, `(() => { const b = [...document.querySelectorAll('.dsh-wf-panel-row button')].find((x) => x.textContent.includes('试跑本节点')); if (b) b.click(); return !!b; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-test-debug')`, { timeout: 8000 });
  const tr = await evaluate(cdp, `(() => {
    const d = document.querySelector('.dsh-wf-test-debug');
    return { head: d.querySelector('.dsh-wf-test-debug-head')?.textContent ?? '', pre: d.querySelector('.dsh-wf-test-debug-pre')?.textContent ?? '' };
  })()`);
  ok(tr.head.includes('Stub 模型') && tr.head.includes('tokens 入 11'), `⑲ ★试跑结果带 AI 调试（模型 + token）（实际：${tr.head.slice(0, 90)}）`);
  ok(tr.pre.includes('实际提示词'), '⑲b ★试跑里能看到"模型真正看到的提示词"');
}
