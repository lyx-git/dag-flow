// src/adapter/routes/workflows.ts — 工作流 CRUD 路由：列表 / 读取·删除·版本（prefix） / 保存
// 存储层在 ../storage.ts（版本快照、重命名搬移都在那层做）；保存时联动定时项改名（../schedules.ts）。
// 2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import * as path from 'node:path';
import type { WorkflowDef } from '../../types.js';
import { normalizeWorkflowName } from '../../name-rule.js';
import { renameScheduleWorkflow } from '../schedules.js';
import type { ApiRouteDeps } from './helpers.js';

export function registerWorkflowRoutes({ route, sendJson, readJsonBody, storage }: ApiRouteDeps): void {
  // 4. 保存/读取工作流
  route({
    kind: 'exact',
    path: '/api/dag-flow/workflows',
    handler: async (_req: any, res: any) => {
      const names = await storage.listWorkflows();
      // 附上每个工作流的节点数 + **落盘路径**（2026-10-03 用户需求：下拉里名称后置灰显示所在路径）
      const info = await storage.describe();
      const withMeta = await Promise.all(names.map(async (n) => {
        const file = path.join(info.dir, `${n}.json`);
        try {
          const def = await storage.readWorkflow(n);
          return { name: n, nodes: def?.nodes?.length ?? 0, path: file };
        } catch { return { name: n, nodes: 0, path: file }; }
      }));
      sendJson(res, 200, { workflows: withMeta, storage: info });
    },
  });

  // 4b. 读取单个已保存工作流（GET /workflows/<name>）+ 历史版本（#14-②）
  // ★ prefix 路由不能带尾斜杠（dsh-host-webserver 契约：no trailing slash，
  //   p 匹配 p 与 p/<x>；带尾斜杠会导致 /workflows/<name> 永远 404）
  route({
    kind: 'prefix',
    path: '/api/dag-flow/workflows',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const rest = url.pathname.replace('/api/dag-flow/workflows/', '').split('/');
        const name = decodeURIComponent(rest[0] ?? '');
        if (!name) { sendJson(res, 400, { error: '缺少工作流名称' }); return; }
        // DELETE /workflows/<name> → 删除工作流（含历史版本）
        if (req.method === 'DELETE' && !rest[1]) {
          await storage.deleteWorkflow(name);
          sendJson(res, 200, { ok: true, deleted: name });
          return;
        }
        // GET /workflows/<name>/versions          → 版本列表
        // GET /workflows/<name>/versions/<ts>     → 读取某版本
        if (rest[1] === 'versions') {
          const ts = decodeURIComponent(rest[2] ?? '');
          if (ts) {
            const def = await storage.readVersion(name, ts);
            if (!def) { sendJson(res, 404, { error: `版本不存在: ${name}@${ts}` }); return; }
            sendJson(res, 200, { workflow: def });
            return;
          }
          // dir 附实际落盘目录（2026-10-01 夜：版本弹窗标注数据存储位置）
          sendJson(res, 200, { versions: await storage.listVersions(name), dir: (await storage.describe()).dir });
          return;
        }
        const def = await storage.readWorkflow(name);
        if (!def) { sendJson(res, 404, { error: `工作流不存在: ${name}` }); return; }
        sendJson(res, 200, { workflow: def });
      } catch (e) {
        sendJson(res, 400, { error: (e as Error).message });
      }
    },
  });

  // 5. 保存工作流（POST { name, def, snapshot? }）→ 写入 <DSH_HOME>/.dag-flow/workflow/<name>.json
  //    snapshot=true（默认）生成版本快照（versions/<name>/<ts>.json，存本次保存内容）；false 不生成（自动保存用）
  route({
    kind: 'exact',
    path: '/api/dag-flow/workflows/save',
    handler: async (req: any, res: any) => {
      try {
        const body = (await readJsonBody(req)) as { name?: string; def?: WorkflowDef; snapshot?: boolean; renameFrom?: string };
        if (!body.name || !body.def) { sendJson(res, 400, { error: '缺少 name 或 def' }); return; }
        // name 规范化：支持中文/字母/数字/连字符（规则唯一源见 src/name-rule.ts）
        const name = normalizeWorkflowName(String(body.name)) || 'my-workflow';
        // snapshot 缺省视为 true（手动保存/复制/重命名均生成版本）；自动保存显式传 false 不生成
        // renameFrom=旧名（重命名保存时 client 带上）→ storage 层删旧文件 + versions/scripts 子目录搬移
        const renameFrom = body.renameFrom ? (normalizeWorkflowName(String(body.renameFrom)) || undefined) : undefined;
        await storage.writeWorkflow(name, { ...body.def, name }, { snapshot: body.snapshot !== false, renameFrom });
        // ★ 定时任务联动改名（2026-10-03 定时任务轮）：工作流改名后，指向旧名的定时项一起改，
        //   否则那些定时项会变成 orphan（配置还在、却永远指空）。失败不阻塞保存。
        let renamedSchedules = 0;
        if (renameFrom && renameFrom !== name) {
          try { renamedSchedules = await renameScheduleWorkflow(renameFrom, name); } catch { /* 联动失败不阻塞保存 */ }
        }
        sendJson(res, 200, { ok: true, name, ...(renamedSchedules ? { renamedSchedules } : {}) });
      } catch (e) {
        sendJson(res, 400, { error: (e as Error).message });
      }
    },
  });
}
