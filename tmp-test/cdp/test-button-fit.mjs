// tmp-test/cdp/test-button-fit.mjs — 按钮与内部文字的**尺寸适配**（2026-10-09 用户反馈）
//   用户原话：「按钮长度和按钮内部文字长度没匹配，导致按钮长度调整的时候，按钮内部文字长度不会自动调整，需要优化」。
// 契约（本用例钉死）：把右侧参数面板**缩窄**后，面板里的按钮必须跟着适配 ——
//   ① 按钮外框不超出容器（`rect.width <= 容器宽 + 1`）
//   ② 文字不被裁掉（`scrollWidth <= clientWidth + 1`，即要么换行、要么缩短，绝不溢出）
//   ③ 按钮高度随之增长（换行后不该把文字压扁 ✗）
// 说明：`.dsh-wf-btn` 原来是 `white-space: nowrap` 且没有 `max-width` ✗ → 窄容器里会横向溢出/被裁。
import { waitFor } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor: wf, ok, sleep }) {
  const wait = wf ?? waitFor;
  await wait(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });

  // 选中一个节点（右侧面板才有内容）—— 用画布的节点宿主数组索引点击（与 var-refs 用例同款助手 ✓）
  //   不指定节点名（夹具默认工作流的节点名不固定 ✓），选第一个即可
  const picked = await evaluate(cdp, `(() => {
    const hosts = [...document.querySelectorAll('.dsh-wf-fg-node-host')];
    if (!hosts.length) return -1;
    window.__df_clickNode(0);
    return 0;
  })()`);
  ok(picked === 0, '⓪ 已选中画布上的第一个节点（右侧面板出内容）');
  await wait(cdp, `document.querySelectorAll('.dsh-wf-right button').length >= 2`, { timeout: 8000 });
  await sleep(300);

  /** 量测右侧面板里所有按钮：外框宽 / 文字宽 / 容器宽 / 是否溢出 */
  const measure = () => evaluate(cdp, `(() => {
    const panel = document.querySelector('.dsh-wf-right');
    if (!panel) return null;
    const pw = panel.clientWidth;
    const btns = [...panel.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      // 文字实际占宽：用 Range 量文本节点
      let tw = 0;
      try {
        const range = document.createRange();
        range.selectNodeContents(b);
        tw = range.getBoundingClientRect().width;
      } catch { tw = 0; }
      return {
        text: (b.textContent || '').trim().slice(0, 26),
        w: Math.round(r.width), h: Math.round(r.height), tw: Math.round(tw),
        overflow: b.scrollWidth > b.clientWidth + 1,
        ws: cs.whiteSpace, maxW: cs.maxWidth,
        // 故意占满整行的（.dsh-wf-w-full，删除节点/主操作那种）：不算被拉伸 ✗
        // ★注意：本段是模板字符串内部，注释里不能出现反引号——会提前终止模板串，把后面的内容变成裸标识符（曾报 w is not defined 且堆栈指向注释行）
        full: b.classList.contains('dsh-wf-w-full'),
        wrapped: Math.round(r.height) > 34,   // 换行后高度 > min-height → 说明空间不足在自适应 ✓
      };
    });
    return { panelW: pw, btns };
  })()`);

  const before = await measure();
  console.log('  [diag] 默认面板宽 =', before?.panelW, ' 按钮数 =', before?.btns.length);
  for (const b of (before?.btns ?? []).slice(0, 8)) {
    console.log(`  [diag] 「${b.text}」 外框=${b.w} 文字=${b.tw} 高=${b.h} 溢出=${b.overflow} whiteSpace=${b.ws} maxWidth=${b.maxW}`);
  }

  // ===== ① 默认宽度下：不得溢出 =====
  const bad0 = (before?.btns ?? []).filter((b) => b.overflow);
  ok(bad0.length === 0, `① 默认宽度下没有按钮文字被裁（溢出 ${bad0.length} 个${bad0.length ? '：' + JSON.stringify(bad0.map((b) => b.text)) : ''}）`);

  // ===== ①b ★用户报的主现象：按钮长度应当"匹配"文字长度（不该被容器拉满 ✗）=====
  //   排除两类正常情况：①`.dsh-wf-w-full` 是**故意占满整行**的（删除节点那种）；②已换行的（高度>34）说明
  //   它在按可用宽度自适应 ✓；剩下"短文案却被拉满"才是要抓的 ✗
  const stretched = (before?.btns ?? []).filter((b) => !b.full && !b.wrapped && b.tw > 0 && b.w - b.tw > 40);
  ok(stretched.length === 0,
    `①b ★按钮外框跟随文字长度（不该被容器拉满）——超差 ${stretched.length} 个${stretched.length ? '：' + JSON.stringify(stretched.map((b) => [b.text, `外框${b.w}`, `文字${b.tw}`])) : ''}`);

  // ===== ② 把面板缩窄到 240px：按钮必须跟着适配 =====
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('.dsh-wf-right');
    panel.style.width = '240px';
    return true;
  })()`);
  await sleep(300);
  const narrow = await measure();
  console.log('  [diag] 缩窄后面板宽 =', narrow?.panelW);
  for (const b of (narrow?.btns ?? []).slice(0, 8)) {
    console.log(`  [diag] 「${b.text}」 外框=${b.w} 文字=${b.tw} 高=${b.h} 溢出=${b.overflow}`);
  }
  const overflow = (narrow?.btns ?? []).filter((b) => b.overflow);
  ok(overflow.length === 0,
    `② ★缩窄到 240px 后按钮文字仍不被裁（溢出 ${overflow.length} 个${overflow.length ? '：' + JSON.stringify(overflow.map((b) => b.text)) : ''}）`);
  const tooWide = (narrow?.btns ?? []).filter((b) => b.w > (narrow?.panelW ?? 0) + 1);
  ok(tooWide.length === 0,
    `③ ★按钮外框不超出面板（超出的 ${tooWide.length} 个${tooWide.length ? '：' + JSON.stringify(tooWide.map((b) => [b.text, b.w])) : ''}）`);

  // ===== ③ 换行后高度应增长（说明"文字跟着按钮宽度自适应" ✓）=====
  const pair = (narrow?.btns ?? []).find((b) => b.tw > 0 && b.h > 34);
  ok(!!pair || (narrow?.btns ?? []).every((b) => b.tw <= b.w - 2),
    '④ ★窄容器下长文案按钮要么换行增高、要么文字本身放得下（不存在"放不下又不换行" ✗）');

  // ===== ③ 极端窄（120px，压力测试）：长文案按钮必须**真的换行**，而不是溢出/被裁 =====
  //   为什么要有这一段：面板 240px 时最长文案（92px）仍放得下 → 换行分支根本没被走到，
  //   上面 ②③④ 只能证明"没坏"，证明不了"文字会跟着按钮宽度自适应"（用户报的正是这一点）。
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('.dsh-wf-right');
    panel.style.width = '120px';
    return true;
  })()`);
  await sleep(300);
  const tiny = await measure();
  console.log('  [diag] 极窄面板宽 =', tiny?.panelW);
  for (const b of (tiny?.btns ?? []).slice(0, 8)) {
    console.log(`  [diag] 「${b.text}」 外框=${b.w} 文字=${b.tw} 高=${b.h} 溢出=${b.overflow}`);
  }
  const tinyOverflow = (tiny?.btns ?? []).filter((b) => b.overflow);
  ok(tinyOverflow.length === 0,
    `④ ★极窄容器里按钮文字仍不被裁（溢出 ${tinyOverflow.length} 个${tinyOverflow.length ? '：' + JSON.stringify(tinyOverflow.map((b) => b.text)) : ''}）`);
  const tinyTooWide = (tiny?.btns ?? []).filter((b) => b.w > (tiny?.panelW ?? 0) + 1);
  ok(tinyTooWide.length === 0,
    `⑤ ★极窄容器里按钮外框不超出面板（超出的 ${tinyTooWide.length} 个${tinyTooWide.length ? '：' + JSON.stringify(tinyTooWide.map((b) => [b.text, b.w])) : ''}）`);
  const wrappedNow = (tiny?.btns ?? []).filter((b) => b.h > 34 && !b.full && b.tw > 0);
  ok(wrappedNow.length > 0,
    `⑥ ★极窄容器里长文案按钮**确实换行了**（高度 > 34 的非整行按钮 ${wrappedNow.length} 个：${JSON.stringify(wrappedNow.map((b) => [b.text, `高${b.h}`]))}）——这是"按钮变窄时文字跟着自适应"的直接证据`);

  // ===== ⑦ 头部按钮也扫一遍（用户：「其他按钮也需要排查」）=====
  //   修复落在**基类** .dsh-wf-btn 上 → 头部/弹窗/检查器共用同一套规则，这里把头部也量一遍。
  const head = await evaluate(cdp, `(() => {
    return [...document.querySelectorAll('.dsh-wf-header button')].map((b) => {
      const r = b.getBoundingClientRect();
      let tw = 0;
      try { const rg = document.createRange(); rg.selectNodeContents(b); tw = rg.getBoundingClientRect().width; } catch { tw = 0; }
      return { text: (b.textContent || '').trim().slice(0, 20), w: Math.round(r.width), tw: Math.round(tw), h: Math.round(r.height), overflow: b.scrollWidth > b.clientWidth + 1 };
    });
  })()`);
  console.log('  [diag] 头部按钮 =', JSON.stringify(head));
  const headOverflow = (head ?? []).filter((b) => b.overflow);
  ok(headOverflow.length === 0,
    `⑦ ★头部按钮文字不被裁（溢出 ${headOverflow.length} 个${headOverflow.length ? '：' + JSON.stringify(headOverflow.map((b) => b.text)) : ''}）`);
  const headStretched = (head ?? []).filter((b) => b.tw > 0 && b.w - b.tw > 40);
  ok(headStretched.length === 0,
    `⑧ ★头部按钮外框跟随文字（被拉满的 ${headStretched.length} 个${headStretched.length ? '：' + JSON.stringify(headStretched.map((b) => [b.text, b.w, b.tw])) : ''}）`);

  // 复原面板宽度，避免影响后续用例
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('.dsh-wf-right');
    panel.style.width = '';
    return true;
  })()`);
}
