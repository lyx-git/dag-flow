// src/adapter/fetch-errors.ts — Node fetch 底层错误 → 中文人性化提示
// Node 的 fetch 抛出的错误默认是英文（"fetch failed" / "Failed to parse URL" / ENOTFOUND 等），
// 会经节点 error.message 直接透出给用户。这里统一翻译常见模式，未命中的保留原文并加中文前缀。

export function humanizeFetchError(e: unknown): string {
  const err = e as Error;
  const msg = err?.message ?? String(e);
  if (err?.name === 'AbortError') return '请求已超时中断';
  if (/Failed to parse URL|Invalid URL/i.test(msg)) {
    return `URL 格式不合法（检查是否漏了 http:// 或 https:// 前缀、是否有多余空格）: ${msg}`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|certificate|SSL|TLS/i.test(msg)) {
    return `网络连接失败（无法访问目标地址——检查 URL 是否正确、网络/代理/防火墙是否放行、目标服务是否在线）: ${msg}`;
  }
  return `请求异常: ${msg}`;
}
