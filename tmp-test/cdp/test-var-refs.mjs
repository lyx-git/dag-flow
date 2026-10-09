// tmp-test/cdp/test-var-refs.mjs — 右侧节点面板的「变量引用」区（2026-10-03 用户需求原话：
// 「画布右边的节点编辑面板里面，要展示上游能传过来的所有变量，点击复制可以使用，包括全局变量，
//   也要展示能给下游输出的所有变量，点击可以复制变量使用，也要包含全局变量，方便用户开发工作流的时候
//   直接使用，最好能说明一下每个变量作用是什么」）。
// 夹具：cdp-host.html?vars=1 —— start → seed(set_var: topic/words) → fetch(web_search) → py(python) → ai(subagent) → end
//       def.inputs = { 主题, 语言 }（验证 {{inputs.*}}）
import {goto, installHelpers, confirmSelfcheck } from './driver.mjs';

/** 点画布上某个节点卡（按卡内文本匹配），选中它 → 右侧面板显示该节点的参数 */
const clickCardByText = (needle) => `(() => {
  const hosts = [...document.querySelectorAll('.dsh-wf-fg-node-host')];
  const i = hosts.findIndex((h) => (h.textContent || '').includes(${JSON.stringify(needle)}));
  if (i < 0) throw new Error('找不到节点卡：' + ${JSON.stringify(needle)});
  window.__df_clickNode(i);
  return i;
})()`;

