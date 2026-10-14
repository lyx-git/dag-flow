// src/registry/builtin.ts — 21 个内置节点的聚合注册器（2026-10-14 重构轮 1 拆分后只做装配）
// 节点实现按职责放在 ./nodes/ 下：control（控制流 10 个）/ script（python/bash）/ io（session_input/http/file_save）
// / ai（subagent/image/video）/ web（search/fetch）/ doc（doc_parse），共用小工具在 ./nodes/shared.ts。
// ★ 注册顺序 = 拆分前 builtin.ts 的原始顺序，勿乱动（注册表按 type 存取，但保持顺序便于 diff）。

import { WorkflowNodeRegistry } from './external.js';
import { startDef, endDef, setVarDef, ifDef, switchDef, loopDef, logDef, manualDef, mergeDef, subflowDef } from './nodes/control.js';
import { pythonDef, bashDef } from './nodes/script.js';
import { sessionInputDef, httpDef, fileSaveDef } from './nodes/io.js';
import { subagentDef, imageGenDef, videoGenDef } from './nodes/ai.js';
import { webSearchDef, webFetchDef } from './nodes/web.js';
import { docParseDef } from './nodes/doc.js';

// 注册
export function registerBuiltinNodes(): void {
  for (const d of [startDef, endDef, pythonDef, bashDef, subagentDef, sessionInputDef, httpDef, setVarDef, ifDef, switchDef, loopDef, logDef, manualDef, mergeDef, subflowDef, imageGenDef, videoGenDef, fileSaveDef, webSearchDef, webFetchDef, docParseDef]) {
    WorkflowNodeRegistry.register(d as never);
  }
}
