// tmp-test/cdp/test-run-log.mjs — 🧾 运行日志弹窗（2026-10-04 用户需求）
//   用户原话：「现在每个节点的执行情况没有日志打印，参数传递是否正常，下个节点接收参数是否正常
//             都没有日志可以看到，无法判断流程中间执行日志情况，节点之间的交互情况也没有，工作流执行黑盒」。
// 契约（本用例钉死）：
//   ① 头部有 🧾 按钮；点开弹「🧾 运行日志」，标题/头部说明写清工作流名与节点数
//   ② 每个节点一条：节点 id + 类型 + 状态 + 耗时；展开后能看到「原始参数（含 {{}}）→ 实际入参（已展开）→ 出参」
//   ③ 记着「引用上游」= 节点之间的交互
//   ④ 搜索框能过滤；📋 复制全部 / 复制本节点可用（headless 里把 clipboard 换成桩）
//   ⑤ 没跑过的工作流 → 弹窗给出「暂无日志」而不是空白/报错
import { confirmSelfcheck } from './driver.mjs';

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
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-logdlg .dag-flow-picker-close').click(); return true; })()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-logdlg')`, { timeout: 5000 });

  // ===== B. 跑一次 → 日志有内容 =====
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await confirmSelfcheck(cdp);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-run-result')`, { timeout: 12000 });
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
  await evaluate(cdp, `(() => { document.querySelectorAll('.dsh-wf-log-item .dsh-wf-log-head')[1].click(); return true; })()`);
  await sleep(200);
  const detail = await evaluate(cdp, `(() => {
    const it = document.querySelectorAll('.dsh-wf-log-item')[1];
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
    const btns = [...document.querySelectorAll('.dsh-wf-log-item')[1].querySelectorAll('button')];
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
}
