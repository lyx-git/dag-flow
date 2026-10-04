// tmp-test/cdp/test-view-controls.mjs
// 画布视图控件（2026-10-03 用户需求原话：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，
//   画布上的节点太小了，无法看清，最好可以一键放大缩小，方便修改」）。
// 夹具：?big=1（14 节点铺开 ~3300×1300，fit 只有 ~0.4 → 能同时压到两条 clamp）
//   ① 进画布默认缩放 = 75%（不是 fit 出来的 ~0.4，也不是 0.9 之类）
//   ② 「⤢ 适应画布」= 一键缩到全图，但有 50% 下限
//   ③ 「＋/−」按档位一键放大缩小（50%→75%→100% / 回到 75%）
//   ④ 点百分比读数 / 「1:1」= 一键回 100%
//   ⑤ 重新渲染（拖动节点 → def 同步 + 图层重渲染）后视图**不被重置**
//      （旧行为是 onAllLayersRendered 每次渲染都 fitView，那才是「适应画布按钮没用」的根因）
// 选择器一律用 title 前缀：按钮字形（−/＋/⤢/✨）是多字节字符，按文案精确匹配容易踩码位坑。
const byTitle = (prefix) => `[...document.querySelectorAll('.dsh-wf-fg-tb')].find((b) => (b.title || '').startsWith(${JSON.stringify(prefix)}))`;

