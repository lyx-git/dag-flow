// tmp-test/cdp/test-switch-many.mjs — switch 分支很多时：卡片**不变高** + chips 折叠 + 情况说明（2026-10-03 拍板 B）
// 用户原话：「如果有很多分支或者 chips 没展示出来，就在节点里面写明情况说明……节点保持和其他的节点大小一致」。
// 旧行为（本轮替换）：case ≥ 7 压行距 + 卡内标签全隐藏，卡片仍随分支数长高（8 case 时 142px，20 case 时 646px）。
// 夹具：cdp-host.html?many=1（8 个 case + '*' = 9 个出口，全部指向同一个目标）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&many=1`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 20000 });
  await installHelpers(cdp);

  // ① 卡内不再有逐行标签/行序号；只有一行 chips（3 个 + 「+6」折叠）
  const card = await evaluate(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('分支很多'));
    return {
      chips: [...c.querySelectorAll('.dsh-wf-fg-chip')].map((x) => x.textContent.trim()),
      rows: c.querySelectorAll('.dsh-wf-fg-rou').length,
      labels: [...c.querySelectorAll('.dsh-wf-fg-branch-label')].map((x) => x.textContent.trim()),
      note: c.querySelector('.dsh-wf-fg-card-note')?.textContent?.trim() ?? '',
      noteCount: c.querySelectorAll('.dsh-wf-fg-card-note').length,
      sub: c.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '',
      h: Math.round(c.getBoundingClientRect().height),
      minH: c.style.minHeight,
    };
  })()`);
  ok(card.rows === 0 && card.labels.length === 0, '① 卡内逐行标签/行序号全部删除（rows=' + card.rows + ' labels=' + JSON.stringify(card.labels) + '）');
  ok(JSON.stringify(card.chips) === JSON.stringify(['case1', 'case2', 'case3', '+6']),
    '① 一行 chips：前 3 个 + 「+6」折叠计数（8 case + 兜底 = 9 个出口），实际：' + JSON.stringify(card.chips));
  ok(card.noteCount === 1 && card.note.includes('还有 6 个分支未展示') && card.note.includes('先画线再在线上点选分支'),
    '① 卡内写明情况说明（实际：' + card.note + '）');

  // ② 卡片高度：与 case 数无关（恒定 91px + 溢出说明一行 16px = 107px），不再被分支数撑高
  ok(card.minH === '91px', '② minHeight 恒为 91px（与 case 数无关），实际：' + card.minH);
  ok(card.h === 107, '② 9 个出口时卡片 107px（= 91 + 一行说明；旧版 8 case 是 142px、20 case 是 646px），实际：' + card.h);
  ok(card.sub.includes('8 个分支'), '② 副标题仍报分支数（实际：' + card.sub + '）');
  ok(!card.sub.includes('紧凑'), '② 不再有「紧凑」档（行距/卡内标签的策略已整体删除）');

  // ③ 8 条 case 线一条不少（端口是连线锚点，收成一个视觉点但每个 case 仍各有端口）
  const lineKeys = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-line-label')].map((e) => e.textContent.trim()).filter((t) => /^case\\d+$/.test(t)).sort()`);
  ok(lineKeys.length === 8, '③ 8 条 case 连线都在（每条线中点仍有分支键标签）实际：' + JSON.stringify(lineKeys));
  ok(lineKeys[0] === 'case1' && lineKeys[7] === 'case8', '③ case 线标签完整 case1…case8');

  // ④ 多个 case 指向同一目标 ⇒ 标签精确重叠：按序号错开（否则叠成一坨读不出是哪个 case）
  const tops = await evaluate(cdp, `(() => {
    const els = [...document.querySelectorAll('.dsh-wf-fg-line-label')].filter((e) => /^case\\d+$/.test(e.textContent.trim()));
    return els.map((e) => Math.round(e.getBoundingClientRect().top)).sort((a, b) => a - b);
  })()`);
  const distinct = new Set(tops).size;
  ok(distinct === 8, '④ 8 条同名线的标签纵向错开（8 个不同 top），实际不同值 ' + distinct + ' 个：' + JSON.stringify(tops));

  // ⑤ 与 5 个出口的 ?chips 夹具（同样 3+「+2」折叠）高度完全一致 ⇒ 分支再多也不会把节点撑大
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}b&chips=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  const h5 = await evaluate(cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('多路分支：运行模式'));
    return { h: Math.round(c.getBoundingClientRect().height), chips: [...c.querySelectorAll('.dsh-wf-fg-chip')].map((x) => x.textContent.trim()) };
  })()`);
  ok(h5.h === 107, '⑤ 5 个出口时卡片也是 107px（与 9 个出口一致）实际：' + h5.h);
  ok(h5.h === card.h, '⑤ 分支数 5 → 9 卡片高度不变（' + h5.h + 'px == ' + card.h + 'px）');
}
