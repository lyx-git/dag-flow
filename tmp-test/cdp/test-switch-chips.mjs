// tmp-test/cdp/test-switch-chips.mjs — switch 单点端口 + chips 选分支（2026-10-03 用户拍板 B）
// 用户原话：「switch 节点里面的端口行去掉，保留 chips，选择哪个 chips，画线带出来的就是哪个分支，
//   如果有很多分支或者 chips 没展示出来，就在节点里面写明情况说明，先画线，再在线上选择需要的 case 分支，
//   节点保持和其他的节点大小一致」。
// 夹具：cdp-host.html?chips=1（sw_chips：4 个 case + 引擎兜底 '*' = 5 个出口，一行放不下 → 3 个 + 「+2」）
import { goto, installHelpers, dragUntil } from './driver.mjs';

const SW_CARD = `多路分支：运行模式`;

/** 起线（2026-10-04 轮 7 改造）：改用 driver 的 **真实鼠标输入**（CDP Input.dispatchMouseEvent）——
 *  原实现派发合成 MouseEvent，与 playground 的 hover/drag 状态机时序对不上，是本案长期抖动的根因。
 *  起线后等快选面板出现（手势最多重试 3 次）；返回的 hit 信息保持原样（失败时用于定位起点命中了谁）。 */
async function dragFrom(cdp, evaluate, x, y, dropX, dropY) {
  const hit = await evaluate(cdp, `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    return { hitTag: el?.tagName ?? '', hitCls: typeof el?.className === 'string' ? el.className : (el?.className?.baseVal ?? '[svg]') };
  })()`);
  await dragUntil(cdp, { x, y }, { x: dropX, y: dropY }, `!!document.querySelector('.dsh-wf-fg-quick')`);
  return hit;
}

/** 起线起点 = 卡片右边缘那个**可见端口圆点**的中心（switch 的所有出口端口重合在这一个点上，就是这个点）；
 *  落点 = 编辑器里一处**没有节点卡**的空白（否则会直接连到那个节点、不弹快选面板） */
const geoExpr = (dropXRatio) => `(() => {
  const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
  const er = document.querySelector('.dsh-wf-fg-editor').getBoundingClientRect();
  const r = card.getBoundingClientRect();
  const dots = [...document.querySelectorAll('.workflow-point-bg')]
    .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })
    .filter((p) => p.x > r.right - 24 && p.x < r.right + 24 && p.y > r.top && p.y < r.bottom);
  const p = dots[0] ?? { x: Math.round(r.right + 1), y: Math.round(r.top + r.height / 2) };
  const cards = [...document.querySelectorAll('.dsh-wf-fg-card')].map((c) => c.getBoundingClientRect());
  let drop = { x: Math.round(er.left + er.width * ${dropXRatio}), y: Math.round(er.top + er.height * 0.82) };
  for (let dx = 0; dx <= 0.36 && cards.some((c) => drop.x > c.left - 70 && drop.x < c.right + 70 && drop.y > c.top - 70 && drop.y < c.bottom + 70); dx += 0.06) {
    for (let dy = 0; dy <= 0.36; dy += 0.06) {
      const x = er.left + er.width * (${dropXRatio} + dx), y = er.top + er.height * (0.7 + dy);
      if (x > er.right - 30 || y > er.bottom - 30) break;
      if (!cards.some((c) => x > c.left - 70 && x < c.right + 70 && y > c.top - 70 && y < c.bottom + 70)) { drop = { x: Math.round(x), y: Math.round(y) }; dx = 9; break; }
    }
  }
  return { x: p.x, y: p.y, portCount: dots.length, cardCenterY: Math.round(r.top + r.height / 2), dropX: drop.x, dropY: drop.y };
})()`;

