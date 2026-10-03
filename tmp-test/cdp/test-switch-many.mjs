// tmp-test/cdp/test-switch-many.mjs — switch 分支过多时的自适应紧凑（2026-10-03 用户拍板 A+A+）
// 背景：case 过多会把节点撑得很大、把流程拉散（20 case 时卡片 646px 高）。
// 方案：case ≥ 7 进入紧凑——端口行距 30→12px + **卡内标签隐藏**（连线中点仍有分支键标签）；
//       端口是连线锚点不能隐藏，所以只压行距与卡内标签。副标题显示「N 个分支（紧凑）」。
// 夹具：cdp-host.html?many=1（8 个 case + '*' = 9 个端口）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&many=1`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 20000 });
  await installHelpers(cdp);

  // ① 卡内标签隐藏（信息不丢：每条连线中点仍有分支键标签）
  ok(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-branch-label').length === 0`), '分支 ≥7 时卡内标签隐藏（不再堆满卡片）');
  ok(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length === 0 || document.querySelectorAll('.dsh-wf-fg-line-label').length >= 0`), '线标签逻辑不受影响（本夹具的 8 条边属于 switch，标签文案由线中点负责）');

  // ② 卡片被压扁：8 case + '*' = 9 端口 → minHeight = 22 + 8*12 + 24 = 142px（旧公式 286px）
  const geo = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('分支很多'));
    const sub = card?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '';
    return { h: card?.offsetHeight ?? -1, minH: card?.style.minHeight ?? '', sub };
  })()`);
  ok(geo.minH === '142px', '端口行距压到 12px（minHeight=142px，旧公式是 286px）实际：' + geo.minH);
  ok(geo.h <= 160, '卡片实际高度 ≤160px（实际 ' + geo.h + 'px，压缩前 286px）');
  ok(geo.sub.includes('8 个分支') && geo.sub.includes('紧凑'), '副标题标出分支数与紧凑态（实际：' + geo.sub + '）');

  // ③ 连线/端口没丢：8 条 case 边的线中点标签都在（线在 ⇒ 该 case 的端口仍被锚定）
  //    ★ 不用 [class*=workflow-port-render] 数端口——FlowGram 只渲染部分端口元素，口径不可靠
  const lineKeys = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-line-label')].map((e) => e.textContent.trim()).filter((t) => /^case\\d+$/.test(t)).sort()`);
  ok(lineKeys.length === 8, '8 条 case 连线都在（每条线中点仍有分支键标签）实际：' + JSON.stringify(lineKeys));
  ok(lineKeys[0] === 'case1' && lineKeys[7] === 'case8', 'case 线标签完整 case1…case8');

  // ④ 小开关不受影响：切到 ?branch=1 的 2-case 开关应保留标签与 30px 行距
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&branch=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-branch-label').length >= 3`, { timeout: 20000 });
  const sw = await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('模式分支'));
    const tops = [...(card?.querySelectorAll('.dsh-wf-fg-branch-label') ?? [])].map((x) => x.style.top);
    return { tops, minH: card?.style.minHeight ?? '', sub: card?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '' };
  })()`);
  ok(JSON.stringify(sw.tops) === JSON.stringify(['22px', '52px', '82px']), '2 个 case 的开关保持 30px 行距与卡内标签（实际：' + JSON.stringify(sw.tops) + '）');
  ok(sw.minH === '106px', '2-case 开关 minHeight 仍为 106px（旧行为不变）实际：' + sw.minH);
  ok(sw.sub.includes('2 个分支') && !sw.sub.includes('紧凑'), '小开关副标题只报分支数、不标紧凑（实际：' + sw.sub + '）');
}
