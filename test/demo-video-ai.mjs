// 实测：AI 自动搭建「文生视频」工作流
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-video-demo-')));
const routes = [];
const stubCtx = { logger: { info() {}, warn() {}, error() {} }, webServer: { register(r) { routes.push(r); return () => {}; } } };
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);

const server = http.createServer(async (req, res) => {
  const pn = new URL(req.url, 'http://x').pathname;
  const ex = routes.find((r) => r.kind === 'exact' && r.path === pn);
  const px = routes.find((r) => r.kind === 'prefix' && (pn === r.path || pn.startsWith(r.path + '/')));
  const h = ex?.handler ?? px?.handler;
  if (!h) { res.statusCode = 404; res.end('no route'); return; }
  try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/api/dag-flow`;

const prompt = '搭建一个文生视频的 AI 工作流：先用 subagent 优化视频提示词，然后用 HTTP 节点调用通义万相文生视频 API 提交异步任务，用 loop+http 轮询任务状态直到完成，最后输出视频 URL。分一个并行分支用 python 节点生成记录日志。';

console.log('prompt:', prompt.slice(0, 60), '...\n调用 LLM 生成中（可能 10-60 秒）...\n');
const r = await fetch(base + '/ai-generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt, stream: false }),
});
console.log('HTTP', r.status);
const text = await r.text();
try {
  const data = JSON.parse(text);
  if (data.ok && data.def) {
    console.log(`\n✅ AI 生成了 ${data.def.nodes.length} 节点的工作流：「${data.def.name}」\n`);
    for (const n of data.def.nodes) {
      console.log(`  ${n.id} [${n.type}] ${n.label ?? ''}`);
      if (n.next) console.log(`     → ${JSON.stringify(n.next)}`);
    }
    console.log('\n=== 完整 JSON（前 1800 字符）===\n' + JSON.stringify(data.def, null, 2).slice(0, 1800));
  } else {
    console.log('生成失败：', text.slice(0, 500));
  }
} catch {
  console.log('原始响应：', text.slice(0, 600));
}
server.close();
