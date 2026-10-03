// tmp-test/cdp/test-code-file.mjs — python 节点「代码文件（codePath）」字段（2026-10-02 用户需求：
// 写格式化的代码文件引入执行，不在 JSON 里写转义字符串）：
// ①拖 python 节点 → 面板出现「代码文件」输入框；②填 scripts/hello.py → def.params.codePath 写入；
// ③清空输入 → codePath 从 params 移除（null 合并语义清字段）。
// ★ React 受控输入要原生 setter + input 事件。
export async function run({ cdp, evaluate, waitFor, ok, eq }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-palette-item')`, { timeout: 15000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });

  // 拖 python 节点
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
  await waitFor(cdp, `(window.__df_def?.nodes?.length ?? 0) >= 3`, { timeout: 8000 });
  // ★ def 镜像先行、画布卡片渲染晚几帧（fromJSON 管线延迟）——等 Python 卡真正出现再选中
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((el) => (el.textContent || '').includes('Python'))`, { timeout: 15000 });

  // 选中 python 节点
  await evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      const idx = cards.findIndex((el) => el.textContent.includes('Python'));
      return window.__df_clickNode(idx);
    })(); true;
  `);
  // ① 面板出现「代码文件」输入框
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => l.textContent.includes('代码文件'))`, { timeout: 5000 });
  ok(true, 'python 面板出现「代码文件」字段');

  // ② 填 scripts/hello.py → def.params.codePath
  await evaluate(cdp, `
    (() => {
      const label = [...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('代码文件'));
      const input = label.closest('.dsh-wf-panel-row').querySelector('input');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, 'scripts/hello.py');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def?.nodes?.find((n) => n.type === 'python')?.params?.codePath === 'scripts/hello.py'`, { timeout: 5000 });
  ok(true, 'codePath 已写入节点 params');

  // ③ 清空输入 → codePath 键被删除（2026-10-03 起 null=删键语义；执行器读 falsy 时忽略文件引用）
  await evaluate(cdp, `
    (() => {
      const label = [...document.querySelectorAll('.dsh-wf-panel-label')].find((l) => l.textContent.includes('代码文件'));
      const input = label.closest('.dsh-wf-panel-row').querySelector('input');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })(); true;
  `);
  await waitFor(cdp, `!(window.__df_def?.nodes?.find((n) => n.type === 'python')?.params ?? {}).hasOwnProperty('codePath')`, { timeout: 5000 });
  ok(true, '清空输入后 codePath 键被删除（null=删键，不再落 "codePath": null 脏数据）');

  // ④ 点「📝 编辑代码」→ 弹窗出现
  await evaluate(cdp, `
    (() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('编辑代码'));
      btn.click();
    })(); true;
  `);
  await waitFor(cdp, `[...document.querySelectorAll('.dag-flow-picker-title')].some((t) => t.textContent.includes('编辑代码'))`, { timeout: 5000 });
  ok(true, '编辑代码弹窗打开');
  // ★ Portal 断言：弹窗 overlay 挂在 document.body 直下（逃出右侧面板的 backdrop-filter 包含块）
  ok(await evaluate(cdp, `!![...document.body.children].find((el) => el.classList?.contains('dag-flow-picker-overlay'))`), '弹窗渲染在 body 直下（页面居中，不被面板困住）');

  // ④-2 丰富工具断言：行号槽 / 语法高亮层 / 工具栏（复制+清空）/ 状态栏
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-code-ed .dsh-wf-code-gutter pre')`), '行号槽存在');
  ok(await evaluate(cdp, `[...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('复制')) && [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('清空'))`), '工具栏有复制/清空');
  ok(await evaluate(cdp, `!!document.querySelector('.dsh-wf-code-status')`), '行列状态栏存在');

  // ⑤ 弹窗代码编辑器输入多行代码 → 写回 params.code + 语法高亮生效；右上角 ✕ 关闭
  await evaluate(cdp, `
    (() => {
      const ta = document.querySelector('.dsh-wf-code-ta');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value');
      desc.set.call(ta, "print('LINE1')\\nprint('LINE2')");
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })(); true;
  `);
  await waitFor(cdp, `(window.__df_def?.nodes?.find((n) => n.type === 'python')?.params?.code ?? '').includes('LINE2')`, { timeout: 5000 });
  ok(true, '弹窗内代码改动即写回 params.code（含多行）');
  // 高亮层着色（print 关键字 → tok-k；字符串 → tok-s）
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-code-hl .tok-k') && !!document.querySelector('.dsh-wf-code-hl .tok-s')`, { timeout: 5000 });
  ok(true, '语法高亮生效（关键字/字符串着色）');
  // 行号随代码行数增长（2 行代码 → 行号 ≥2）
  ok(await evaluate(cdp, `(() => { const g = document.querySelector('.dsh-wf-code-gutter pre'); return g ? g.textContent.split('\\n').length >= 2 : false; })()`), '行号随代码行数渲染');
  await evaluate(cdp, `
    (() => {
      document.querySelector('.dag-flow-picker-title .dag-flow-picker-close').click();
    })(); true;
  `);
  await waitFor(cdp, `![...document.querySelectorAll('.dag-flow-picker-title')].some((t) => t.textContent.includes('编辑代码'))`, { timeout: 5000 });
  ok(true, '右上角 ✕ 关闭弹窗');
}
