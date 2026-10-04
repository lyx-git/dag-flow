// tmp-test/cdp/test-sched-run.mjs — 定时（宿主侧）触发的运行也要在画布上可见
// 用户真机反馈（2026-10-03）：「定时任务执行，工作流的状态不会变化」。
// 根因：逐节点状态轮询原来只挂在**手动点运行**那条路径上；定时是宿主调度器直跑，客户端毫不知情。
// 修法：宿主侧运行登记进同一张表（/run/status?name= 能查到，带 origin=schedule），
//       客户端加**后台监视器**：面板挂载期间轮询，任何来源的运行都点亮画布；跑完收敛到终态。
// 本用例证明的就是「客户端一下都没点，画布状态自己动起来」。
// 夹具：cdp-host.html?vars=1 + 控制口 POST /__host-run {name, ids, stage}（见 picker-server.mjs）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, eq, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&vars=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(600);

  // 画布上的节点 id（按 def 顺序）——用它当"运行路径"
  const ids = await evaluate(cdp, `(window.__df_def?.nodes ?? []).map((n) => n.id)`);
  ok(Array.isArray(ids) && ids.length >= 6, `① 拿到画布节点 id（${JSON.stringify(ids)}）`);

  const badges = () => evaluate(cdp, `(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      ok: q('.dsh-wf-fg-badge.is-ok'), run: q('.dsh-wf-fg-badge.is-run'), wait: q('.dsh-wf-fg-badge.is-wait'),
      cardRunning: q('.dsh-wf-fg-card.is-running'),
      headerRunning: !!document.querySelector('.dsh-wf-btn.is-running'),
      headerText: (document.querySelector('.dsh-wf-btn.is-running')?.textContent ?? '').trim(),
      cancel: q('.dsh-wf-btn.is-danger'),
    };
  })()`);

  // 起跑前：不应有任何运行态
  const before = await badges();
  eq(before.run, 0, '② 开面板时没有「运行中」节点');
  eq(before.headerRunning, false, '③ 头部也没有运行态');

  // 宿主侧开始跑（前 2 个节点完成、第 3 个在跑）——客户端**什么都不点**
  await evaluate(cdp, `(async () => {
    await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ${JSON.stringify(name)}, ids: ${JSON.stringify(ids)}, stage: 2 }) });
    return true;
  })()`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length >= 2`, { timeout: 12000 });
  const mid = await badges();
  ok(mid.ok >= 2, `④ 画布自己点亮了已完成节点（is-ok=${mid.ok}，客户端没点过运行）`);
  eq(mid.run, 1, '⑤ 有 1 个节点显示「运行中」（按运行路径依次点亮）');
  eq(mid.headerRunning, true, '⑥ 头部运行按钮进入动态运行态（自己动的，不是手动触发）');
  ok(mid.headerText.includes('运行中'), `⑥b 运行按钮文案为「运行中」（实际：${mid.headerText}）`);

  // 再推进到全部完成 → 收敛成终态、头部恢复
  await evaluate(cdp, `(async () => {
    await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ${JSON.stringify(name)}, ids: ${JSON.stringify(ids)}, stage: ${ids.length} }) });
    return true;
  })()`);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-badge.is-run').length === 0 && document.querySelectorAll('.dsh-wf-fg-badge.is-ok').length >= 1`, { timeout: 12000 });
  await waitFor(cdp, `!document.querySelector('.dsh-wf-btn.is-running')`, { timeout: 12000 });
  const after = await badges();
  eq(after.run, 0, '⑦ 跑完后没有「运行中」节点');
  ok(after.ok >= ids.length - 1, `⑧ 跑完后节点收敛为完成态（is-ok=${after.ok}/${ids.length}）`);
  eq(after.headerRunning, false, '⑨ 头部运行态自己恢复（无需人工干预）');

  // 画布结构不受影响（状态只是叠加在节点上）
  const struct = await evaluate(cdp, `({ nodes: document.querySelectorAll('.dsh-wf-fg-card').length, edges: (window.__df_def?.edges ?? []).length })`);
  ok(struct.nodes >= 6, `⑩ 画布节点未被状态刷新搞丢（nodes=${struct.nodes}）`);

  // ===== D. 「人工确认」节点在非交互（定时）运行里自动通过 → 必须显形（2026-10-04 用户拍板 A）=====
  //   用户原话：「定时任务自动触发的运行，手动确认节点自动跳过」；拍板：保持自动通过，但要看得见。
  const beforeAdd = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);
  await evaluate(cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('手动确认'));
      if (!item) return false;
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.42, ey = er.top + er.height * 0.62;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      return true;
    })(); true;
  `);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${beforeAdd >= 0 ? beforeAdd : 0}`, { timeout: 8000 });
  const manualId = await evaluate(cdp, `(window.__df_def?.nodes ?? []).find((n) => n.type === 'manual')?.id ?? ''`);
  ok(!!manualId, `⑪ 画布已加入「手动确认」节点（${manualId}）`);

  // 宿主侧再跑一遍：manual 的 out 就是非交互语义（autoPassed:true），客户端零点击
  await evaluate(cdp, `(async () => {
    await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: ${JSON.stringify(name)},
        ids: ${JSON.stringify(ids)}.concat([${JSON.stringify(manualId)}]),
        stage: ${ids.length + 1},
        outs: { [${JSON.stringify(manualId)}]: { prompt: '继续生成日报？', confirmed: true, autoPassed: true, value: '', confirmedAt: new Date().toISOString() } },
      }) });
    return true;
  })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-badge.is-auto')`, { timeout: 12000 });
  const autoBadge = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-badge.is-auto')?.textContent ?? ''`);
  ok(autoBadge.includes('自动通过'), `⑫ 画布徽标写明「⏭ 自动通过」而不是看着像被跳过（实际：${autoBadge.trim()}）`);

  // 悬浮该节点 → 悬浮卡解释「非交互运行自动通过，不是失败、也不代表有人确认过」
  await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge.is-auto'));
      if (el) el.dispatchEvent(new MouseEvent('mouseenter'));
      return !!el;
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-tip')`, { timeout: 4000 });
  const autoTip = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip').textContent`);
  ok(autoTip.includes('自动通过') && autoTip.includes('非交互运行'), `⑬ 悬浮卡解释自动通过（${JSON.stringify(autoTip.slice(0, 70))}…）`);
  ok(autoTip.includes('不代表有人确认过'), '⑭ 悬浮卡明确「不是失败、也不代表有人确认过」');
  await evaluate(cdp, `document.querySelector('.dsh-wf-fg-tip')?.dispatchEvent(new MouseEvent('mouseleave')); true;`);

  // ⏰ 弹窗里也要提前说清（本工作流含 manual 节点 → 不会停下来等确认）
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    b?.click();
    return !!b;
  })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-sched')`, { timeout: 8000 });
  const note = await evaluate(cdp, `document.querySelector('.dsh-wf-sched-note')?.textContent ?? ''`);
  ok(note.includes('人工确认') && note.includes('不会停下来等确认'), `⑮ ⏰ 弹窗提前说明「含人工确认节点 → 定时不会等确认」（${JSON.stringify(note.slice(0, 50))}…）`);
  await evaluate(cdp, `document.querySelector('.dsh-wf-sched .dag-flow-picker-close')?.click(); true;`);

  // 清掉模拟，避免影响后续用例（同一夹具服务器进程内是全局变量）
  await evaluate(cdp, `(async () => { await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clear: true }) }); return true; })()`);
}
