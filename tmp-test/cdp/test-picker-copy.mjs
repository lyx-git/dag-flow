// tmp-test/cdp/test-picker-copy.mjs — 打开/新建选择器里的工作流复制（2026-10-01 深夜从管理视图移植）
// 覆盖：复制按钮存在且在删除按钮之前、点击后出现 <名>-copy 行、复制内容与原工作流一致（HTTP 验证）。
export async function run({ cdp, evaluate, waitFor, ok, eq, sleep }) {
  // 造一个已知工作流（HTTP 直接保存，snapshot:false 不产版本）
  const base = `copybase-${Date.now().toString(36)}`;
  await evaluate(cdp, `fetch('/api/dag-flow/workflows/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '${base}', snapshot: false, def: {
      name: '${base}', version: 1,
      nodes: [{ id: 'start', type: 'start', params: {} }, { id: 'end', type: 'end', params: {} }],
    } }),
  }).then(r => r.ok)`);
  await waitFor(cdp, `fetch('/api/dag-flow/workflows/${base}').then(r => r.json()).then(d => !!d.workflow).catch(() => false)`, { timeout: 5000 });

  // 打开 picker（grab-test 暴露的钩子），列表自动拉取并渲染
  await evaluate(cdp, `window.__df_openPicker()`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker')`, { timeout: 5000 });
  await waitFor(cdp, `!!document.querySelector('.dag-flow-combo-row[data-name="${base}"]')`, { timeout: 5000 });

  // 复制按钮存在且位于删除按钮之前
  ok(await evaluate(cdp, `(() => {
    const row = document.querySelector('.dag-flow-combo-row[data-name="${base}"]');
    const cp = row.querySelector('button.cp');
    const del = row.querySelector('button.del');
    if (!cp || !del) return false;
    return [...row.querySelectorAll('button')].indexOf(cp) < [...row.querySelectorAll('button')].indexOf(del);
  })()`), '复制按钮存在且在删除按钮之前');

  // 点击复制 → 出现 <base>-copy 行
  await evaluate(cdp, `document.querySelector('.dag-flow-combo-row[data-name="${base}"] button.cp').click()`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-combo-row[data-name="${base}-copy"]')`, { timeout: 5000 });

  // 复制内容与原工作流一致（节点数）
  const srcNodes = await evaluate(cdp, `fetch('/api/dag-flow/workflows/${base}').then(r => r.json()).then(d => d.workflow.nodes.length)`);
  const cpNodes = await evaluate(cdp, `fetch('/api/dag-flow/workflows/${base}-copy').then(r => r.json()).then(d => d.workflow.nodes.length)`);
  eq(cpNodes, srcNodes, '复制的工作流内容与原工作流一致');

  // 再复制一次 → 命名递增 -copy-2（不覆盖已有副本）
  await evaluate(cdp, `document.querySelector('.dag-flow-combo-row[data-name="${base}"] button.cp').click()`);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-combo-row[data-name="${base}-copy-2"]')`, { timeout: 5000 });

  // 关闭 picker
  await evaluate(cdp, `document.querySelector('.dag-flow-picker-close').click()`);
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker')`, { timeout: 3000 });
}
