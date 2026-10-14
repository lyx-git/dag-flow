// src/adapter/routes/meta.ts — 清单/发现类路由：节点列表 / 可用模型 / 图片 API 连通性测试 / 会话列表·读取
// 全是「查一查、测一测」的支撑路由；模型发现走 ../subagent.ts（listAllEndpoints），会话走 ../sessions.ts。
// 2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import type { ApiRouteDeps } from './helpers.js';
import { WorkflowNodeRegistry } from '../../registry/external.js';
import { listAllEndpoints } from '../subagent.js';
import { listSessions, readSessionContent } from '../sessions.js';

export function registerMetaRoutes({ route, sendJson, readJsonBody }: ApiRouteDeps): void {
  // 1. 节点列表
  route({
    kind: 'exact',
    path: '/api/dag-flow/nodes',
    handler: async (_req: any, res: any) => {
      sendJson(res, 200, { nodes: WorkflowNodeRegistry.list().map((d) => d.type) });
    },
  });

  // 6. 可用模型（自动发现 dsh settings.yaml 已配置模型；不再支持手配/密钥录入）
  //    input = 模型输入模态（settings.yaml models[].input，未标注视为 ['text'] 仅文本）；hasImage 供前端提示
  route({
    kind: 'exact',
    path: '/api/dag-flow/models',
    handler: async (_req: any, res: any) => {
      try {
        const endpoints = await listAllEndpoints();
        const models = endpoints.map((e, i) => ({
          id: `dsh:${e.providerName ?? `model-${i}`}`,
          name: e.providerName ?? e.model,
          model: e.model,
          // ★ 显示名（2026-10-03 用户要求「下拉显示模型显示名称，不用 id」）：
          //   label = 宿主给的模型显示名（如 DeepSeek-V41-Flash）；宿主没给（settings 直读源）时
          //   回退到 model id（是能认的模型名，不会退化成 llm:provider:model 这种内部串）。
          //   name/id 字段保持原样不动（存值/执行/旧断言都不受影响），label 纯展示用。
          label: e.modelLabel ?? e.model,
          providerLabel: e.providerLabel ?? '',
          baseURL: e.baseURL,
          kind: 'dsh',
          input: e.input ?? ['text'],
          hasImage: (e.input ?? ['text']).includes('image'),
        }));
        sendJson(res, 200, { models });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  // 6.5 图片 API 连通性/模型支持性测试（image_generate 节点「提前测试」用）
  //     真实发一次最小生成请求验证 baseURL+key+model 组合；会产生一张测试图的最小费用。
  route({
    kind: 'exact',
    path: '/api/dag-flow/test-image-api',
    handler: async (req: any, res: any) => {
      try {
        const body = (await readJsonBody(req)) as { baseURL?: string; apiKey?: string; apiKeyEnv?: string; model?: string; size?: string };
        const baseURL = String(body.baseURL ?? '').replace(/\/+$/, '');
        if (!baseURL) { sendJson(res, 400, { error: '缺少 baseURL' }); return; }
        const apiKey = body.apiKey || (body.apiKeyEnv ? process.env[body.apiKeyEnv] || '' : '');
        if (!apiKey) { sendJson(res, 400, { error: '缺少 API Key（apiKey 或 apiKeyEnv）' }); return; }
        const model = String(body.model ?? 'wanx-v1');
        const size = String(body.size ?? '1024*1024');
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 60_000);
        try {
          const resp = await fetch(`${baseURL}/images/generations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, prompt: 'a small blue circle on white background', size, n: 1 }),
            signal: ac.signal,
          });
          const text = await resp.text().catch(() => '');
          if (resp.ok) {
            sendJson(res, 200, { ok: true, model, size, note: '连接成功且模型可用（已生成 1 张测试图）' });
            return;
          }
          const hint = resp.status === 401 || resp.status === 403
            ? 'API Key 无效或无权限'
            : resp.status === 404
              ? '路径或模型不存在——检查 baseURL 是否为 .../compatible-mode/v1 形态、model 是否为该服务支持的模型'
              : resp.status === 400
                ? '请求被拒——常见原因：模型不支持该 size/参数，或模型名不对（见 detail）'
                : '调用失败（见 detail）';
          sendJson(res, 200, { ok: false, status: resp.status, hint, detail: text.slice(0, 400) });
        } finally {
          clearTimeout(t);
        }
      } catch (e) {
        const msg = (e as Error).name === 'AbortError' ? '超时（60s）' : (e as Error).message;
        sendJson(res, 200, { ok: false, status: 0, hint: '网络/地址错误', detail: msg.slice(0, 400) });
      }
    },
  });

  // 8. 列出工作区会话（供「会话输入」节点选择）
  route({
    kind: 'exact',
    path: '/api/dag-flow/sessions',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const ws = url.searchParams.get('workspace') ?? undefined;
        const sessions = await listSessions(ws);
        if (sessions === null) { sendJson(res, 200, { sessions: [] }); return; }
        sendJson(res, 200, { sessions });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  // 9. 读取会话内容（供「会话输入」节点执行时用；prefix 无尾斜杠，理由同 4b）
  route({
    kind: 'prefix',
    path: '/api/dag-flow/sessions',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const rest = url.pathname.replace('/api/dag-flow/sessions/', '').split('/');
        const sessionId = decodeURIComponent(rest[0] ?? '');
        const limit = Number(url.searchParams.get('limit') ?? '10') || 10;
        const ws = url.searchParams.get('workspace') ?? undefined;
        if (!sessionId) { sendJson(res, 400, { error: '缺少会话 id' }); return; }
        const content = await readSessionContent(sessionId, limit, ws);
        if (content === null) { sendJson(res, 404, { error: '会话不存在' }); return; }
        sendJson(res, 200, { sessionId, limit, content });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });
}
