// src/client/panels/render-body.tsx — FlowPanel 的渲染主体（面板/画布/右侧栏/各弹窗的挂载）
//
// 从 FlowPanel.tsx 抽出（2026-10-19 拆分第 3 批收尾）。它是**模块级纯渲染函数**：
// 不闭包组件状态，一切依赖走入参 p 或下面的 import ⇒ 搬移零行为风险。
// FlowPanel 只负责编排与数据，本文件只负责把它们画出来。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createElement } from 'react';
import { createPortal } from 'react-dom';
import type { MountContext, ViewTab, WorkflowDef } from '../types';
import { DEFAULT_WORKFLOW, findMeta, outSpecOf } from '../types';
import { fieldsFromValue } from '../outFields';
import { ParamsEditor } from '../params-editor';
import type { VarPickGroup } from '../var-picker';
import type { TestResult } from '../test-result';
import { progressToStatusMap } from '../runProgress';
import { toRF, fromRF, canonicalizeDef, newNodeId, type RFNode, type RFEdge } from '../util/flowDef';
import { buildGraphSvg, svgToPngBlob, type GraphImageNode, type GraphImageEdge } from '../util/graphImage';
import { varMatch } from '../util/varSearch';
import { applyAutoLayout } from '../util/layout';
import { Canvas } from '../flowgram/FlowGramCanvas';
import { disposeCanvasNode } from '../flowgram/FlowGramCanvas';
import { resetUndoPending } from '../undo-stack';
import { useUndoWiring } from '../undo-wiring';
import { SessionInputFields, MediaFields, WebFields } from '../inspector-fields';
import { NodeInspector } from '../NodeInspector';
import { useInputsDialog, InputsDialogView } from '../dialogs/inputs-dialog';
import { useVersionsDialog, VersionsDialogView } from '../dialogs/versions-dialog';
import { useRunFailDialog, RunFailDialogView } from '../dialogs/run-fail-dialog';
import { useSchedulesDialog, SchedulesDialogView, ScheduleRunConfirmView } from '../dialogs/schedule-dialog';
import { useRunLogDialog, RunLogDialogView } from '../dialogs/run-log-dialog';
import { useRunControl } from '../panels/run-control';
import { useNodeEditing } from '../panels/node-editing';
import { useWorkflowIo } from '../panels/workflow-io';
import { ManualDialogView } from '../dialogs/manual-dialog';
import { useSelfcheckDialog, SelfcheckOkDialogView, SelfcheckBlockDialogView } from '../dialogs/selfcheck-dialog';
import { failPolicyStore } from '../flowgram/failPolicyStore';
import { JsonView } from '../JsonView';
import { normalizeWorkflowName } from '../../name-rule';
import { ensurePickerStyles } from '../workflow-picker';
import { startResize8, readStoredJSON, saveJSON, clampNum, type RightGeom } from '../util/edge-drag';
import { initHoverTips } from '../hover-tip';
import {
  iconJsonBraces, iconExportTray, iconImportTray,
  iconCanvas, iconParams, iconSave, iconHistory, iconSchedule, iconRunLog,
} from '../header-icons';

