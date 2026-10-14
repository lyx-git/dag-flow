// src/adapter/routes/schedules.ts — 定时任务路由（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §4）+4 条
// 说明：宿主注册器按 (kind,path) 唯一（重复注册会抛 duplicate 并被跳过），所以拆成 4 条路径：
//   GET  /schedules              列表（可 ?workflow= 过滤）+ 调度器心跳
//   POST /schedules/save         新增/更新一条（cron 非法 → 400 且不落盘）
//   POST /schedules/delete       删除一条（也接受 DELETE 方法）
//   POST /schedules/run          立即运行一次（等价于真跑，UI 二次确认）
// 调度逻辑在 ../scheduler.ts；配置读写在 ../schedules.ts。2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import { listSchedules, upsertSchedule, deleteSchedule, readSchedules, writeSchedules } from '../schedules.js';
import { schedulerInfo, tickScheduler } from '../scheduler.js';
import type { ApiRouteDeps } from './helpers.js';

export function registerScheduleRoutes({ route, sendJson, readJsonBody }: ApiRouteDeps): void {
  route({
    kind: 'exact',
    path: '/api/dag-flow/schedules',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const workflow = url.searchParams.get('workflow') ?? undefined;
        const r = await listSchedules(workflow);
        sendJson(res, 200, { items: r.items, dir: r.dir, scheduler: schedulerInfo(), ...(r.error ? { warning: r.error } : {}) });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  route({
    kind: 'exact',
    path: '/api/dag-flow/schedules/save',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        try {
          const item = await upsertSchedule(body as never);
          sendJson(res, 200, { ok: true, item });
        } catch (e) {
          // cron 非法 / 缺 workflow：**不落盘**，把中文原因交给面板显示红字
          sendJson(res, 400, { error: (e as Error).message });
        }
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  route({
    kind: 'exact',
    path: '/api/dag-flow/schedules/delete',
    handler: async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        let id = url.searchParams.get('id') ?? '';
        if (!id && req.method === 'POST') {
          const body = (await readJsonBody(req)) as { id?: string };
          id = String(body.id ?? '');
        }
        if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
        const removed = await deleteSchedule(id);
        sendJson(res, removed ? 200 : 404, removed ? { ok: true, id } : { error: '该定时项不存在' });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });

  route({
    kind: 'exact',
    path: '/api/dag-flow/schedules/run',
    handler: async (req: any, res: any) => {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
        const body = (await readJsonBody(req)) as { id?: string };
        const id = String(body.id ?? '');
        if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
        // 复用调度器的 tick 逻辑：把该条目的 nextRunAt 置为现在，再走一次真 tick ——
        // 并发 skip / 结果回写 / 独立 runId 的语义与定时触发**完全一致**（不会出现两套行为）。
        const { file } = await readSchedules();
        const it = file.items.find((x) => x.id === id);
        if (!it) { sendJson(res, 404, { error: '该定时项不存在' }); return; }
        it.nextRunAt = new Date().toISOString();
        await writeSchedules(file);
        const report = await tickScheduler();
        // 等这次执行跑完再回复（该请求 hold 到结束，与 /run 语义一致；无交互，不会挂起）
        await Promise.all(report.inflight);
        const after = await listSchedules(it.workflow);
        const updated = after.items.find((x) => x.id === id) ?? null;
        sendJson(res, 200, {
          ok: !!updated && updated.lastRun?.status === 'success',
          item: updated,
          skipped: report.skipped.some((s) => s.id === id),
        });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });
}
