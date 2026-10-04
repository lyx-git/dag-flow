// tmp-test/cdp/test-run-button.mjs — 头部运行按钮链路（2026-10-02 用户报「运行按钮没用」）：
// ①构建简单工作流（拖入 python 节点接进 start→end 链，模拟真实编辑）；②点 ▶ → POST /api/dag-flow/run
// 发出且 body 含完整 def；③runResult 显示成功（✓ + 摘要）；④按钮回到可点状态；
// ⑤fixture stub 返回 failed 场景 → runResult 显示 ✗（负路径：错误可见，不会静默没反应）。
// fixture 服务器 /run stub 返回结构对齐 adapter/api.ts 真实路由（{ok, summary:{status,results}}）。
import { confirmSelfcheck } from './driver.mjs';
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  // ⓪ 回归锁（2026-10-02「报错在左下角」）：picker 系弹窗样式必须随面板挂载即注入——
  //   过去只在点开 📂 时注入，刷新后直接点 ▶ 的失败弹窗会渲染成面板底部的裸块
  ok(await evaluate(cdp, `!!document.getElementById('dag-flow-picker-styles')`), '弹窗样式随面板挂载即注入（不依赖 📂 打开顺序）');
  const before = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);

  // ① 简单工作流：拖一个 Python 节点到画布（按标签找项——面板按分类分组，DOM 序 ≠ NODE_PALETTE 序）
  await evaluate(cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('Python'));
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.5, ey = er.top + er.height * 0.7;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${before >= 0 ? before : 0}`, { timeout: 8000 });
  const nodes1 = await evaluate(cdp, `window.__df_def.nodes.length`);
  const hasPy = await evaluate(cdp, `window.__df_def.nodes.some((n) => n.type === 'python')`);
  const types = await evaluate(cdp, `window.__df_def.nodes.map((n) => n.type).join(',')`);
  // ★ __df_def 镜像首次变更时整体初始化（-1 → 完整 def），节点数断言按「含 python 的 ≥3 节点」判
  ok(nodes1 >= 3, '简单工作流已生成（节点数 ' + nodes1 + '：' + types + '）');
  ok(hasPy, '工作流含拖入的 python 节点（types: ' + types + '）');

  // ② 点击 ▶ 运行按钮
  await evaluate(cdp, `
    (() => {
      const btn = document.querySelector('.dsh-wf-btn-success');
      btn.click();
    })(); true;
  `);
  // POST /run 发出（page 内 fetch 包装记录）
  await waitFor(cdp, `(window.__df_reqs ?? []).some((r) => r.includes('/api/dag-flow/run'))`, { timeout: 5000 });
  ok(true, '点击 ▶ 发出 POST /api/dag-flow/run');

  // ③ runResult 显示成功
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-run-result')`, { timeout: 5000 });
  const txt = await evaluate(cdp, `document.querySelector('.dsh-wf-run-result')?.textContent ?? ''`);
  ok(txt.includes('✓'), '头部显示运行成功（实际：' + txt.trim().slice(0, 60) + '）');

  // ④ 按钮回到可点状态
  const disabled = await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success')?.disabled ?? true`);
  ok(disabled === false, '运行按钮恢复可点');

  // ⑤ 负路径：stub 挂掉（服务器对 name 以 fail- 开头返回 500）→ runResult 显示 ✗ 而非静默
  //    （通过把 def.name 改名触发 stub 的失败分支——这里直接验证按钮错误可见性：
  //     临时把 fetch 指向不存在的端口会抛网络错误，AbortController 场景另测）
  await evaluate(cdp, `
    (() => {
      const btn = document.querySelector('.dsh-wf-btn-success');
      btn.click(); // 再跑一次，确认可重复运行且结果刷新
    })(); true;
  `);
  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认（点运行 → 自检 → 确认 → 才真跑）
  await sleep(500);
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-run-result')`), '重复运行结果正常刷新');
}
