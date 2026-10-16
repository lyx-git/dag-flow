// src/client/undo-wiring.ts
// 撤销/重做的**接线层**（2026-10-17 从 FlowPanel.tsx 抽出：那个文件已 1587 行、越过项目 500 行软上限，
//   而本项目对这种"面板里的独立职责"一贯是抽成独立模块 —— panel-utils / inspector-fields / dialogs/* /
//   canvas-chrome / node-shell 都是这么来的）。纯接线，不含界面；快照栈本体在 undo-stack.ts。
//
// 承载四件事：
//   ① observe：def 变化 → 记录快照（220ms 去抖 + 等画布"位置待补写"结束）
//   ② applier：撤销/重做 → 回退 def + **直接改画布实体位置**（位置不走 fromJSON 重建，原因见下）
//   ③ 基线：挂载即把当前 def 记为第 0 步
//   ④ 快捷键：Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y（编辑框聚焦时放行原生撤销）
// 另挂两个诊断钩子（`__df_undoStats` / `__df_undoDump`）供 CDP 断言。
import { useEffect, useRef } from 'react';
import type { WorkflowDef } from './types';
import { observeDef, resetUndo, setUndoApplier, undo, redo, undoStats, undoDump, markPending } from './undo-stack';
import { applyNodePositionsRef } from './flowgram/canvas-utils';
import { hasPendingPosFlush } from './flowgram/FlowGramCanvas';
import { toRF } from './util/flowDef';

export function useUndoWiring(
  def: WorkflowDef,
  setDef: (next: WorkflowDef) => void,
  setDirty: (dirty: boolean) => void,
): void {
  const defRef = useRef(def);
  defRef.current = def;

  // ① 记录：def 变化 → 快照
  useEffect(() => {
    // ★ 记录时机（2026-10-16 CDP 实测教训）：拖动会多次上抛（中途静止补写 + 松手落定），而**首次拖动的
    //   那次上抛还顺带把 def 的 edges/nodes 归一化**（diff key 变成 struct:…）⇒ 逐次记录会把一次拖动拆成
    //   "归一化一步 + 位移一步"，第一下撤销只退回拖动中途（用户看到的就是"没退回原位"）。
    //   两步收敛：①先等 220ms 静止；②若画布还有"位置待补写"（拖动中/刚松手）就继续等
    //   ⇒ 一次拖动只在**拖完之后**记一条。
    // ★ 这里**不判断"换工作流"**（v20261017-undokeep 的教训）：原先拿 `def.name` 变化当判据，而
    //   `handleRename` 每键都写 `def.name` ⇒ 改个工作流名就把撤销历史清空了。打开/新建、进入子工作流都经
    //   dock 的 bump 版本号**重挂载 FlowPanel**（挂载时的 resetUndo 就是干净基线）；导入是唯一的
    //   "同实例换 def"路径，由 FlowPanel.importFile 显式调 `resetUndoPending()`。
    markPending(def);   // ★ 立刻登记（undo/redo 会先 flushPending 把它补成一条，见 undo-stack 注释）
    let t = 0;
    const tryRecord = (): void => {
      if (hasPendingPosFlush()) { t = window.setTimeout(tryRecord, 200); return; }
      observeDef(def);
    };
    t = window.setTimeout(tryRecord, 220);
    return () => window.clearTimeout(t);
  }, [def]);

  // ② 回放：把目标快照应用回去
  useEffect(() => {
    setUndoApplier((target) => {
      const cur = defRef.current;
      const tgt = target as WorkflowDef;
      // ★ 位移必须**直接改画布实体**：`structSigOf` 刻意不含 position，只回退位置时 DefSync 会判定
      //   "结构没变"而跳过 fromJSON（那画布上就不会动）⇒ 位置回退走 applyNodePositionsRef 这条专线。
      const curL = (cur.layout ?? {}) as Record<string, { x: number; y: number }>;
      const tgtL = (tgt.layout ?? {}) as Record<string, { x: number; y: number }>;
      // ★ 2026-10-17 修（独立审查报的 ①-2）：def 里**没有 layout** 的节点（AI 生成 / 导入 / CLI 模板的工作流）
      //   在画布上是按**蛇形栅格兜底坐标**显示的 —— 只读 `tgt.layout` 会漏掉它们 ⇒ 撤销时"位置不动、
      //   这一步历史被白吃"。兜底坐标必须与显示**同源**（同一处 toRF 栅格规则），否则又会摆错位置。
      const fallback: Record<string, { x: number; y: number }> = {};
      try {
        for (const n of toRF(tgt).nodes) {
          if (tgtL[n.id]) continue;
          const pos = n.position as { x: number; y: number } | undefined;
          if (pos) fallback[n.id] = { x: pos.x, y: pos.y };
        }
      } catch { /* toRF 异常就不兜底：宁可不动，也不要乱动 */ }
      const moved: Record<string, { x: number; y: number }> = {};
      for (const id of new Set([...Object.keys(curL), ...Object.keys(tgtL)])) {
        const b = tgtL[id] ?? fallback[id];
        if (!b) continue;
        const a = curL[id];
        if (!a || a.x !== b.x || a.y !== b.y) moved[id] = { x: b.x, y: b.y };
      }
      if (Object.keys(moved).length) applyNodePositionsRef.current?.(moved);
      setDef(tgt);
      setDirty(true);
    });
    return () => setUndoApplier(null);
  }, [setDef, setDirty]);

  // ③ 基线：挂载即把当前 def 记为第 0 步（之后每次编辑由 ① 追加）
  useEffect(() => { resetUndo(defRef.current); }, []);

  // 诊断钩子（CDP 断言栈深/位置用）
  useEffect(() => {
    (window as any).__df_undoStats = undoStats;
    (window as any).__df_undoDump = undoDump;
    return () => { (window as any).__df_undoStats = null; (window as any).__df_undoDump = null; };
  }, []);

  // ④ 快捷键接管（FlowGram 内置那套已用 editorProps.history.disableShortcuts 让位）
  //   ★ 编辑框聚焦时必须**放行原生撤销** —— 参数弹窗输入框、代码编辑框（Monaco / CodeMirror）各有自己的
  //     撤销栈，抢过来会把它们的编辑历史弄丢。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function'
        && t.closest('input,textarea,select,[contenteditable="true"],.monaco-editor,.cm-editor,.dsh-wf-code-ta')) return;
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
