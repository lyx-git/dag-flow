// src/client/panels/node-editing.ts — 节点增删改 / 选中 / 画布→def 同步
//
// 职责：从 FlowPanel.tsx 搬出的「对 WorkflowDef 的编辑动作」（2026-10-19 拆分第 2 批）：
//   handleRFChange（画布抛出的小改 → def）、handleDefChange（JSON 视图/装饰节点等整份改）、
//   handleSelectNode、handleAddNode、handleDeleteNode、deleteNodeFull、handleNodeChange。
//
// ★ 零行为变化：函数体、依赖数组、注释里记录的踩坑原因全部原样搬过来。
// ★ 为什么整块只有一个入参 setter 包：这些都是 FlowPanel 持有的 state setter
//   （def/setDef、dirty/setDirty、selectedNodeId、tab、rightMin、importMsg），
//   本 hook 只做编排，不持有任何独立状态。
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ViewTab, WorkflowDef } from '../types';
import { findMeta } from '../types';
import { canonicalizeDef, newNodeId, fromRF, type RFNode, type RFEdge } from '../util/flowDef';
import { disposeCanvasNode } from '../flowgram/FlowGramCanvas';

export interface UseNodeEditingParams {
  def: WorkflowDef;
  setDef: Dispatch<SetStateAction<WorkflowDef>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  selectedNodeId: string | null;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  setTab: Dispatch<SetStateAction<ViewTab>>;
  setRightMin: Dispatch<SetStateAction<boolean>>;
  setImportMsg: Dispatch<SetStateAction<{ ok: boolean; text: string; onClick?: () => void } | null>>;
}

export function useNodeEditing(p: UseNodeEditingParams) {
  const { def, setDef, setDirty, selectedNodeId, setSelectedNodeId, setTab, setRightMin, setImportMsg } = p;

  const handleRFChange = useCallback(
    (newNodes: RFNode[], newEdges: RFEdge[]) => {
      const next = fromRF(def, newNodes, newEdges);
      setDef(next);
      setDirty(true);
    },
    [def],
  );

  // 装饰节点的编辑桥 + 新建：**必须放在 handleDefChange 之后**（它依赖那个 const；
  //   本项目踩过"后置 const 引用 → TDZ：Cannot access before initialization"的坑）
  // JsonView 直接修改 def
  // ★ 2026-10-08 用户拍板：**写盘统一到 edges**——这些入口拿到的是"原始 def"（JSON 视图就是
  //   JSON.parse 出来的对象），先 canonicalizeDef 归一化（把 next 合并进 edges 并删掉 next），
  //   再落盘；确实发生归一化时给一条浮层提示，免得用户以为"我写的 next 被吞了"。
  const handleDefChange = useCallback((next: WorkflowDef) => {
    const { def: canon, changed } = canonicalizeDef(next);
    setDef(canon);
    setDirty(true);
    if (changed) setImportMsg({ ok: true, text: '已统一为 edges 连线（原 next 已合并进去并移除）——引擎与画布都以 edges 为准' });
  }, []);

  // 节点选中（画布单击 / 缩略图点击 / 表单点击 三处都汇总到这）
  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    // 单击节点即切到画布视图
    if (id) setTab('canvas');
    // ★ 单击选中必展开右侧参数面板（重复点同一节点也要展开——覆盖手动最小化的状态）
    if (id) setRightMin(false);
  }, []);

  // 节点添加（从 palette 拖入：Canvas 自行处理；这里也供 AiGen 等使用）
  const handleAddNode = useCallback(
    (type: string) => {
      // ★ 2026-10-16 规范整改：新节点 id 只由 newNodeId() 一处产出（此前这里内联拼了一遍，与
      //   FlowGram 建节点路径各写一份 —— 「id 生成无单一入口」正是 2026-10-15 事故的结构性根因）
      const id = newNodeId();
      const meta = findMeta(type);
      const newNode = {
        id,
        type,
        label: meta ? `${meta.label}_${id.slice(-4)}` : id,
        params: { ...(meta?.defaultParams ?? {}) },
      };
      const next: WorkflowDef = { ...def, nodes: [...def.nodes, newNode] };
      setDef(next);
      setDirty(true);
      return id;
    },
    [def],
  );

  // 节点删除
  const handleDeleteNode = useCallback(
    (id: string) => {
      const next: WorkflowDef = {
        ...def,
        nodes: def.nodes.filter((n) => n.id !== id),
        edges: def.edges?.filter((e) => e.from !== id && e.to !== id),
      };
      setDef(next);
      setDirty(true);
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [def, selectedNodeId],
  );

  // ★ 完整删除 = 先同步 dispose 画布实体，再走 def 更新（2026-10-02 用户反馈：右侧面板
  //   「删除节点」按钮只清面板、画布节点不消失——按钮此前只调 handleDeleteNode，def→画布
  //   的 fromJSON 管线是延迟的；与 Del 快捷键同款两步走，两条入口统一走这里）。
  const deleteNodeFull = useCallback(
    (id: string) => {
      disposeCanvasNode(id);
      handleDeleteNode(id);
    },
    [handleDeleteNode],
  );

  // 节点参数修改
  const handleNodeChange = useCallback(
    (id: string, params: Record<string, unknown>) => {
      // ★ 参数补丁语义修正（2026-10-03，P2 循环设置暴露）：null = 删除该键。
      //   旧实现是浅合并 `{...n.params, ...params}`，于是 {count: null} 会在 def 里留下 "count": null——
      //   节点 schema 里 count 是 integer、over 是 array，落盘后是脏数据。codePath 清空等既有调用点
      //   本来就按「清掉这个键」的意图传 null，所以这里统一成 delete 才是各方真正的期望。
      // ★ 2026-10-15 修 bug：`_label` 是「显示名 (label)」的**专用提交键**（NodeInspector 发
      //   `{ _label: 新名 }`），过去这里把它当**普通参数**并进 params ⇒ ①`node.label` 永不更新
      //   （画布卡片标题、失败详情里的「显示名_id」都看不到新名）②def 的 params 里多一个
      //   零消费者的幽灵键 `_label`（用户真实工作流已污染 3 处）。现在抽出它写**顶层 label**：
      //   空串 = 清掉 label（画布回退显示节点 id），且不再让它进 params。
      const { _label, ...rest } = params;
      const hasLabel = Object.prototype.hasOwnProperty.call(params, '_label');
      const labelText = typeof _label === 'string' ? _label.trim() : '';
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== null) patch[k] = v;
      const next: WorkflowDef = {
        ...def,
        nodes: def.nodes.map((n) => {
          if (n.id !== id) return n;
          const merged: Record<string, unknown> = { ...(n.params ?? {}), ...patch };
          for (const [k, v] of Object.entries(rest)) if (v === null) delete merged[k];
          delete merged._label; // 顺带清掉 bug 期间写进去的历史幽灵键
          const nextNode: typeof n = { ...n, params: merged as typeof n.params };
          if (!hasLabel) return nextNode;
          if (labelText) return { ...nextNode, label: labelText };
          delete (nextNode as { label?: string }).label;
          return nextNode;
        }),
      };
      setDef(next);
      setDirty(true);
    },
    [def],
  );

  return {
    handleRFChange, handleDefChange, handleSelectNode,
    handleAddNode, handleDeleteNode, deleteNodeFull, handleNodeChange,
  };
}

