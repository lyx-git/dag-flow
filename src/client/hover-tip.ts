// src/client/hover-tip.ts — 悬浮提示接管（2026-10-13 用户要求，同日二次返工为「跟随鼠标」形态）
// 原话：「所有的鼠标悬浮上去浮窗展示的内容，都要求能复制，不能无法选中浮窗内容，而且鼠标悬浮弹窗有点丑，
//        和插件风格不太匹配」+「提示浮窗最好是跟着鼠标走，提示在鼠标的右上方，鼠标移动重新提示，
//        浮窗的内容还是无法复制，双击无法选中浮窗的内容」。
// 形态定稿：
//   · **跟随鼠标**：卡片 fixed 在 (0,0)，用 transform 定位到**鼠标右上方**（卡片底边在光标上方 10px、
//     左边在光标右侧 12px）；锚点内 mousemove 持续重定位（transform 不触发重排，性能口径见代码规范 #11）。
//   · **可选中复制**：卡片 user-select:text + pointer-events:auto；**mousedown/wheel/scroll 只在目标
//     不在卡片内时才收**——第一版「任何 mousedown 立即收」会在按下第一刻把卡片拆掉，双击选词/选择
//     根本无从发生（这就是「无法复制」的根因）。
//   · 原生 title 摘到 data-title（浏览器不画系统悬浮框）；React 重渲染还回来也会再次被摘；
//     摘掉后 React 不重渲染时悬停回退读 data-title（提示不能只出现一次——二次返工修的第二个 bug）。
//   · 鼠标移入卡片：停留（可选中）；移出：160ms 后收（也可回锚点重新跟随）；按下/滚轮/滚动发生在
//     卡片外：立即收（z-index 10006 高于弹窗遮罩，必须防它盖住新弹窗）。
// ★ 2026-10-15 范围收窄（用户：「dag-flow插件的鼠标悬浮窗变成dsh全局的了，改成只有dag-flow的鼠标悬浮窗」；
//   此前修复两轮都被用户 git 回退卷走——「之前修复的一直有问题」的根因，本版在回退后基线重做，
//   verify-build-markers 已加产物级断言防「修了没生效」静默复发）：
//   · 接管范围 = 插件作用域：面板根 .dsh-wf-root 的子树 + Portal 弹窗/选择器 .dag-flow-picker-overlay
//     （body 直挂，不在面板子树里，必须单独认）。范围外的 dsh 宿主元素：**不摘 title**（原生悬浮框照常），
//     旧全局版摘成 data-title 的悬停时自愈还原（title 回来 → 宿主原生悬浮框恢复）。
// ★ 2026-10-15 灵敏度加固（用户：「鼠标悬浮窗不太灵敏，画布里鼠标移动经常显示不出来」）：
//   wheel/scroll 立即收卡后鼠标仍停在原元素上（不会再触发 mouseover）→ 卡片永不重现。
//   记 lastAnchor/lastText（hide 不清），mousemove 发现「锚点还悬着但卡片没了」就地重显；
//   按住拖拽（e.buttons≠0）不重显（防拖节点闪卡）；锚点已脱离文档（React 卸载）不重显。
// ★ 2026-10-15 排除画布节点卡（用户：「画布上节点的悬浮窗变成了节点里面文字的悬浮窗，内容也没之前多了」）：
//   节点卡的副标题等自带原生 title，hover-tip 劫持它 = 用一行副标题顶掉节点本来的悬浮窗
//   （运行结果卡，z-index 9999 < 10006 被盖住）。.dsh-wf-fg-node 子树整体跳过（见 mouseover 内注释）。
// 初始化幂等，挂在 FlowPanel 模块副作用上 ⇒ 真机与 CDP 夹具一处生效。

let inited = false;

