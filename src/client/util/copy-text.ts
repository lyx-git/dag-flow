// src/client/util/copy-text.ts — 复制到剪贴板的公共实现（Clipboard API → execCommand 兜底）
//
// ★ 2026-10-15 用户拍板「复制按钮统一」：五处复制入口（变量 chips / 富文本框工具条 / 节点结果卡 /
//   运行日志两处 / 失败详情）共用这一个函数，反馈统一为**按钮本身的文字提示**（点完变「✓ 已复制」，
//   失败变「✗ 复制失败」，无浮窗——用户原话「不要浮窗，就在按钮本身做，提示已复制」「不用上次的方案」）。
// 兜底链：navigator.clipboard.writeText（需要安全上下文/权限）→ 隐藏 textarea + execCommand('copy')
//   （旧 WebView / headless / 权限拒绝时可用，与结果卡/变量 chips 的既有兜底同款）。
// 两路都失败才返回 false——调用方据此把按钮切成「✗ 复制失败」。

/** 把文本写入剪贴板；成功返回 true，两路都失败返回 false（不抛错） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到 execCommand 兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