/** 起线 → 快选面板选 python → 返回新建节点 id + 该新线的 when */
async function drawLine({ cdp, evaluate, waitFor }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 8000 });
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('.dsh-wf-fg-quick-search');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, 'python');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })(); true;
  `);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 6000 });
  await waitFor(cdp, `
    (() => {
      const d = window.__df_def ?? {};
      const py = (d.nodes ?? []).filter((n) => n.type === 'python');
      return py.length > 0 && (d.edges ?? []).some((e) => e.from === 'sw_chips' && e.to === py[py.length - 1].id);
    })()
  `, { timeout: 8000 });
  return evaluate(cdp, `
    (() => {
      const d = window.__df_def ?? {};
      const py = (d.nodes ?? []).filter((n) => n.type === 'python');
      const id = py[py.length - 1]?.id;
      const e = (d.edges ?? []).find((x) => x.from === 'sw_chips' && x.to === id);
      return {
        nodeId: id, when: e ? (e.when ?? null) : '__NO_EDGE__',
        edgeCountFromSwitch: (d.edges ?? []).filter((x) => x.from === 'sw_chips').length,
        chipClickHook: window.__df_lastChipClick ?? null,
      };
    })()
  `);
}

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  // ★ 2026-10-04 轮 7：等画布"热"起来再做第一次手势（页面刚渲染完时端口 hover 状态机未就绪 →
  //   按下不起线；诊断见 tmp-test/cdp/diag-port-hover.mjs）
  await sleep(600);

  // ===== ① 端口行删除 + 卡片只剩一行 chips =====
  const info = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    const plain = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('log_1'));
    const r = card.getBoundingClientRect();
    const pr = plain?.getBoundingClientRect();
    return {
      h: Math.round(r.height), w: Math.round(r.width), plainH: Math.round(pr?.height ?? 0),
      minH: card.style.minHeight,
      chips: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.textContent.trim()),
      rowTexts: [...card.querySelectorAll('.dsh-wf-fg-branch-label')].map((c) => c.textContent.trim()),
      rows: [...card.querySelectorAll('.dsh-wf-fg-rou')].map((c) => c.textContent.trim()),
      note: card.querySelector('.dsh-wf-fg-card-note')?.textContent?.trim() ?? '',
      sub: card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '',
      noteLines: card.querySelectorAll('.dsh-wf-fg-card-note').length,
    };
  })()`);
  ok(info.rows.length === 0, '① 端口行（逐行序号）已删除，实际：' + JSON.stringify(info.rows));
  ok(info.rowTexts.length === 0, '① 卡内逐行分支标签已删除，实际：' + JSON.stringify(info.rowTexts));
  ok(info.chips.length === 4 && info.chips[3] === '+2',
    '① 一行 chips：前 3 个 + 「+2」折叠计数（4 个 case + 兜底 = 5 个出口），实际：' + JSON.stringify(info.chips));
  ok(info.note.includes('还有 2 个分支未展示') && info.note.includes('先画线再在线上点选分支'),
    '① 卡内写明情况说明（' + info.note + '）');
  ok(info.noteLines === 1, '① 说明只占一行（不换行、不撑高卡片）');
  ok(info.minH === '91px', '① 卡片高度恒定 91px（与分支数无关），实际 minHeight=' + info.minH);
  ok(Math.abs(info.h - 107) <= 1, '① 5 个出口时卡片 107px（= 91 恒定高 + 一行溢出说明 16px，旧版逐行标签 166px），实际 ' + info.h + 'px');
  ok(info.plainH === 78 && info.h - info.plainH <= 30,
    '① 与普通节点大小接近（switch ' + info.h + 'px vs 普通节点 ' + info.plainH + 'px：只多一行 chips + 一行溢出说明）');
  ok(info.sub.includes('先画线，再在线上点选分支'), '① 未选中时副标题给出操作提示（实际：' + info.sub + '）');

  // ===== ② 点 chip = 选中该分支（拖线即带）；再点一次 = 取消 =====
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('video'));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(250);
  const sel = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    return {
      sel: [...card.querySelectorAll('.dsh-wf-fg-chip.is-sel')].map((c) => c.textContent.trim()),
      sub: card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '',
      hook: window.__df_lastChipClick ?? null,
    };
  })()`);
  ok(sel.sel.length === 1 && sel.sel[0].includes('video') && sel.sel[0].includes('✓'),
    '② 点击 video chip → 唯一选中态（✓ video），实际：' + JSON.stringify(sel.sel) + ' 钩子=' + JSON.stringify(sel.hook));
  ok(sel.sub.includes('已选 video'), '② 副标题给出反馈「已选 video（拉线即带）」，实际：' + sel.sub);
  // 再点一次 → 取消（回到「先画线，再在线上点选」）
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('video'));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(250);
  ok(await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    return card.querySelectorAll('.dsh-wf-fg-chip.is-sel').length === 0
      && (card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '').includes('先画线');
  })()`), '② 再点一次 → 取消选中（无 .is-sel，副标题回到操作提示）');

  // ===== ③ 真机语义：选中 video 后从该节点端口拉线 → 新线自带 video 分支键 =====
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('video'));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(250);
  const geo = await evaluate(cdp, geoExpr('0.62'));
  const hit = await dragFrom(cdp, evaluate, geo.x, geo.y, geo.dropX, geo.dropY);
  const drawn = await drawLine({ cdp, evaluate, waitFor });
  ok(drawn.when === 'video', '③ 选中 video 后拉出的线自带分支键 video（when=' + JSON.stringify(drawn.when)
    + '；起点命中 ' + hit.hitTag + '.' + hit.hitCls + '；switch 输出端口元素 ' + geo.portCount + ' 个）');

  // ===== ④ 未选中任何 chip 时拉线 → 不带分支键（先画线，再在线上点选）=====
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}b&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  await sleep(600);   // ★ 轮 7：每次 goto 到新页面后都要等画布热起来再起线（见文件头注释）
  const geo2 = await evaluate(cdp, geoExpr('0.62'));
  const hit2 = await dragFrom(cdp, evaluate, geo2.x, geo2.y, geo2.dropX, geo2.dropY);
  const drawn2 = await drawLine({ cdp, evaluate, waitFor });
  ok(drawn2.when === 'out', '④ 未选中 chip → 新线不带 case（when=' + JSON.stringify(drawn2.when)
    + '；起点命中 ' + hit2.hitTag + '.' + hit2.hitCls + '）');
  ok(drawn2.when !== 'video' && drawn2.when !== 'quick' && drawn2.when !== 'image' && drawn2.when !== 'full',
    '④ 未选中 == 没有偷偷带某个 case（when=' + JSON.stringify(drawn2.when) + '）');
  ok(drawn2.edgeCountFromSwitch === 5, '④ 原 4 条 case 边 + 新线都在（switch 出边 ' + drawn2.edgeCountFromSwitch + ' 条 = 4 + 1，无丢失）');

  // ===== ⑤ 已画出的线不受影响：老 case 线的标签仍在（改写只针对新线）=====
  const labels = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-line-label')].map((e) => e.textContent.trim()).sort()`);
  ok(['full', 'image', 'quick', 'video'].every((k) => labels.includes(k)),
    '⑤ 原有 4 条 case 线标签仍在（实际：' + JSON.stringify(labels) + '）');
  ok(labels.includes('未设分支'), '⑤ ④ 里未选中画出的那条线是「未设分支」，不会静默变成「其他」*（实际：' + JSON.stringify(labels) + '）');
  const adopt = await evaluate(cdp, `window.__df_lastLineAdopt ?? null`);
  ok(adopt && adopt.want === 'out',
    '⑤ 未选中 → 归属目标恒为 out（夹具里引擎本来就命中 out 端口，故 applied 可能为 false；真机命中的是 * 兜底端口，'
    + '同一分支会把它改写成 out）实际：' + JSON.stringify(adopt));

  // ===== ⑥ 先画一条（不选）再画一条（选 full）→ 各归各的，老线不被改写 =====
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}c&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  await sleep(600);   // ★ 轮 7：同上（新页面 → 等画布热起来）
  const g1 = await evaluate(cdp, geoExpr('0.6'));
  await dragFrom(cdp, evaluate, g1.x, g1.y, g1.dropX, g1.dropY);
  const d1 = await drawLine({ cdp, evaluate, waitFor });
  ok(d1.when === 'out', '⑥ 第一条（未选中）→ out，实际 ' + JSON.stringify(d1.when));
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.trim() === 'full');
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(250);
  const g2 = await evaluate(cdp, geoExpr('0.66'));
  await dragFrom(cdp, evaluate, g2.x, g2.y, g2.dropX, g2.dropY);
  const d2 = await drawLine({ cdp, evaluate, waitFor });
  ok(d2.when === 'full', '⑥ 第二条（选中 full）→ full，实际 ' + JSON.stringify(d2.when));
  ok(await evaluate(cdp, `
    (() => {
      const d = window.__df_def ?? {};
      const outs = (d.edges ?? []).filter((e) => e.from === 'sw_chips' && e.when === 'out');
      const fulls = (d.edges ?? []).filter((e) => e.from === 'sw_chips' && e.when === 'full');
      return outs.length === 1 && fulls.length === 2;
    })()
  `), '⑥ 老线不被改写：恰好 1 条 out（第一条）+ 2 条 full（原有 full 线 + 新画那条）');

  // ===== ⑦ 折叠的 case 要能看到/能选（真机反馈「手动再选择没看到 case」）=====
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}d&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}))`, { timeout: 20000 });
  const folded = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    return { chips: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.textContent.trim()),
      note: !!card.querySelector('.dsh-wf-fg-card-note'), h: Math.round(card.getBoundingClientRect().height) };
  })()`);
  ok(folded.chips.length === 4 && !folded.chips.includes('image'), '⑦ 默认折叠：image 被折进「+2」（实际：' + JSON.stringify(folded.chips) + '）');
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const more = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.trim() === '+2');
      more.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(300);
  const opened = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    return { chips: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.textContent.trim()),
      expanded: !!card.querySelector('.dsh-wf-fg-chips.is-expanded'),
      note: !!card.querySelector('.dsh-wf-fg-card-note'), h: Math.round(card.getBoundingClientRect().height) };
  })()`);
  ok(opened.expanded && opened.chips.includes('image') && opened.chips.includes('其他') && opened.chips.includes('收起'),
    '⑦ 点「+2」展开：全部 case 都露出来（实际：' + JSON.stringify(opened.chips) + '）');
  ok(!opened.note, '⑦ 展开后不再显示「还有 N 个分支未展示」说明');
  ok(opened.h > folded.h, '⑦ 展开态卡片变高（' + folded.h + '→' + opened.h + 'px，用户主动触发的临时高度）');
  // 展开后能直接选中被折叠的那个 case（image），再收起
  await evaluate(cdp, `
    (() => {
      const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
      const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('image'));
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `);
  await sleep(250);
  ok(await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(SW_CARD)}));
    return [...card.querySelectorAll('.dsh-wf-fg-chip.is-sel')].some((c) => c.textContent.includes('image'));
  })()`), '⑦ 展开后可以选中被折叠的 case（✎ image 出现 ✓ 选中态）');
}
