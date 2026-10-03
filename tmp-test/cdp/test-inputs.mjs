// tmp-test/cdp/test-inputs.mjs — 工作流参数弹窗（2026-10-02 重做+改名：⚙→🏷️、✕ 右上角、默认空行、
// 行尾 ✕ 删除、底部 + 添加、改动即自动保存、删掉 添加/取消/保存 三键、更名「工作流参数」）：
// ①🏷️ 打开弹窗，标题「工作流参数」+ 右上角 ✕；②默认一条空行；③输入 k/v 自动写入 def（无保存键）；
// ④底部 + 添加行；⑤第二行 JSON 数字值自动解析；⑥行尾 ✕ 删除行并同步 def；⑦右上角 ✕ 关闭；
// ⑧重开显示已存参数。
// ★ React 受控输入必须原生 setter + input 事件（React 18 劫持 value 描述符）；
//   两次键入分开 evaluate 并 waitFor 中间态——同一批派发会命中 React 闭包批处理，后一次会覆盖前一次。
export async function run({ cdp, evaluate, waitFor, ok }) {
  // ① 打开弹窗
  await evaluate(cdp, `
    (() => {
      const btn = [...document.querySelectorAll('.dsh-wf-btn')].find((b) => (b.title || '').includes('工作流参数'));
      btn.click();
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker-title')`, { timeout: 5000 });
  ok(await evaluate(cdp, `document.querySelector('.dag-flow-picker-title')?.textContent?.includes('工作流参数') ?? false`), '弹窗标题为「工作流参数」');
  ok(await evaluate(cdp, `!!document.querySelector('.dag-flow-picker-title .dag-flow-picker-close')`), '右上角有关闭按钮');
  ok(await evaluate(cdp, `(document.querySelector('.dag-flow-picker-hint')?.textContent || '').includes('仅当前工作流')`), '提示标注「仅当前工作流」（图标/文案不再用系统级全局歧义）');

  // ② 默认一条空行
  const rows0 = await evaluate(cdp, `document.querySelectorAll('.dag-flow-picker-body input[placeholder="名称"]').length`);
  ok(rows0 === 1, '默认一条空行（实际 ' + rows0 + ' 行）');
  ok(await evaluate(cdp, `!document.querySelector('.dag-flow-picker-foot')`), '旧底部按钮行（添加输入/取消/保存）已删除');

  // 安装 React 受控输入原生 setter 助手
  await evaluate(cdp, `
    window.__df_setVal = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }; true;
  `);

  // ③ 输入 k → waitFor def 镜像；再输入 v → waitFor（分开派发防 React 批处理互覆）
  await evaluate(cdp, `
    (() => {
      const k = document.querySelector('.dag-flow-picker-body input[placeholder="名称"]');
      window.__df_setVal(k, 'city');
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def?.inputs?.city === ''`, { timeout: 5000 });
  await evaluate(cdp, `
    (() => {
      const row = document.querySelector('.dag-flow-picker-body input[placeholder="名称"]')?.closest('div');
      window.__df_setVal(row.querySelector('input[placeholder^="值"]'), '上海');
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def?.inputs?.city === '上海'`, { timeout: 5000 });
  ok(true, '输入 k/v 即自动写入 def（无保存按钮）');

  // ④ 底部 + 添加一行
  await evaluate(cdp, `document.querySelector('.dsh-wf-inputs-add')?.click(); true;`);
  await waitFor(cdp, `document.querySelectorAll('.dag-flow-picker-body input[placeholder="名称"]').length === 2`, { timeout: 5000 });
  ok(true, '底部 + 号添加新行');

  // ⑤ 第二行 k='count'、v='8'（JSON 数字自动解析）
  await evaluate(cdp, `
    (() => {
      const ks = document.querySelectorAll('.dag-flow-picker-body input[placeholder="名称"]');
      window.__df_setVal(ks[1], 'count');
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def?.inputs?.count === ''`, { timeout: 5000 });
  await evaluate(cdp, `
    (() => {
      const ks = document.querySelectorAll('.dag-flow-picker-body input[placeholder="名称"]');
      const row = ks[1].closest('div');
      window.__df_setVal(row.querySelector('input[placeholder^="值"]'), '8');
    })(); true;
  `);
  await waitFor(cdp, `window.__df_def?.inputs?.count === 8`, { timeout: 5000 });
  ok(true, 'JSON 数字值自动解析为 number（count===8）');

  // ⑥ 行尾 ✕ 删除第一行（city）→ def 同步移除
  await evaluate(cdp, `document.querySelectorAll('button[title="删除该参数"]')[0].click(); true;`);
  await waitFor(cdp, `window.__df_def?.inputs && !('city' in window.__df_def.inputs) && window.__df_def.inputs.count === 8`, { timeout: 5000 });
  ok(true, '行尾 ✕ 删除行并同步 def（city 消失、count 保留）');

  // ⑦ 右上角 ✕ 关闭
  await evaluate(cdp, `document.querySelector('.dag-flow-picker-title .dag-flow-picker-close').click(); true;`);
  await waitFor(cdp, `!document.querySelector('.dag-flow-picker-title')`, { timeout: 5000 });
  ok(true, '右上角 ✕ 关闭弹窗');

  // ⑧ 重开：显示已存参数（count 一行，不叠加默认空行）
  await evaluate(cdp, `
    (() => {
      const btn = [...document.querySelectorAll('.dsh-wf-btn')].find((b) => (b.title || '').includes('工作流参数'));
      btn.click();
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dag-flow-picker-title')`, { timeout: 5000 });
  const rows1 = await evaluate(cdp, `document.querySelectorAll('.dag-flow-picker-body input[placeholder="名称"]').length`);
  ok(rows1 === 1, '重开只显示已存参数（1 行，实际 ' + rows1 + ' 行）');
  ok(await evaluate(cdp, `document.querySelector('.dag-flow-picker-body input[placeholder="名称"]')?.value === 'count'`), '重开回显已存参数名（count）');
}
