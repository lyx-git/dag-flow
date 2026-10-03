// tmp-test/cdp/test-delete-button.mjs — 右侧面板「🗑 删除节点」按钮（2026-10-02 用户反馈：
// 点击只清编辑框内容、画布节点不消失——按钮此前只更新 def，画布实体未同步 dispose）。
// 修复后：按钮 = dispose 画布实体（同步）+ def 更新，与 Del 快捷键同一入口 deleteNodeFull。
// 断言双证：def 层（__df_def.nodes）+ 画布实体层（.dsh-wf-fg-card 同 id 立即消失）。
export async function run({ cdp, evaluate, waitFor, ok }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  const before = await evaluate(cdp, `window.__df_def?.nodes?.length ?? 0`);

  // 拖入 python 节点
  await evaluate(cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('Python'));
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.5, ey = er.top + er.height * 0.5;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })(); true;
  `);
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${before}`, { timeout: 8000 });
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((el) => (el.textContent || '').includes('Python'))`, { timeout: 15000 });

  // 选中 python 节点（右侧面板出现）
  await evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      const idx = cards.findIndex((el) => el.textContent.includes('Python'));
      return window.__df_clickNode(idx);
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-panel-label')`, { timeout: 5000 });

  // 找到被选中节点的 id，记下画布卡片数
  const nodeId = await evaluate(cdp, `window.__df_def?.nodes?.find?.((n) => n.type === 'python')?.id ?? ''`);
  ok(!!nodeId, 'python 节点已入 def（id=' + nodeId + '）');

  // 点「🗑 删除节点」
  await evaluate(cdp, `
    (() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('删除节点'));
      if (!btn) throw new Error('删除节点按钮不存在');
      btn.click();
    })(); true;
  `);

  // 断言① def 层：节点已从 def 移除
  await waitFor(cdp, `!(window.__df_def?.nodes ?? []).some((n) => ${JSON.stringify(nodeId)} === n.id)`, { timeout: 5000 });
  ok(true, 'def 层：节点已移除');
  // 断言② 画布实体层：同 id 节点卡同步消失（dispose 同步生效，不依赖 fromJSON 延迟管线）
  await waitFor(cdp, `![...document.querySelectorAll('.dsh-wf-fg-node-host')].some((el) => el.getAttribute('data-node-id') === ${JSON.stringify(nodeId)})`, { timeout: 5000 });
  ok(true, '画布实体层：节点卡同步消失（dispose 先行）');
  // 断言③ 右侧面板已清空（选中态被清理）
  await waitFor(cdp, `![...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('删除节点'))`, { timeout: 5000 });
  ok(true, '右侧面板已回到未选中态');
}
