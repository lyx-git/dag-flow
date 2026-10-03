// tmp-test/cdp/test-file-save-click.mjs — 点击 file_save 节点回归（2026-10-02 用户反馈：
// 点击文件保存节点整个画布白屏、右面板调不出——MediaFields 里裸 source 引发
// ReferenceError，React 18 整树卸载）。修复后：点击 → 右面板出现「文件来源」表单，
// 画布卡片保持渲染、编辑器存活。
export async function run({ cdp, evaluate, waitFor, ok }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });

  // ① 拖入 file_save 节点（palette 项「文件保存」）
  await evaluate(cdp, `
    (async () => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('文件保存'));
      if (!item) throw new Error('palette 未找到「文件保存」');
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.6, ey = er.top + er.height * 0.6;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
    })()
  `);
  await waitFor(cdp, `(window.__df_def?.nodes ?? []).some((n) => n.type === 'file_save')`, { timeout: 8000 });
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((el) => (el.textContent || '').includes('文件保存'))`, { timeout: 10000 });
  ok(true, 'file_save 节点拖入成功');

  // ② 点击 file_save 卡片
  const clicked = await evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      const idx = cards.findIndex((el) => (el.textContent || '').includes('文件保存'));
      return idx >= 0 ? window.__df_clickNode(idx) : false;
    })()
  `);
  ok(clicked, 'file_save 卡片点击成功');

  // ③ 断言①：右面板出现 file_save 表单（「内容来源」label）——修复前这里抛 ReferenceError 白屏
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('内容来源'))`, { timeout: 6000 });
  ok(true, '右面板出现文件保存表单（MediaFields 正常渲染）');
  // 断言②：画布未被卸载（编辑器与卡片仍存活）——修复前 root 被 React 整树卸载
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-fg-editor') && document.querySelectorAll('.dsh-wf-fg-card').length >= 3`), '画布未白屏（编辑器与节点卡仍在）');
  // 断言③：def 镜像未丢（节点数 ≥3）
  ok(await evaluate(cdp, `(window.__df_def?.nodes ?? []).length >= 3`), 'def 状态完整');
}
