// tmp-test/cdp/test-close-btn.mjs — 头部 ✕ 关闭按钮已移除（用户 2026-10-01 夜：没啥用，删掉；
// 停靠模式由外层 dock-head 的「返回会话」承担关闭语义）
// 2026-10-01 深夜：头部按钮改纯图标（💾/🕘/⬇），断言随之按图标匹配
export async function run({ cdp, evaluate, ok, eq }) {
  eq(await evaluate(cdp, `document.querySelectorAll('.dsh-wf-btn-close').length`), 0, '头部无 ✕ 关闭按钮');
  ok(await evaluate(cdp, `!!window.__df_byText('.dsh-wf-btn', '💾')`), '💾 保存按钮仍在');
  ok(await evaluate(cdp, `!!window.__df_byText('.dsh-wf-btn', '🕘')`), '🕘 版本按钮仍在');
  ok(await evaluate(cdp, `!!window.__df_byText('.dsh-wf-btn', '⬇')`), '⬇ 导出按钮仍在');
}