export function renderBody(p: {
  tab: ViewTab;
  def: WorkflowDef;
  rfNodes: RFNode[];
  rfEdges: RFEdge[];
  selectedNode: import('../types').ClientNode | null | undefined;
  ctx: MountContext;
  runResults?: Record<string, { status: string; durationMs?: number; count?: number; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean }>;
  /** 运行是否仍在进行（false＝已结束/正在取消）：画布"正在走"的光点只在此期间跑 */
  runActive?: boolean;
  /** 上次运行的真实输出（results.<id>），用于把「用户自定义键/动态节点」的实际字段列出来 */
  runOuts?: Record<string, { status?: string; durationMs?: number; out?: unknown }>;
  onDefChange: (d: WorkflowDef) => void;
  onRFChange: (nodes: RFNode[], edges: RFEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  /** 双击节点：loop/subflow 有目标则进入子工作流（2026-10-03 用户需求） */
  onNodeDoubleClick?: (id: string) => void;
  onAddNode: (type: string) => string;
  onDeleteNode: (id: string) => void;
  onNodeChange: (id: string, params: Record<string, unknown>) => void;
  onNodeError: (id: string, onError: 'stop' | 'continue' | { goto: string }) => void;
  /** ★ 2026-10-04 轮 2：面板唯一的「🛟 本节点失败后」下拉（合并了旧的失败策略 + 失败不影响流程） */
  onNodeFailPolicy: (id: string, policy: 'stop' | 'skip' | 'ignore') => void;
  rightMin?: boolean;
  onRightMin?: (v: boolean) => void;
  rightGeom?: RightGeom;
  onRightGeom?: (g: RightGeom) => void;
  rightRef?: { current: HTMLElement | null };
}) {
  // 有没有"节点级运行结果"：runResults 初值是 `{}`（truthy），必须数 key（见下面 activeEdges 处注释）
  const hasRun = !!p.runResults && Object.keys(p.runResults).length > 0;
  const center =
    p.tab === 'canvas'
      ? createElement(Canvas, {
          def: p.def,
          // 注入运行状态（runStatus）供节点徽标
          nodes: p.runResults ? p.rfNodes.map((n) => {
            const rs = p.runResults?.[n.id];
            return rs ? { ...n, data: { ...n.data, runStatus: rs } } : n;
          }) : p.rfNodes,
          edges: p.rfEdges,
          // 运行路径高亮（用户 2026-10-11 拍板方案 C）：**源节点已成功**的边就算进运行路径，
          //   绿线紧跟执行前沿（不再等两端都完成）。
          // ★ 判据必须看「有没有节点级运行结果」，不能只看 `p.runResults` 是否真值：
          //   runResults 的**初始值就是 `{}`（truthy）**——只判真值会得到一个**空 Set**，
          //   于是画布把"所有边都不在运行路径上"当成事实、进画布就把全部线淡化
          //   （2026-10-11 实现本功能时 CDP 首跑即抓到这个：没跑过也 on=true）。
          //   语义：没有运行结果 → `undefined`（保持原样、一条都不淡）；正在跑但还没有
          //   "源节点成功"的边 → 空 Set（该淡的就该淡）。
          activeEdges: hasRun
            ? new Set(p.rfEdges.filter((e) => p.runResults?.[e.source]?.status === 'success').map((e) => e.id))
            : undefined,
          // 其中"两端都成功"的那部分＝已走通（常亮绿 + 外发光）；差集＝正在走（绿 + 光点跑）
          doneEdges: hasRun
            ? new Set(
                p.rfEdges
                  .filter((e) => p.runResults?.[e.source]?.status === 'success' && p.runResults?.[e.target]?.status === 'success')
                  .map((e) => e.id),
              )
            : undefined,
          onChange: p.onRFChange,
          onSelectNode: p.onSelectNode,
          // ★ 双击 loop（循环体）/ subflow（目标）节点 → 进入子工作流（2026-10-03 用户需求）
          onNodeDoubleClick: p.onNodeDoubleClick,
          selectedNodeId: p.selectedNode?.id ?? null,
          // 运行状态走外置 store（FlowGram 节点卡订阅，不进 document 数据）
          runResults: p.runResults,
          // 运行是否仍在进行 → 决定"正在走"是光点跑（进行中）还是静态绿（已结束/已取消）
          runActive: p.runActive,
          // 缩略图右避让：右面板右偏移+宽（或最小化竖条）+ 面板边距 14 + 间隙 12
          rightInset: p.rightMin ? 66 : (p.rightGeom ? p.rightGeom.r + p.rightGeom.w + 12 : 366),
        })
      : null;   // JSON tab 的 center 由下方常驻 jsonView 层显示（切 tab 免重挂载，2026-10-15 大 JSON 提速）

  // ★ JSON 视图常驻（2026-10-15 大 JSON 提速）：只在首次显示时 stringify + 挂 Monaco，
  //   之后 tab 来回切**零重挂载**（隐藏时 JsonView 内部跳过同步，不产生开销）。
  // ★ 铺满方式必须用 absolute inset:0（与 .dsh-wf-center 同款）——**不能只给 width/height:100% 再加
  //   display:flex**：一旦这层成了 flex 容器，`.dsh-wf-json-root`（display:grid）就变成 flex item、
  //   按内容宽度收缩成 ~330px（320px 校验栏 + 编辑器最小宽），实机测出来 Monaco 编辑器只有 **10px 宽**。
  //   2026-10-15 由交付截图取证抓到（CDP 用例只断言了"Monaco 在不在"，断不出"宽度对不对"）。
  const jsonView = createElement('div', {
    key: 'json-view',
    style: {
      position: 'absolute',
      inset: 0,
      display: p.tab === 'json' ? 'block' : 'none',
    },
  }, createElement(JsonView, { def: p.def, onChange: p.onDefChange, visible: p.tab === 'json' }));

  // ★ 右侧：节点参数面板（仅 canvas 显示）。
  // ★ 必须在所有分支 return 之前声明——canvas 分支的 return 引用了它，
  //   声明在后面时是 const TDZ（真机报 Cannot access 'right' before initialization，
  //   2026-10-01 停靠模式首挂即触发的根因）。
  // ★ 2026-10-01 夜：支持最小化（收成右侧竖条）；选中节点时 FlowPanel 自动展开。
  const rightMin = p.rightMin ?? false;
  const right = rightMin
    ? createElement('aside', { className: 'dsh-wf-right min', key: 'right-min' },
        createElement('button', {
          className: 'dsh-wf-right-expand',
          title: '展开参数面板',
          onClick: () => p.onRightMin?.(false),
        }, '«'),
        createElement('div', { className: 'dsh-wf-right-min-label' }, p.selectedNode ? `参数 · ${p.selectedNode.id}` : '参数面板'),
      )
    : createElement('aside', {
        className: 'dsh-wf-right', key: 'right',
        ref: p.rightRef as any,
        style: {
          right: p.rightGeom?.r ?? 14, top: p.rightGeom?.y ?? 14, width: p.rightGeom?.w ?? 340,
          ...(p.rightGeom?.h != null ? { height: p.rightGeom.h, bottom: 'auto' } : {}),
        } as any,
      },
        // 八向拖拽把手（四边+四角）：e/s 改尺寸，w/n 移动位置（左/顶缘跟随光标）
        ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
          createElement('div', {
            key: dir,
            className: `dsh-wf-right-resize ${dir}`,
            title: '拖动调整面板大小',
            onMouseDown: (e: any) => {
              const el = p.rightRef?.current;
              const measured = el ? el.getBoundingClientRect().height : 600;
              const g0 = p.rightGeom ?? { r: 14, y: 14, w: 340, h: null };
              const startR = g0.r;
              const toGeom = (g: { x: number; y: number; w: number; h: number }): RightGeom => ({
                // 右缘位移（e 方向）→ r 反向收紧；w/n 方向右缘不动
                r: Math.min(Math.max(startR - ((g.x + g.w) - g0.w), 0), 80),
                y: g.y, w: g.w, h: g.h,
              });
              startResize8(
                e, dir,
                { x: 0, y: g0.y, w: g0.w, h: g0.h ?? measured },
                { minW: 260, maxW: 560, minH: 220, maxH: 1400 },
                (g) => p.onRightGeom?.(toGeom(g)),
                (g) => {
                  const out = toGeom(g);
                  p.onRightGeom?.(out);
                  saveJSON('dag-flow:right-geom', out);
                },
              );
            },
          })),
        createElement('button', {
          className: 'dsh-wf-right-min',
          title: '最小化参数面板',
          onClick: () => p.onRightMin?.(true),
        }, '»'),
        p.selectedNode
          ? createElement(NodeInspector, {
              // ★ key=节点 id：切换选中节点时重挂载——面板全部状态（试跑结果/试跑输入/模型下拉）
              //   严格跟随当前节点，不再串显上个节点的内容（2026-10-02 用户反馈）
              key: p.selectedNode.id,
              node: p.selectedNode,
              defNodes: p.def.nodes,
              edges: p.rfEdges,
              inputs: p.def.inputs,
              runOuts: p.runOuts ?? {},
              workflowName: p.def.name,
              onDelete: () => p.onDeleteNode(p.selectedNode!.id),
              onParamsChange: (params) => p.onNodeChange(p.selectedNode!.id, params),
              onError: p.selectedNode.onError ?? 'stop',
              onNodeError: (onError) => p.onNodeError(p.selectedNode!.id, onError),
              tolerate: p.selectedNode.tolerate === true,
              onFailPolicyChange: (policy) => p.onNodeFailPolicy(p.selectedNode!.id, policy),
            })
          : createElement(
              'div',
              { className: 'dsh-wf-panel-section', style: { padding: '16px 12px' } },
              '👈 点击节点查看/编辑参数',
            ),
      );

  if (p.tab === 'canvas') {
    // FlowGram 画布自带左侧节点面板（startDragCard 拖拽），不再渲染共享 palette
    return createElement('div', { className: 'dsh-wf-body' },
      createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center),
      right,
      jsonView,   // 常驻隐藏（切 JSON 免重挂载）
    );
  }

  if (p.tab === 'json') {
    // 这些视图自带三栏 / 不需要共享 palette
    return createElement('div', { className: 'dsh-wf-body' },
      createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center),
      jsonView,
    );
  }

  return createElement('div', { className: 'dsh-wf-body' },
    createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center),
    right,
    jsonView,   // 常驻隐藏
  );
}

// 节点参数检查器（简化版：动态渲染 key-value）
// subagent 节点额外提供模型下拉选择（DSH 配置 + 用户自定义模型）

