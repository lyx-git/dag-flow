// tmp-test/cdp/test-inspector-switch.mjs — 参数面板状态跟随选中节点（2026-10-02 用户反馈：
// 试跑 python 后切换到 log 节点，结果信息仍显示 python 的——面板状态串节点）。
// 修复=NodeInspector 加 key=节点 id，切节点重挂载（试跑结果/试跑输入/模型下拉全部重置）。
// ①拖两个可试跑节点（python/log）进画布；②选中 python → 试跑 → 结果显示 STUB_OUTPUT_python；
// ③切选中 log → 面板切到 log（节点 ID 变化）且结果区不渲染（python 的结果不串显）；
// ④切回 python → 结果区也为空（重挂载已重置）。
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });

  // 工具：按标签拖入节点到画布
  const dragIn = (label, ux, uy) => evaluate(cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('${label}'));
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * ${ux}, ey = er.top + er.height * ${uy};
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);

  // ① 拖 python 和 log 两个节点
  await dragIn('Python', 0.5, 0.55);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) >= 3`, { timeout: 8000 });
  await dragIn('日志', 0.68, 0.35);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) >= 4`, { timeout: 8000 });
  // ★ def 镜像先行、卡片渲染晚几帧（fromJSON 管线延迟）——两张卡都出现再进入选中步骤
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].filter((el) => (el.textContent || '').includes('Python') || (el.textContent || '').includes('日志')).length >= 2`, { timeout: 15000 });

  // 工具：按类型点选画布节点（复用 __df_clickNode：直接在 host 元素上 fire，不怕缩略图遮挡）
  const selectNode = (type) => evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      const idx = cards.findIndex((el) => el.textContent.includes('${type}'));
      if (idx < 0) throw new Error('找不到 ${type} 节点卡');
      return window.__df_clickNode(idx);
    })(); true;
  `);

  // 工具：按类型点选画布节点（复用 __df_clickNode：直接在 host 元素上 fire，不怕缩略图遮挡）。
  // ★ 选中偶发竞态（FlowGram 层吞合成 click）——waitFor 面板出现，未出现则重试点击（最多 3 次）
  const selectNodeUntilPanel = async (type) => {
    for (let i = 0; i < 3; i++) {
      await selectNode(type);
      try {
        await waitFor(cdp, `
          (() => {
            const rows = [...document.querySelectorAll('.dsh-wf-panel-row')];
            const idRow = rows.find((row) => row.textContent.includes('节点 ID'));
            return idRow && idRow.querySelector('input')?.value === window.__df_def.nodes.find((n) => n.type === '${type === 'Python' ? 'python' : type === '日志' ? 'log' : type}')?.id;
          })()
        `, { timeout: 4000 });
        return;
      } catch { /* 重试 */ }
    }
    throw new Error('选中 ' + type + ' 后面板未出现（重试 3 次）');
  };

  // ② 选中 python → 面板显示 python → 试跑 → 结果区出现 STUB_OUTPUT_python
  await selectNodeUntilPanel('Python');
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-panel-row') && (document.body.textContent.includes('🧪 单节点试跑'))`, { timeout: 5000 });
  const idShown1 = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((row) => row.textContent.includes('节点 ID') && (window.__df_def.nodes.find((n) => n.type === 'python')?.id ?? '').length > 0 && row.querySelector('input')?.value === window.__df_def.nodes.find((n) => n.type === 'python')?.id)`);
  ok(idShown1, '面板显示 python 节点 ID');
  await evaluate(cdp, `
    (() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('试跑本节点'));
      btn.click();
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-test-result') && document.querySelector('.dsh-wf-test-result').textContent.includes('STUB_OUTPUT_python')`, { timeout: 8000 });
  ok(true, 'python 试跑结果出现（STUB_OUTPUT_python）');

  // ③ 切选中 log → 面板切到 log，结果区不渲染（python 结果不串显）
  // ★ 拖入后 fromJSON 重建管线会让卡片短暂消失——selectNode 前先等两张卡都在（时序防御）
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].filter((el) => (el.textContent || '').includes('Python') || (el.textContent || '').includes('日志')).length >= 2`, { timeout: 15000 });
  await selectNodeUntilPanel('日志');
  await waitFor(cdp, `
    (() => {
      const rows = [...document.querySelectorAll('.dsh-wf-panel-row')];
      const idRow = rows.find((row) => row.textContent.includes('节点 ID'));
      return idRow && idRow.querySelector('input')?.value === window.__df_def.nodes.find((n) => n.type === 'log')?.id;
    })()
  `, { timeout: 5000 });
  ok(true, '切换后面板已切到 log 节点');
  eq(await evaluate(cdp, `document.querySelector('.dsh-wf-test-result')?.textContent ?? ''`), '', 'log 节点面板不显示 python 的试跑结果');

  // ④ 切回 python → 结果区也已重置为空
  await selectNode('Python');
  await waitFor(cdp, `
    (() => {
      const rows = [...document.querySelectorAll('.dsh-wf-panel-row')];
      const idRow = rows.find((row) => row.textContent.includes('节点 ID'));
      return idRow && idRow.querySelector('input')?.value === window.__df_def.nodes.find((n) => n.type === 'python')?.id;
    })()
  `, { timeout: 5000 });
  eq(await evaluate(cdp, `document.querySelector('.dsh-wf-test-result')?.textContent ?? ''`), '', '切回 python 结果区也已重置（不残留）');
}