export async function run({ cdp, evaluate, waitFor, ok, eq, sleep, name, base }) {
  await evaluate(cdp, `(() => { location.href = ${JSON.stringify(`${base}/cdp-host.html?name=${name}&big=1`)}; return true; })()`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-node').length >= 14`, { timeout: 20000 });
  await sleep(500);

  const zoomPct = async () => Number(String(await evaluate(cdp, `document.querySelector('.dsh-wf-fg-zoom')?.textContent ?? ''`)).replace('%', ''));
  const iv = () => evaluate(cdp, `window.__df_initialView ?? null`);
  const click = async (prefix) => {
    const hit = await evaluate(cdp, `(() => { const b = ${byTitle(prefix)}; if (!b) return false; b.click(); return true; })()`);
    ok(hit === true, `找到并点了「${prefix}」按钮`);
    await sleep(350);
  };

  // ① 进画布默认缩放
  const info = await iv();
  ok(!!info, '① __df_initialView 钩子存在（进画布设过视图）');
  ok(info?.rawFit !== null && info.rawFit < 0.6, `①a 大图按内容 fit 只有 ${info?.rawFit}（证明"太小"的根因确实存在）`);
  eq(info?.zoom, 0.75, '①b 默认缩放抬到 75%（看得清），不是 fit 出来的 ~0.4');
  eq(await zoomPct(), 75, '①c 工具栏百分比读数 = 75%');
  ok(info?.applied === true, '①d 视图真的应用了（scrollToView/updateConfig 成功）');
  // ★ 取景 C（2026-10-04）：本夹具是**大图**（rawFit≈0.4），入口节点本来就在可视区外
  //   → 应当做一次**最少平移**把它带进来；且**缩放不变**（平移不碰 zoom）。
  ok(info?.ensure?.shifted === true && info.ensure.dx < 0,
    `①e ★大图：入口不在可视区 → 取景 C 平移带进来（ensure=${JSON.stringify(info?.ensure)}）`);
  eq(await zoomPct(), 75, '①f 平移不改缩放（工具栏仍是 75%）');

  // ⑤ 重新渲染后视图不被重置：拖动节点（改坐标 → def 同步 → 图层重渲染）是最真实的场景
  //    注：点「✨ 整理」也会重渲染，但 **FlowGram 的自动布局自己会把视图适配全图**（实测 ~33%），
  //        那是引擎自带行为，不是我们要防的"每次渲染都 fitView"，所以这里用拖动来验。
  const beforeDrag = await zoomPct();
  const posBefore = await evaluate(cdp, `window.__df_node_pos?.('start') ?? null`);
  await evaluate(cdp, `(async () => {
    const card = document.querySelector('.dsh-wf-fg-card');
    const r = card.getBoundingClientRect();
    const x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    const fire = (type, x, y, el) => (el ?? document.elementFromPoint(x, y) ?? document).dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }));
    fire('pointerdown', x1, y1, card); fire('mousedown', x1, y1, card);
    for (let i = 1; i <= 3; i++) { fire('pointermove', x1 + 30 * i, y1 + 20 * i); fire('mousemove', x1 + 30 * i, y1 + 20 * i); }
    fire('pointerup', x1 + 100, y1 + 60, document); fire('mouseup', x1 + 100, y1 + 60, document);
    await new Promise((res) => setTimeout(res, 700));
    return true;
  })()`);
  await sleep(400);
  const posAfter = await evaluate(cdp, `window.__df_node_pos?.('start') ?? null`);
  ok(!!posBefore && !!posAfter && (posAfter.x !== posBefore.x || posAfter.y !== posBefore.y),
    `⑤a 拖动生效（start 世界坐标 ${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)}，确认发生了重渲染）`);
  eq(await zoomPct(), beforeDrag, '⑤ 拖动/重渲染后缩放不被重置（不再每次渲染 fitView）');
  eq((await iv())?.zoom, 0.75, '⑤b 一次性初始视图只设过那一次（钩子里的 zoom 未变）');

  // ② 适应画布：一键缩到全图，但有 50% 下限
  const visibleCount = () => evaluate(cdp, `(() => {
    const ed = document.querySelector('.dsh-wf-fg-editor').getBoundingClientRect();
    return [...document.querySelectorAll('.dsh-wf-fg-node')].map((n) => n.getBoundingClientRect())
      .filter((b) => b.right > ed.left && b.left < ed.right && b.bottom > ed.top && b.top < ed.bottom).length;
  })()`);
  const beforeFit = await visibleCount();
  await click('适应画布');
  const fit = await evaluate(cdp, `window.__df_lastFit`);
  ok(fit?.rawFit < 0.5, `②a 全图 fit 原始值 ${fit?.rawFit} < 50%（正是"看不清"的档位，下限必须生效）`);
  eq(fit?.zoom, 0.5, '②b 「适应画布」兜底到 50% 下限（看得全但不再看不清）');
  eq(await zoomPct(), 50, '②c 工具栏读数 = 50%');
  const afterFit = await visibleCount();
  ok(afterFit >= beforeFit, `②d 适应画布后可用视野不减少（可见节点 ${beforeFit} → ${afterFit}）`);
  ok(afterFit >= Math.ceil(14 * 0.5), `②e 下限档位下仍能看到大半张图（${afterFit}/14）`);

  // ③ 一键放大缩小（档位跳变）
  await click('放大');
  eq(await zoomPct(), 75, '③a 一键放大：50% → 75%（档位跳，不是 +10% 之类的碎步）');
  await click('放大');
  eq(await zoomPct(), 100, '③b 再放大：75% → 100%');
  await click('缩小');
  eq(await zoomPct(), 75, '③c 一键缩小：100% → 75%');

  // ④ 点百分比读数 / 「1:1」一键回 100%
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-zoom').click(); true;`);
  await sleep(350);
  eq(await zoomPct(), 100, '④a 点百分比读数 → 一键回 100%');
  await click('缩小');
  eq(await zoomPct(), 75, '④a2 先离开 100%（当前 75%）');
  await click('一键回到 100%');
  eq(await zoomPct(), 100, '④b 「1:1」按钮 → 一键回 100%');
  const zoomHook = await evaluate(cdp, `window.__df_lastZoom ?? null`);
  eq(zoomHook?.applied, true, '④c 缩放被真正应用（__df_lastZoom.applied=true）');

  // ⑤c 100% 下节点卡足够宽（改参数时可读）
  const cardW = await evaluate(cdp, `Math.round(document.querySelector('.dsh-wf-fg-node').getBoundingClientRect().width)`);
  ok(cardW > 150, `⑤c 100% 下节点卡宽度 ${cardW}px（改参数时可读）`);
}
