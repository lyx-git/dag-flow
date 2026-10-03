// tmp-test/cdp/test-manual-confirm.mjs — 人工确认（manual 节点）客户端链路
// 背景（2026-10-03 用户反馈「人工确认节点没作用」）：节点此前是空壳，工作流一路跑完。
// 现在（方案 A）host 撞上 manual 会返回 202 awaiting，客户端必须：
//   ① 头部出现「⏸ 等待人工确认」徽标（可点击重开弹窗）
//   ② 弹出确认弹窗（标题 + 节点标识 + prompt 原文 + 备注框 + 底部左取消/右确认）
//   ③ 填备注点「✓ 确认并继续」→ POST /run/resume 带 runId 与备注 → 弹窗收起、头部转 ✓
//   ④ 右上 ✕ 只关弹窗、运行继续等待（徽标仍在）
//   ⑤ 「✕ 取消本次运行」→ DELETE /run?name= → 徽标转「✗ 已取消」
// fixture：tmp-test/picker-server.mjs —— def 含 manual 节点即返回 202 awaiting
import { installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep }) {
  const openDlg = () => evaluate(cdp, `(() => { const el = document.querySelector('.dsh-wf-run-result.is-wait'); if (el) el.click(); return !!el; })()`);
  const dlgOpen = () => evaluate(cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`);

  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  const before = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);

  // ① 拖入「手动确认」节点
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
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${before >= 0 ? before : 0}`, { timeout: 8000 });
  ok(await evaluate(cdp, `window.__df_def.nodes.some((n) => n.type === 'manual')`), '画布已加入 manual（手动确认）节点');

  // ② 点 ▶ 运行 → fixture 返回 202 awaiting
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-run-result.is-wait')`, { timeout: 6000 });
  const chip = await evaluate(cdp, `document.querySelector('.dsh-wf-run-result.is-wait')?.textContent ?? ''`);
  ok(chip.includes('等待人工确认'), '头部出现等待徽标（实际：' + chip.trim() + '）');

  // ③ 确认弹窗自动打开 + 内容正确
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 5000 });
  const title = await evaluate(cdp, `document.querySelector('.dag-flow-picker-title')?.textContent ?? ''`);
  ok(title.includes('等待人工确认'), '弹窗标题为「⏸ 等待人工确认」');
  const tag = await evaluate(cdp, `document.querySelector('.dsh-wf-manual-tag')?.textContent ?? ''`);
  ok(/manual/.test(tag) && tag.length > 8, '弹窗显示节点标识（显示名_id + 类型）：' + tag.trim().slice(0, 60));
  const promptTxt = await evaluate(cdp, `document.querySelector('.dsh-wf-manual-prompt')?.textContent ?? ''`);
  ok(promptTxt.includes('请核对'), '弹窗显示 prompt 原文');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-manual-note') && !!document.querySelector('.dsh-wf-btn-danger') && !!document.querySelector('.dsh-wf-btn-primary')`), '弹窗含备注框 + 取消 + 确认三件套');

  // ④ 右上 ✕ 只关弹窗，运行继续等待
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-manual-acts') && document.querySelector('.dag-flow-picker-close').click(); })(); true;`);
  await sleep(200);
  ok(!(await dlgOpen()), '✕ 关闭了弹窗');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-run-result.is-wait')`), '✕ 之后运行仍在等待（徽标保留）');
  ok(await openDlg(), '点头部 ⏸ 徽标可重新打开弹窗');
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-manual-note')`, { timeout: 4000 });

  // ⑤ 填备注 → 确认并继续 → POST /run/resume
  await evaluate(cdp, `
    (() => {
      const ta = document.querySelector('.dsh-wf-manual-note');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '已核对，图 2 需替换');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })(); true;
  `);
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-primary').click(); })(); true;`);
  await waitFor(cdp, `(window.__df_reqs ?? []).some((r) => r.includes('/run/resume'))`, { timeout: 5000 });
  ok(true, '点「✓ 确认并继续」发出 POST /run/resume');
  const sentNote = await evaluate(cdp, `(window.__df_bodies ?? []).filter((b) => (b.url || '').includes('/run/resume')).map((b) => b.body).join('|')`);
  ok(/已核对/.test(sentNote) && /run-stub-manual/.test(sentNote), 'resume 请求体带 runId 与备注（' + sentNote.slice(0, 90) + '）');
  await waitFor(cdp, `!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 5000 });
  ok(!(await dlgOpen()), '确认后弹窗收起');
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-run-result') && !document.querySelector('.dsh-wf-run-result.is-wait')`, { timeout: 5000 });
  const after = await evaluate(cdp, `document.querySelector('.dsh-wf-run-result')?.textContent ?? ''`);
  ok(after.includes('✓'), '确认后头部转为运行成功（实际：' + after.trim().slice(0, 40) + '）');

  // ⑥ 取消路径：再跑一次 → 弹窗内点「✕ 取消本次运行」
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-run-result.is-wait')`, { timeout: 6000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 5000 });
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-danger').click(); })(); true;`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 5000 });
  const cancelled = await evaluate(cdp, `document.querySelector('.dsh-wf-run-result')?.textContent ?? ''`);
  ok(cancelled.includes('已取消'), '取消后头部显示「✗ 已取消」（实际：' + cancelled.trim() + '）');
  ok(await evaluate(cdp, `(window.__df_reqs ?? []).some((r) => r.includes('/run?name='))`), '取消走了 DELETE /run?name= 通道');

  // ⑦ 刷新页面 → 等待态从 localStorage + GET /run/status 恢复（契约里的「刷新可恢复」）
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 6000 });
  const beforeReload = await evaluate(cdp, `JSON.parse(localStorage.getItem('dag-flow:manual-wait') || '{}').runId ?? ''`);
  ok(!!beforeReload, '等待态已写入 localStorage（runId=' + beforeReload + '）');
  await cdp.send('Page.reload');
  await sleep(600);
  await installHelpers(cdp); // 刷新会清掉注入的 fetch 记录器
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 15000 });
  ok(true, '刷新页面后确认弹窗自动恢复（GET /run/status 查回等待态）');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-run-result.is-wait')`), '刷新后头部 ⏸ 徽标同样恢复');
  // 收尾：确认掉这次运行，并清 localStorage
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-primary').click(); })(); true;`);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-manual-prompt')`, { timeout: 6000 });
  await evaluate(cdp, `(() => { localStorage.removeItem('dag-flow:manual-wait'); })(); true;`);
}
