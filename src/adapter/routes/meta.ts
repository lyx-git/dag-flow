// src/adapter/routes/meta.ts — 清单/发现类路由：节点列表 / 可用模型 / 图片 API 连通性测试 / 会话列表·读取
// 全是「查一查、测一测」的支撑路由；模型发现走 ../subagent.ts（listAllEndpoints），会话走 ../sessions.ts。
// 2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import type { ApiRouteDeps } from './helpers.js';
import { WorkflowNodeRegistry } from '../../registry/external.js';
import { listAllEndpoints } from '../subagent.js';
import { listSessions, readSessionContent } from '../sessions.js';
import { listImageFiles } from '../image-inputs.js';
import { dagFlowScopedPath } from '../../dsh-gate/paths.js';

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

  // 6.4 图片清单（2026-10-16 用户需求「多张图片一个一个复制名称有点麻烦」→ 拍板方案 A）：
  //     AI 节点 `images` 参数旁「🖼 选图」弹窗的数据源。**只读**、只列白名单扩展名、按修改时间倒序。
  //     目录不存在 ⇒ 空清单（不是错误，前端显示空态 + 「打开图片目录」按钮）。
  //     ★ 2026-10-19 图片按工作流分目录后：`?workflow=<名>` 指定看哪个工作流的图（用户口径"不做兼容"，
  //       所以不再列全库；不带参数时退回 images/ 根）。
  route({
    kind: 'exact',
    path: '/api/dag-flow/images',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const wf = url.searchParams.get('workflow') ?? '';
        // ★ 2026-10-20 用户拍板「不用兼容旧位置数据」⇒ 图片只在 tmp/<名>/<runId>/images/，
        //   dir 报本次工作流的 tmp 根（点「打开图片目录」落这里，能看到各次运行的图）。
        sendJson(res, 200, { dir: dagFlowScopedPath('tmp', wf), images: await listImageFiles(wf), workflow: wf });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  // 6.5 图片 API 连通性/模型支持性测试
  //     真实发一次最小生成请求验证 baseURL+key+model 组合；会产生一张测试图的最小费用。
  //   ★ 2026-10-19 用户拍板 B：「图片生成节点里面的提前测试……是否可以直接删掉提前测试按钮」→ **UI 入口已删除**
  //     （面板上不再有「🔍 测试连接」，验证改走参数弹窗底部的「▶ 试跑本节点」）。
  //     路由本身保留：属纯后台能力（不落盘、不写 runs、不需要 prompt），离线测试 `test/modality.test.mjs` C 段
  //     与 `test/apply-host.test.mjs` 的路由清单都断言它存在 —— 与 `skipSelfcheck` 的"只作 API 保留"同一口径。
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