export function initHoverTips(): void {
  if (inited || typeof document === 'undefined') return;
  inited = true;

  let tip: HTMLDivElement | null = null;
  let anchor: Element | null = null;
  let hideTimer: number | null = null;
  let tipW = 0;
  let tipH = 0;
  let lastAnchor: Element | null = null;                         // 最近一次显示的锚点（hide 不清——重显兜底要用）
  let lastText = '';

  /** 插件作用域：面板根子树 + Portal 弹窗/选择器 overlay（body 直挂）。范围外的宿主 UI 一律不接管 */
  const inPluginScope = (el: Element): boolean =>
    !!(el.closest('.dsh-wf-root') || el.closest('.dag-flow-picker-overlay'));

  const hide = (): void => {
    if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
    tip?.remove();
    tip = null;
    anchor = null;
  };
  const hideSoon = (): void => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hide, 160);
  };
  const keep = (): void => {
    if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
  };

  /** 以鼠标点 (mx,my) 为基准把卡片放到**右上方**；上方/右侧放不下时依次翻到下方/左侧，并夹在视口内 */
  const placeAt = (mx: number, my: number): void => {
    if (!tip) return;
    const OFF_X = 12;
    const GAP_Y = 10;
    let x = mx + OFF_X;
    let y = my - GAP_Y - tipH;                                     // 右上方
    if (y < 8) y = my + GAP_Y;                                     // 上方没空间 → 右下方
    if (x + tipW > window.innerWidth - 8) x = Math.max(8, mx - tipW - OFF_X); // 右侧出界 → 移到鼠标左侧
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  const showAt = (el: Element, text: string, mx: number, my: number): void => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'dsh-wf-hover-tip';
      tip.addEventListener('mouseenter', keep);                    // 移进卡片：停留（可选中复制）
      tip.addEventListener('mouseleave', hideSoon);                // 移出卡片：稍后收
      document.body.appendChild(tip);
    }
    if (tip.textContent !== text) tip.textContent = text;
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    tipW = tip.offsetWidth;
    tipH = tip.offsetHeight;
    tip.style.visibility = 'visible';
    anchor = el;
    lastAnchor = el;                                               // 重显兜底：记住最后锚点（hide 不清）
    lastText = text;
    placeAt(mx, my);
  };

  /** 读元素的提示文本：title 优先（读到即摘成 data-title，浏览器就不画系统悬浮框），否则回退 data-title */
  const readTipText = (el: Element): string | null => {
    let text = el.getAttribute('title');
    if (text === null || text === '') text = el.getAttribute('data-title') ?? '';
    else { el.setAttribute('data-title', text); el.removeAttribute('title'); }
    return text || null;
  };

  // 悬停 [title]（或已摘成 [data-title]）元素 → 显示/更新卡片
  document.addEventListener('mouseover', (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    const el = target.closest?.('[title], [data-title]') as Element | null;
    if (!el || el === tip) return;                                 // 卡片内部移动不管
    // ★ 画布节点卡不接管（2026-10-15 用户反馈「节点的悬浮窗变成了节点里面文字的悬浮窗、内容也没之前多了」）：
    //   节点有自己的悬浮窗 = 运行结果卡（ResultTipBox，Portal 到 body；未运行不弹是 2026-10-08 用户定的契约），
    //   而节点卡里的副标题/分支 chip/subflow 提示行都带原生 title（截断文字的提示）——hover-tip 在这里
    //   只会把副标题文字（如「3.12 内置 · timeout 30000ms」）劫持成跟随卡，且 z-index 10006 > 结果卡 9999，
    //   正好把结果卡盖住。⇒ 整个 .dsh-wf-fg-node 子树跳过：不出主题卡、也不摘 title（原生悬浮框照常）。
    if (el.closest('.dsh-wf-fg-node')) return;
    if (!inPluginScope(el)) {
      // 插件范围外（dsh 宿主 UI）：不接管——原生 title 原样保留；
      // 旧全局版摘走的 data-title 自愈还原（title 回来 → 下次悬停就是浏览器原生悬浮框）
      if ((el.getAttribute('title') ?? '') === '') {
        const dt = el.getAttribute('data-title');
        if (dt) { el.setAttribute('title', dt); el.removeAttribute('data-title'); }
      }
      return;
    }
    const text = readTipText(el);
    if (!text) return;
    keep();
    showAt(el, text, e.clientX, e.clientY);
  }, true);

  // 锚点内移动 → 跟随鼠标重新定位（「鼠标移动重新提示」）
  // ★ 重显兜底：wheel/scroll 立即收卡后鼠标仍停在原锚点（无新 mouseover）→ 就地重显，卡片不再「消失不回来」
  document.addEventListener('mousemove', (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (tip && anchor) {
      if (t && (t === anchor || (anchor.contains?.(t) ?? false))) placeAt(e.clientX, e.clientY);
      return;
    }
    if (!lastAnchor || e.buttons !== 0) return;                    // 按住拖拽不重显（防拖节点闪卡）
    const stillOn = !!t && (t === lastAnchor || (lastAnchor.contains?.(t) ?? false));
    if (!stillOn) { lastAnchor = null; lastText = ''; return; }    // 已离开原锚点 → 兜底作废
    if (!lastAnchor.isConnected || !inPluginScope(lastAnchor)) return; // 锚点已被 React 卸载 / 出了插件范围
    const text = readTipText(lastAnchor) ?? lastText;
    if (text) showAt(lastAnchor, text, e.clientX, e.clientY);
  }, true);

  // 离开锚点/卡片 → 稍后收（★ 用记录的 anchor 判断；不能 closest('[title]')——title 已被摘掉）
  document.addEventListener('mouseout', (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (!t || !anchor) return;
    if (t === anchor || (anchor.contains?.(t) ?? false) || t === tip || (tip?.contains?.(t) ?? false)) hideSoon();
  }, true);

  // ★ 按下/滚轮/滚动：目标**在卡片内**一律放行（选择、双击选词、翻看长文案都不许被拆）；
  //   在卡片外才收（点 UI、开新弹窗时卡片立即让位）。移出锚点的收起由上面的 hideSoon 负责。
  //   收掉后 lastAnchor/lastText 保留 → 鼠标仍停在锚点上时 mousemove 会就地重显（灵敏度加固）。
  const hideUnlessInTip = (e: Event): void => {
    if (tip && (tip.contains?.(e.target as Node) ?? false)) return;
    hide();
  };
  document.addEventListener('mousedown', hideUnlessInTip, true);
  document.addEventListener('wheel', hideUnlessInTip, true);
  document.addEventListener('scroll', hideUnlessInTip, true);
  window.addEventListener('blur', hide);
}