const panelText = `(() => {
  const right = document.querySelector('.dsh-wf-right') ?? document.body;
  return right.innerText || '';
})()`;

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&vars=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  // 记录剪贴板写入（headless 下 navigator.clipboard 可能被拒，改成可断言的探针）
  await evaluate(cdp, `(() => {
    window.__copied = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
      });
    } catch { /* 忽略 */ }
    return true;
  })()`);

  // ===== 选中 py（有 2 个上游：seed / fetch）=====
  //   ★ 2026-10-09 用户要求：变量面板改成**独立弹窗**（编辑面板只留入口按钮）
  //     → 所有变量断言前先"打开变量弹窗" ✓（弹窗 Portal 到 body，选择器不变 ✓）
  const openVarDlg = async () => {
    await evaluate(cdp, `(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('打开变量弹窗'));
      if (b) b.click();
      return !!b;
    })()`);
    await waitFor(cdp, `!!document.querySelector('.dsh-wf-var-group')`, { timeout: 8000 });
    await sleep(200);
  };
  await evaluate(cdp, clickCardByText(' · py'));
  await sleep(200);
  // 「编辑面板不再被变量列表撑长」是用户提这个需求的初衷 → 先断言面板里已经没有变量列表 ✓
  const lean = await evaluate(cdp, `(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('打开变量弹窗'));
    return { hasBtn: !!btn, dlgOpen: !!document.querySelector('.dag-flow-picker-overlay') };
  })()`);
  ok(lean.hasBtn === true, '⓪0 ★编辑面板里有「打开变量弹窗」入口按钮');
  ok(lean.dlgOpen === false, '⓪0b ★未点按钮时没有弹窗（面板也不再被变量列表撑长）');
  await openVarDlg();
  const dlgInfo = await evaluate(cdp, `(() => {
    const ov = document.querySelector('.dag-flow-picker-overlay');
    const dlg = document.querySelector('.dag-flow-picker.dsh-wf-var-dlg');
    return {
      isPortalToBody: ov ? ov.parentElement === document.body : false,
      title: document.querySelector('.dag-flow-picker-title')?.textContent ?? '',
      width: dlg ? Math.round(dlg.getBoundingClientRect().width) : 0,
      hasClose: !!document.querySelector('.dag-flow-picker-close'),
    };
  })()`);
  ok(dlgInfo.isPortalToBody === true, '⓪0c ★弹窗 Portal 到 body（避免面板 backdrop-filter 困住 fixed ✗）');
  ok(dlgInfo.title.includes('变量引用') && dlgInfo.title.includes('py'), '⓪0d 弹窗标题带节点标识（实际：' + dlgInfo.title + '）');
  ok(dlgInfo.width >= 755 && dlgInfo.width !== 680, '⓪0e ★弹窗宽度走自己的类（没被运行时注入的 680 压掉）实际 ' + dlgInfo.width + '（760 + 左右边框）');
  ok(dlgInfo.hasClose === true, '⓪0f 右上 ✕ 关闭（项目弹窗约定）');

  // ★ 2026-10-09 方案 C：上游分组**默认收起**（面板不再平铺 ✓）——先断言这个新默认，
  //   再逐个点开（后续 §① 的字段级断言依赖展开态 ✓）
  const collapsed = await evaluate(cdp, `(() => {
    const toggles = [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')];
    return {
      n: toggles.length,
      allClosed: toggles.every((t) => t.classList.contains('is-closed')),
      carets: toggles.map((t) => t.textContent.trim().slice(0, 1)),
      chipsInside: toggles.reduce((s, t) => s + t.parentElement.querySelectorAll('.dsh-wf-var-chip').length, 0),
    };
  })()`);
  ok(collapsed.n >= 2 && collapsed.allClosed, `⓪ ★上游分组默认**收起**（${collapsed.n} 组全部 is-closed）`);
  ok(collapsed.carets.every((c) => c === '▸'), `⓪a 收起时用 ▸ 指示（实际 ${JSON.stringify(collapsed.carets)}）`);
  ok(collapsed.chipsInside === 0, `⓪b ★收起时组内不铺芯片（这正是"避免平铺"的效果，实测 ${collapsed.chipsInside} 个）`);
  // 点开后应变成 ▾ 且芯片出现
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')].forEach((t) => t.click());
    return true;
  })()`);
  await sleep(200);
  const expanded = await evaluate(cdp, `(() => {
    const toggles = [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')];
    return {
      allOpen: toggles.every((t) => !t.classList.contains('is-closed')),
      carets: toggles.map((t) => t.textContent.trim().slice(0, 1)),
      chips: toggles.reduce((s, t) => s + t.parentElement.querySelectorAll('.dsh-wf-var-chip').length, 0),
    };
  })()`);
  ok(expanded.allOpen && expanded.carets.every((c) => c === '▾'), `⓪c ★点一下展开（▾，实际 ${JSON.stringify(expanded.carets)}）`);
  ok(expanded.chips > 0, `⓪d 展开后组内出现字段芯片（${expanded.chips} 个）`);

  const groups = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.dsh-wf-panel-row')];
    const find = (kw) => rows.find((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes(kw));
    const up = find('上游变量');
    const gv = find('全局变量');
    const me = find('本节点输出');
    const chips = (el) => [...(el?.querySelectorAll('.dsh-wf-var-chip') ?? [])].map((c) => c.textContent.trim());
    return {
      upLabel: up?.querySelector('.dsh-wf-panel-label')?.textContent ?? '',
      upNodes: [...(up?.querySelectorAll('.dsh-wf-var-node') ?? [])].map((n) => n.textContent.trim()),
      upChips: chips(up),
      upLegend: (up?.querySelector('.dsh-wf-var-legend')?.textContent ?? ''),
      gvLabel: gv?.querySelector('.dsh-wf-panel-label')?.textContent ?? '',
      gvChips: chips(gv),
      meLabel: me?.querySelector('.dsh-wf-panel-label')?.textContent ?? '',
      meChips: chips(me),
      meLegends: [...(me?.querySelectorAll('.dsh-wf-var-legend') ?? [])].map((n) => n.textContent.trim()),
      firstUpTitle: up?.querySelector('.dsh-wf-var-chip')?.getAttribute('title') ?? '',
      outCls: [...(me?.querySelectorAll('.dsh-wf-var-chip') ?? [])].every((c) => c.className.includes('is-out')),
    };
  })()`);

  // ① 上游变量：按上游节点分组 + 字段级 chip
  ok(groups.upLabel.includes('上游变量') && groups.upLabel.includes('3 个上游节点'),
    '① 上游变量区存在并报出 3 个上游节点（start + seed + fetch）（实际：' + groups.upLabel + '）');
  ok(groups.upNodes.length === 4
    && groups.upNodes.some((t) => t.includes('seed'))
    && groups.upNodes.some((t) => t.includes('fetch'))
    && groups.upNodes.some((t) => t.includes('start'))
    && groups.upNodes.some((t) => t.includes('全局变量')),
    '① 按上游节点分组（3 个上游各一组 + 末尾一组全局变量）实际：' + JSON.stringify(groups.upNodes) + '）');
  ok(groups.upChips.includes('{{seed.out}}') && groups.upChips.includes('{{fetch.out}}'),
    '① 每个上游都给「整份输出」chip（实际：' + JSON.stringify(groups.upChips) + '）');
  ok(groups.upChips.includes('{{fetch.out.results.0.url}}') && groups.upChips.includes('{{fetch.out.count}}'),
    '① 上游 web_search 给出字段级 chip（results.0.url / count）实际：' + JSON.stringify(groups.upChips) + '）');
  ok(groups.upChips.includes('{{results.fetch}}'), '① 同时给出执行状态引用 {{results.fetch}}');

  // ===== ★ 2026-10-09 方案 C：口语化搜索（节点名 / 字段说明 / 路径 / 拼音首字母）=====
  const setVarQ = (v) => evaluate(cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-var-search');
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value').set;
    set.call(inp, ${JSON.stringify(v)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const varState = () => evaluate(cdp, `(() => {
    const toggles = [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')];
    return {
      headers: toggles.map((t) => t.textContent.trim()),
      openCount: toggles.filter((t) => !t.classList.contains('is-closed')).length,
      upLabel: [...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('上游变量'))?.textContent ?? '',
      hint: [...document.querySelectorAll('.dsh-wf-panel-hint')].map((h) => h.textContent).join(' | '),
    };
  })()`);

  await setVarQ('搜索');
  await sleep(220);
  let st = await varState();
  ok(st.headers.length === 1 && st.headers[0].includes('fetch'), '★S1 中文按**节点显示名**过滤（只剩「网页搜索」组，实际 ' + JSON.stringify(st.headers) + '）');
  ok(st.openCount === 1, '★S2 ★命中时自动展开（不用手点，实际展开 ' + st.openCount + ' 组）');

  await setVarQ('wyss');
  await sleep(220);
  st = await varState();
  ok(st.headers.length === 1 && st.headers[0].includes('fetch'), '★S3 ★拼音首字母也能搜（wyss=网页搜索 → 实际 ' + JSON.stringify(st.headers) + '）');

  await setVarQ('rq');
  await sleep(220);
  st = await varState();
  ok(/命中 0 项/.test(st.hint) || st.headers.length === 0, '★S4 搜不到的拼音给明确空态（实际提示：' + st.hint.slice(0, 40) + '）');

  await setVarQ('fetch.out.count');
  await sleep(220);
  st = await varState();
  ok(st.headers.length === 1 && st.headers[0].includes('fetch'), '★S5 按**变量路径**也能搜（fetch.out.count）');
  const countChip = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-var-chip')].some((c) => c.textContent.includes('{{fetch.out.count}}'))`);
  ok(countChip === true, '★S6 路径命中时该字段 chip 可见');

  // ★S7 清空搜索要回到"用户记住的展开状态"（默认全收起 ✓；搜索期间的自动展开是临时的 ✓）
  //   注意：搜索生效期间分组是**强制展开**的（点不动 ✗）→ 必须先清空查询，再折叠 ✓
  await setVarQ('');
  await sleep(220);
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')].forEach((t) => { if (!t.classList.contains('is-closed')) t.click(); }); return true; })()`);
  await sleep(180);
  ok((await varState()).openCount === 0, '★S7a 手动收起后 0 组展开');
  await setVarQ('搜索');
  await sleep(220);
  ok((await varState()).openCount === 1, '★S7b 搜索时临时自动展开命中组（1 组）');
  await setVarQ('');
  await sleep(220);
  st = await varState();
  ok(st.openCount === 0 && st.headers.length >= 2, '★S7c ★清空搜索 → 回到"记住的收起状态"（实际展开 ' + st.openCount + ' 组，' + st.headers.length + ' 组可见）');

  // 后续断言依赖"组已展开"，这里再点开一次
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')].forEach((t) => t.click()); return true; })()`);
  await sleep(200);

  // ② 说明每个变量作用（chip title + 字段说明行）
  ok(groups.firstUpTitle.includes('作用：'), '② chip 的 tooltip 说明这个变量是干什么的（实际：' + groups.firstUpTitle.split('\n').join(' | ') + '）');
  ok(groups.upLegend.includes('results.0.url=第 1 条链接') && groups.upLegend.includes('count=结果条数'),
    '② 字段说明行逐条解释字段含义（实际：' + groups.upLegend.slice(0, 120) + '…）');

  // ③ 全局变量：vars（来自 set_var）+ inputs（工作流参数）+ 循环注入变量
  ok(groups.gvLabel.includes('全局变量') && groups.gvLabel.includes('vars 2') && groups.gvLabel.includes('inputs 2'),
    '③ 全局变量区报出 vars 2 / inputs 2（实际：' + groups.gvLabel + '）');
  ok(['{{vars.topic}}', '{{vars.words}}', '{{inputs.主题}}', '{{inputs.语言}}', '{{vars.loopItem}}', '{{vars.loopIndex}}'].every((c) => groups.gvChips.includes(c)),
    '③ vars / inputs / 循环变量都在（实际：' + JSON.stringify(groups.gvChips) + '）');

  // ④ 本节点输出（py = python，标量输出）
  ok(groups.meLabel.includes('本节点输出'), '④ 本节点输出区存在（实际：' + groups.meLabel + '）');
  ok(groups.meChips.includes('{{py.out}}') && groups.meChips.includes('{{results.py}}'),
    '④ 标量输出只给整取引用（{{py.out}} / {{results.py}}）实际：' + JSON.stringify(groups.meChips) + '）');
  ok(groups.meLegends.some((t) => t.includes('stdout')) && groups.meLegends.some((t) => t.includes('下游节点这样用')),
    '④ 说明「输出是什么」+「下游怎么用」（实际：' + JSON.stringify(groups.meLegends).slice(0, 200) + '…）');
  ok(groups.outCls, '④ 本节点输出的 chip 有独立配色（is-out）');

  // ⑤ 点击复制 → 剪贴板 + **浮窗**提示「已复制 xxxx」（2026-10-03 用户要求：原来是面板内行内小字，改成浮窗）
  await evaluate(cdp, `(() => {
    const chips = [...document.querySelectorAll('.dsh-wf-var-chip')];
    const c = chips.find((x) => x.textContent.trim() === '{{fetch.out.count}}');
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  await sleep(250);
  const copied = await evaluate(cdp, `(() => {
    const t = document.querySelector('.dsh-wf-copy-toast');
    const cs = t ? getComputedStyle(t) : null;
    const r = t ? t.getBoundingClientRect() : null;
    return {
      list: window.__copied ?? [],
      toast: t ? t.textContent : null,
      parentIsBody: t ? (t.parentElement === document.body) : false,
      pos: cs ? cs.position : null,
      fixedInViewport: r ? (r.bottom <= window.innerHeight + 1 && r.left >= 0 && r.right <= window.innerWidth + 1) : false,
      inlineHints: [...document.querySelectorAll('.dsh-wf-panel-hint')].map((h) => h.textContent).filter((x) => x.includes('已复制')).join('|'),
    };
  })()`);
  ok(copied.list.includes('{{fetch.out.count}}'), '⑤ 点击 chip 真的把引用写进剪贴板（实际：' + JSON.stringify(copied.list) + '）');
  ok(!!copied.toast && copied.toast.includes('已复制') && copied.toast.includes('{{fetch.out.count}}'),
    '⑤ 浮窗提示「已复制 {{fetch.out.count}}」（实际：' + JSON.stringify(copied.toast) + '）');
  ok(copied.parentIsBody && copied.pos === 'fixed', '⑤ 是浮窗不是面板内文字（Portal 到 body、position=fixed，实际 parent=body:' + copied.parentIsBody + ' pos=' + copied.pos + '）');
  ok(copied.fixedInViewport, '⑤ 浮窗落在视口内可见（不被面板裁剪/溢出）');
  ok(copied.inlineHints === '', '⑤ 面板里不再有行内「已复制」小字（实际：' + copied.inlineHints + '）');
  // 连点同一个 chip 也要能重新弹出（只存字符串时 React 不重渲染、计时器不重置）
  await evaluate(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-var-chip')].find((x) => x.textContent.trim() === '{{fetch.out.count}}');
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  await sleep(150);
  const again = await evaluate(cdp, `document.querySelector('.dsh-wf-copy-toast')?.textContent ?? null`);
  ok(!!again && again.includes('{{fetch.out.count}}'), '⑤ 连点同一个 chip，浮窗重新弹出（实际：' + JSON.stringify(again) + '）');
  // 1.6s 后自动消失（浮窗不该常驻挡住画布）
  await sleep(1800);
  ok(await evaluate(cdp, `!document.querySelector('.dsh-wf-copy-toast')`), '⑤ 浮窗自动消失（约 1.6s 后）');

  // ⑥ 换选 fetch（web_search）→ 本节点输出变成字段级
  await evaluate(cdp, clickCardByText(' · fetch'));
  await openVarDlg();   // ★ 换选节点会让检查器重挂载 → 变量弹窗随之关闭 ✗ → 重新打开 ✓（该函数幂等 ✓）
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes('本节点输出') && r.textContent.includes('{{fetch.out.count}}'))`, { timeout: 8000 });
  const self2 = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes('本节点输出'));
    return {
      chips: [...row.querySelectorAll('.dsh-wf-var-chip')].map((c) => c.textContent.trim()),
      legends: [...row.querySelectorAll('.dsh-wf-var-legend')].map((n) => n.textContent.trim()),
      upLabel: ([...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('上游变量'))?.textContent ?? ''),
    };
  })()`);
  ok(self2.chips.includes('{{fetch.out.count}}') && self2.chips.includes('{{fetch.out.results.0.title}}'),
    '⑥ 对象型节点（web_search）本节点输出给字段级 chip（实际：' + JSON.stringify(self2.chips) + '）');
  ok(self2.legends.some((t) => t.includes('count=结果条数')), '⑥ 本节点输出的字段说明同样带含义（实际：' + JSON.stringify(self2.legends).slice(0, 160) + '…）');
  ok(self2.upLabel.includes('2 个上游节点'), '⑥ 换节点后上游数量跟着变（fetch 只有 start + seed 两个上游）实际：' + self2.upLabel);

  // ⑦ 全局变量在「上游变量」「本节点输出」两侧都存在（用户原话：两处都要包含全局变量）
  const both = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.dsh-wf-panel-row')];
    const has = (kw) => rows.some((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes(kw) && r.textContent.includes('{{vars.topic}}'));
    return { inUpstream: has('上游变量'), inSelf: has('本节点输出'), inGlobal: has('全局变量') };
  })()`);
  ok(both.inGlobal, '⑦ 全局变量区列出 {{vars.topic}}');
  ok(both.inUpstream && both.inSelf, '⑦ 上游变量 / 本节点输出两处也把全局变量一并给出（实际：' + JSON.stringify(both) + '）');
  const allText = await evaluate(cdp, panelText);
  ok(!allText.includes('undefined'), '⑦ 面板无 undefined 残留');

  // ===== ⑧ 跑一次之后：字段改由**真实输出**反推（用户自定义键 + 深层路径 + 样例值）=====
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}e&vars=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-btn-success')`, { timeout: 20000 });
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认
  await waitFor(cdp, `(document.body.textContent || '').includes('运行成功')`, { timeout: 8000 });
  await evaluate(cdp, clickCardByText(' · py'));
  await openVarDlg();   // ★ 变量已搬进弹窗；重选节点后要确保弹窗开着（选择态变化会让检查器重挂载、弹窗随之关闭 ✗）
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-var-node')].some((n) => n.textContent.includes('取自上次运行的真实输出'))`, { timeout: 8000 });
  // ★ 方案 C 下上游分组**默认收起**；而且这一句"重新选中节点"会让检查器重挂载、展开态回到默认收起 ✗
  //   → 要读字段级 chip 之前先全部展开 ✓
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('.dsh-wf-var-node.is-toggle')].forEach((t) => { if (t.classList.contains('is-closed')) t.click(); });
    return true;
  })()`);
  await sleep(200);
  const live = await evaluate(cdp, `(() => {
    const groups = [...document.querySelectorAll('.dsh-wf-var-group')];
    const g = groups.find((x) => (x.querySelector('.dsh-wf-var-node')?.textContent || '').includes(' · fetch'));
    const gs = groups.find((x) => (x.querySelector('.dsh-wf-var-node')?.textContent || '').includes(' · seed'));
    const txt = (root) => ({
      header: root?.querySelector('.dsh-wf-var-node')?.textContent ?? '',
      chips: [...(root?.querySelectorAll('.dsh-wf-var-chip') ?? [])].map((c) => c.textContent.trim()),
      legend: [...(root?.querySelectorAll('.dsh-wf-var-legend') ?? [])].map((n) => n.textContent.trim()).join(' | '),
    });
    return { fetch: txt(g), seed: txt(gs) };
  })()`);
  ok(live.fetch.header.includes('取自上次运行的真实输出'), '⑧ 组头标注字段来自上次运行的真实输出（实际：' + live.fetch.header + '）');
  ok(live.fetch.chips.includes('{{fetch.out.results.0.url}}') && live.fetch.chips.includes('{{fetch.out.count}}'),
    '⑧ 真实输出里的字段（含深层 results.0.url）被列出来（实际：' + JSON.stringify(live.fetch.chips) + '）');
  ok(live.fetch.legend.includes('results.0.url=https://example.com/a') && live.fetch.legend.includes('第 1 条链接'),
    '⑧ 实测字段写「字段=样例值（类型）（含义）」：静态表的中文说明照样补上（实际：' + live.fetch.legend.slice(0, 260) + '）');
  ok(live.seed.chips.includes('{{seed.out.topic}}') && live.seed.chips.includes('{{seed.out.words}}'),
    '⑧ 用户自定义键（设置变量节点写入的 vars）也能列出（实际：' + JSON.stringify(live.seed.chips) + '）');
  ok(live.seed.legend.includes('topic=AI 日报'), '⑧ 自定义键带真实样例值（实际：' + live.seed.legend.slice(0, 160) + '）');

  // 选中跑过的 fetch 自己 → 本节点输出同样是实测字段
  await evaluate(cdp, clickCardByText(' · fetch'));
  await openVarDlg();   // ★ 同 §⑥：换选会关闭变量弹窗 → 重开 ✓
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes('本节点输出') && r.textContent.includes('实测字段'))`, { timeout: 8000 });
  const selfLive = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.querySelector('.dsh-wf-panel-label')?.textContent || '').includes('本节点输出'));
    return { chips: [...row.querySelectorAll('.dsh-wf-var-chip')].map((c) => c.textContent.trim()),
      legend: [...row.querySelectorAll('.dsh-wf-var-legend')].map((n) => n.textContent.trim()).join(' | ') };
  })()`);
  ok(selfLive.chips.includes('{{fetch.out.results.0.title}}') && selfLive.legend.includes('title=标题一'),
    '⑧ 本节点输出也用实测字段 + 样例值（实际：' + selfLive.legend.slice(0, 200) + '）');
  ok(selfLive.legend.includes('实测字段') && selfLive.legend.includes('取自上次运行'),
    '⑧ 说明里明确写清字段来源是上次运行（实际：' + selfLive.legend.slice(0, 120) + '）');
}
