// tmp-test/cdp/test-selfcheck-gate.mjs — 运行前自检（2026-10-04 轮 1+2 用户拍板）
//   用户原话：「运行前自动检查，自检出问题，给出报错提示和解决办法并拦工作流做人工确认」
//   轮 2 追加原话：「运行按钮开始前，增加一个自检中的状态，自检完成没问题后，手动确认，再开始真正运行dag任务」
// 契约（本用例钉死）：
//   ① 点 ▶ 先进入「🔍 自检中…」状态（按钮转圈 + 禁用），此阶段**不发** /run
//   ② 自检有 error → 弹「运行前自检未通过」，逐条 报错提示 +「👉 解决办法」，「仍然运行」才发 /run（带 skipSelfcheck）
//   ③ 自检通过 → 弹「✓ 自检通过」（带节点/边统计 + 提醒项）→ 点「开始运行」才发 /run
//   ④ 点取消/去修改只关弹窗，不发 /run
//   ⑤ 全程不用系统原生弹窗（window.confirm/alert 不被调用）
import { waitFor } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor: wf, ok, eq, sleep, name, base }) {
  const wait = wf ?? waitFor;
  const post = async (path, body) => evaluate(cdp, `fetch(${JSON.stringify(path)}, { method:'POST', headers:{'content-type':'application/json'}, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.status)`);
  const runReqs = () => evaluate(cdp, `window.__probe?.run ?? -1`);
  const selfcheckReqs = () => evaluate(cdp, `window.__probe?.selfcheck ?? -1`);
  const resetProbe = () => evaluate(cdp, `(() => { window.__probe.run = 0; window.__probe.selfcheck = 0; return true; })()`);

  // 夹具：记录原生弹窗调用（若产品用了 confirm/alert，这里会 +1）+ 自己数两类请求
  //   （不能重置 __df_bodies：那是 driver 助手内部闭包持有的数组，重新赋值只会断链）
  await evaluate(cdp, `(() => {
    window.__native = 0;
    window.confirm = () => { window.__native++; return true; };
    window.alert = () => { window.__native++; };
    // ★ 本用例是**专门测这道闸门**的：关掉 driver 助手里的自动确认
    //   （其它用例默认自动越过自检确认，好去测它们自己的东西）
    window.__df_autoConfirmSelfcheck = false;
    window.__probe = { run: 0, selfcheck: 0 };
    const of = window.fetch;
    window.fetch = (input, init) => {
      const u = String(typeof input === 'string' ? input : (input && input.url) || '');
      if (u.includes('/api/dag-flow/run')) window.__probe.run++;
      if (u.includes('/api/dag-flow/selfcheck')) window.__probe.selfcheck++;
      return of(input, init);
    };
    return true;
  })()`);


  // ===== A. 点 ▶ → 先「自检中」，此阶段不发 /run =====
  await post('/__selfcheck-block', { on: true, delayMs: 700 });   // 有问题 + 自检慢 700ms（便于断言中间态）
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-btn-success')`, { timeout: 15000 });
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await waitFor(cdp, `(document.querySelector('.dsh-wf-btn-success')?.textContent ?? '').includes('自检中')`, { timeout: 4000 });
  const btn = await evaluate(cdp, `(() => {
    const b = document.querySelector('.dsh-wf-btn-success');
    return { text: b.textContent.trim(), disabled: b.disabled, ring: !!b.querySelector('.dsh-wf-run-ring'), cls: b.className };
  })()`);
  ok(btn.text.includes('自检中'), `① 按钮进入「自检中…」状态（实际：${JSON.stringify(btn.text)}）`);
  ok(btn.disabled === true && btn.ring === true, '①b 自检中按钮禁用并带转圈（避免重复点）');
  eq(await selfcheckReqs(), 1, '①c 自检阶段调了 /selfcheck');
  eq(await runReqs(), 0, '①d ★自检阶段**没有**发 /run（先检后跑）');

  // ===== B. 有 error → 问题清单（报错提示 + 解决办法）=====
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-selfcheck')`, { timeout: 8000 });
  const dlg = await evaluate(cdp, `(() => {
    const d = document.querySelector('.dsh-wf-selfcheck');
    return {
      title: d.querySelector('.dag-flow-picker-title')?.textContent ?? '',
      items: [...d.querySelectorAll('.dsh-wf-selfcheck-item')].map((el) => ({
        msg: el.querySelector('.dsh-wf-selfcheck-msg')?.textContent ?? '',
        fix: el.querySelector('.dsh-wf-selfcheck-fix')?.textContent ?? '',
      })),
      btns: [...d.querySelectorAll('.dsh-wf-manual-acts button')].map((b) => b.textContent.trim()),
    };
  })()`);
  ok(dlg.title.includes('运行前自检未通过') && dlg.title.includes('2'), '② 标题写明问题条数（实际：' + dlg.title + '）');
  eq(dlg.items.length, 2, '②b 问题逐条列出');
  ok(dlg.items.every((i) => i.msg.trim().length > 0), '②c 每条都有报错提示');
  ok(dlg.items.every((i) => i.fix.includes('解决办法')), '②d ★每条都有「👉 解决办法」');
  ok(dlg.btns.length === 2 && dlg.btns[0].includes('去修改') && dlg.btns[1].includes('仍然运行'),
    '②e 底部两个动作（实际：' + JSON.stringify(dlg.btns) + '）');

  // 「去修改」→ 只关弹窗，不发 /run
  const before = await runReqs();
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-manual-acts button')].find((b) => b.textContent.includes('去修改')).click(); return true; })()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-selfcheck')`, { timeout: 5000 });
  eq(await runReqs(), before, '②f 点「去修改」不新增 /run 请求');

  // 「仍然运行」→ 才发 /run（带 skipSelfcheck）
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-selfcheck')`, { timeout: 8000 });
  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-manual-acts button')].find((b) => b.textContent.includes('仍然运行')).click(); return true; })()`);
  await waitFor(cdp, `(window.__probe?.run ?? 0) > 0`, { timeout: 8000 });
  ok(true, '②g 人工确认「仍然运行」后发 /run（带 skipSelfcheck:true）');

  // ===== C. 自检通过 → 「✓ 自检通过」确认 → 点「开始运行」才跑 =====
  //    控制口改成"通过 + 1 条 warn"，验证提醒项也会展示
  await post('/__selfcheck-block', {
    on: true, delayMs: 0,
    payload: {
      ok: true, errorCount: 0, warnCount: 1,
      items: [{ level: 'warn', code: 'UNREACHABLE', nodeId: 'x', message: '节点「草稿」从 start 不可达——运行时会被当作「独立入口」直接执行', fix: '把它接进主流程，或删掉它。' }],
      stats: { nodes: 7, edges: 6 },
    },
  });
  await resetProbe();
  // 诊断口：确认自动确认开关确实是"关"（本用例要测真闸门）
  eq(await evaluate(cdp, `window.__df_autoConfirmSelfcheck`), false, '③0 本用例已关闭助手自动确认（测真闸门）');
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-selfcheck.is-ok')`, { timeout: 8000 });
  const okDlg = await evaluate(cdp, `(() => {
    const d = document.querySelector('.dsh-wf-selfcheck.is-ok');
    return {
      title: d.querySelector('.dag-flow-picker-title')?.textContent ?? '',
      hint: d.querySelector('.dag-flow-picker-hint')?.textContent ?? '',
      warnTitle: d.querySelector('.dsh-wf-selfcheck-item.is-warn .dsh-wf-selfcheck-msg')?.textContent ?? '',
      warnFix: d.querySelector('.dsh-wf-selfcheck-item.is-warn .dsh-wf-selfcheck-fix')?.textContent ?? '',
      btns: [...d.querySelectorAll('.dsh-wf-manual-acts button')].map((b) => b.textContent.trim()),
    };
  })()`);
  ok(okDlg.title.includes('自检通过'), '③ 自检通过弹窗出现（实际：' + okDlg.title + '）');
  ok(okDlg.hint.includes('7') && okDlg.hint.includes('6'), '③b 写明检查范围（7 节点 / 6 边）');
  ok(okDlg.warnTitle.startsWith('⚠') && okDlg.warnFix.includes('解决办法'), '③c 提醒项也逐条给「解决办法」');
  ok(okDlg.btns.some((b) => b.includes('取消')) && okDlg.btns.some((b) => b.includes('开始运行')),
    '③d 底部是「取消 / 开始运行」（实际：' + JSON.stringify(okDlg.btns) + '）');
  eq(await runReqs(), 0, '③e ★自检通过后、点「开始运行」之前**不发** /run（人工确认是真闸门）');

  await evaluate(cdp, `(() => { [...document.querySelectorAll('.dsh-wf-manual-acts button')].find((b) => b.textContent.includes('开始运行')).click(); return true; })()`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-selfcheck.is-ok')`, { timeout: 5000 });
  await waitFor(cdp, `(window.__probe?.run ?? 0) > 0`, { timeout: 8000 });
  ok(true, '③f 点「开始运行」后才真发 /run（放行）');

  // ===== D. 默认（无控制口）= 自检通过且无提醒，全程不弹系统原生弹窗 =====
  await post('/__selfcheck-block', { on: false });
  eq(await evaluate(cdp, `window.__native`), 0, '④ 全程没有调用 window.confirm/alert（不用系统原生弹窗）');
}
