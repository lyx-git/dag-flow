// tmp-test/cdp/test-switch-cases.mjs — switch 分支设置（2026-10-02 用户反馈「无法按条件分多分支」）：
// ①拖多路分支节点 → 面板出现「🔀 分支设置」；②点 + 添加 case、填 case 值 → params.cases 写入；
// ③删除 case → cases 同步移除。
// ★ React 受控输入用原生 setter + input 事件；面板按分类分组，拖节点按标签文本找项。
export async function run({ cdp, evaluate, waitFor, ok }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  const before = await evaluate(cdp, `window.__df_def?.nodes?.length ?? -1`);

  // 拖多路分支节点
  await evaluate(cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('多路分支'));
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
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) > ${before >= 0 ? before : 0}`, { timeout: 8000 });
  // 画布卡片渲染（fromJSON 管线延迟）
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((el) => (el.textContent || '').includes('多路分支'))`, { timeout: 15000 });

  // 选中 switch 节点（重试 3 次防偶发吞 click）
  let selected = false;
  for (let i = 0; i < 3 && !selected; i++) {
    await evaluate(cdp, `
      (() => {
        const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
        const idx = cards.findIndex((el) => el.textContent.includes('多路分支'));
        if (idx < 0) throw new Error('找不到多路分支卡');
        return window.__df_clickNode(idx);
      })(); true;
    `);
    try {
      await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => l.textContent.includes('分支设置'))`, { timeout: 4000 });
      selected = true;
    } catch { /* 重试 */ }
  }
  ok(selected, 'switch 面板出现「分支设置」');

  // 添加 case → 填 case 值 → params.cases 写入
  await evaluate(cdp, `
    (() => {
      const add = document.querySelector('.dsh-wf-inputs-add');
      add.click();
    })(); true;
  `);
  await evaluate(cdp, `
    (() => {
      const label = [...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('分支设置'));
      const row = label.closest('.dsh-wf-panel-row');
      const input = row.querySelector('input[placeholder="case 值（如 A）"]');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, 'A');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })(); true;
  `);
  await waitFor(cdp, `Object.keys(window.__df_def?.nodes?.find((n) => n.type === 'switch')?.params?.cases ?? {}).includes('A')`, { timeout: 5000 });
  ok(true, 'case 值写入 params.cases');

  // 删除该 case → cases 清空
  await evaluate(cdp, `
    (() => {
      const label = [...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('分支设置'));
      const row = label.closest('.dsh-wf-panel-row');
      const del = [...row.querySelectorAll('button')].find((b) => b.textContent === '✕');
      del.click();
    })(); true;
  `);
  await waitFor(cdp, `Object.keys(window.__df_def?.nodes?.find((n) => n.type === 'switch')?.params?.cases ?? {}).length === 0`, { timeout: 5000 });
  ok(true, '删除 case 后 params.cases 同步清空');
}
