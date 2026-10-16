// src/client/NodeInspector.tsx — 右侧节点检查器（一个逻辑整体，按用户口径不二次拆分）
// 类型标题 / 显示名 / ID / 失败策略下拉 / loop·switch 专属设置 / 模型选择 / 按类型字段 / 「参数与试跑」入口与弹窗 / 变量抽屉数据。
// 依赖 panel-utils（字段缓存/摘要/截断/红星）与 inspector-fields（按类型字段表单）。
// 2026-10-14 重构轮 7 自 FlowPanel.tsx **整体**纯搬运拆出（840 行一个组件函数，不再二次切）。

import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowDef } from './types';
import { findMeta, outSpecOf } from './types';
import { fieldsFromValue } from './outFields';
import { ParamsEditor } from './params-editor';
import type { VarPickGroup } from './var-picker';
import type { TestResult } from './test-result';
import { varMatch } from './util/varSearch';
import { fieldsCacheOf, paramsSummary, codeSummary, truncLabel, reqMark } from './panel-utils';
import { SessionInputFields, MediaFields, WebFields } from './inspector-fields';
// ★ 2026-10-15 用户拍板「复制反馈在按钮本身」：变量 chips 的复制走公共 hook（无浮窗）
import { useCopyFlash } from './use-copy-flash';

// ★ 2026-10-16 P2（不静默降级）：面板要显示"当前配了几张图"——与 host 的 `countImageEntries` **同口径**
//   （字符串按行切、数组递归、对象取 path→url→file）。客户端不能 import 宿主模块，故这里有一份对等实现；
//   两份的契约由 `test/modality.test.mjs` 的 B9 段（host 侧）+ CDP 的 images 用例（client 侧）共同看住。
function countImageRows(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string') return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).length;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + countImageRows(x), 0);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['path', 'url', 'file']) {
      const val = o[k];
      if (typeof val === 'string' && val.trim()) return 1;
    }
    return 0;
  }
  return 0;
}

export function NodeInspector({ node, defNodes = [], edges = [], inputs = {}, runOuts = {}, workflowName = '', onDelete, onParamsChange, onError = 'stop', onNodeError, tolerate = false, onFailPolicyChange }: {
  node: import('./types').ClientNode;
  defNodes?: import('./types').ClientNode[];
  edges?: import('./util/flowDef').RFEdge[];
  /** 工作流参数（def.inputs）——面板「全局变量」里要能复制 {{inputs.名称}} */
  inputs?: Record<string, unknown>;
  /** 上次运行的真实输出（results.<id>.out）——优先用它反推字段，含用户自定义键与深层路径 */
  runOuts?: Record<string, { status?: string; out?: unknown }>;
  workflowName?: string;
  onDelete: () => void;
  onParamsChange: (params: Record<string, unknown>) => void;
  onError?: 'stop' | 'continue' | { goto: string };
  onNodeError?: (onError: 'stop' | 'continue' | { goto: string }) => void;
  /** ★ 容错（2026-10-03）：true = 本节点失败但下游照常执行（等价于合并后下拉的「忽略失败」项） */
  tolerate?: boolean;
  /** ★ 2026-10-04 轮 2：合并后的唯一失败策略入口（stop=停止这条支路 / skip=跳过这条支路且不算失败 / ignore=忽略失败继续下游） */
  onFailPolicyChange?: (policy: 'stop' | 'skip' | 'ignore') => void;
}) {
  const meta = findMeta(node.type);
  const [models, setModels] = useState<{ id: string; name: string; kind: string; label?: string; providerLabel?: string; model?: string; input?: string[]; hasImage?: boolean }[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(
    typeof node.params?.model === 'string' ? node.params.model : '',
  );

  // #11 上游变量：反向 BFS 收集所有祖先节点
  const upstream = useMemo(() => {
    const parents = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!parents.has(e.target)) parents.set(e.target, new Set());
      parents.get(e.target)!.add(e.source);
    }
    const out: string[] = [];
    const seen = new Set<string>([node.id]);
    const queue = [node.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of parents.get(cur) ?? []) {
        if (!seen.has(p)) { seen.add(p); out.push(p); queue.push(p); }
      }
    }
    return out;
  }, [node.id, edges]);

  // #1 单节点试跑
  const [testRunning, setTestRunning] = useState(false);
  // ★ 2026-10-11 方案 A：试跑的输入（工作流参数）已搬进「参数与试跑」弹窗（按字段填），
  //   面板不再保留 `testInputs` 这个 JSON 输入框状态；结果仍留在面板（不开弹窗也能看到上次结果）。
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  // ★ 参数编辑弹窗（2026-10-11 用户拍板）：把「参数」从右侧窄面板里独立出来——字段视图（逐参数增删改）
  //   + JSON 视图 + 变量抽屉 + 底部试跑条。★ 注意：它原先紧邻「代码编辑器弹窗」的状态簇，删那一段时
  //   别把它一起删掉（2026-10-11 脚本化删除时踩过：少这一个声明 → 面板 ReferenceError 白屏）。
  const [paramsOpen, setParamsOpen] = useState(false);
  // ★ switch cases 编辑（分支设置）：本地 rows + 立即写回 params.cases（空键行不写入）
  const [caseRows, setCaseRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries((node.params?.cases as Record<string, unknown>) ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) })));

  /** 单节点试跑（2026-10-11 方案 A 后由「🧪 参数与试跑」弹窗的底部试跑条调用）：
   *  参数取**当前节点的 params**（弹窗里改完即可就地跑）；`vals` 是弹窗里按 `def.inputs` 逐字段填的试跑输入。
   *  ★ 失败原因必须带出来：目标节点没跑起来时（最典型＝参数里引用了上游节点，而试跑没有上游）
   *    `summary.results.target` 根本不存在，旧代码只读 `target.*` ⇒ 面板只剩一句「✗ 节点状态: failed」，
   *    一个字的原因都没有。所以这里同时兜住「节点级错误」与「整轮错误」。 */
  const runTest = async (vals: Record<string, unknown>) => {
    // AI 节点必须选模型：未选 → 不执行，给出引导
    if (node.type === 'subagent' && !String(node.params?.model ?? '').trim()) {
      setTestResult({ error: '请先在上方「选择模型」中选择执行模型（模型来自 dsh 自动发现），再试跑。' });
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/dag-flow/run-node', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nodeType: node.type, params: node.params ?? {}, inputs: vals }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const target = data.summary?.results?.target;
      setTestResult({
        ok: data.ok,
        status: target?.status ?? data.summary?.status,
        ms: target?.durationMs,
        output: target?.out ?? target?.output,
        debug: target?.debug,
        error: target?.error?.message ?? (data.ok ? undefined : data.summary?.error?.message),
      });
    } catch (e) {
      setTestResult({ error: (e as Error).message });
    } finally {
      setTestRunning(false);
    }
  };

  // ★ 2026-10-11 恢复到 HEAD 的既有 effect（本轮脚本化删除时被误删，CDP model-select 抓到空下拉）：
  //   AI 子代理节点的模型列表来自宿主 /models，按 node.type 懒加载一次。
  useEffect(() => {
    if (node.type !== 'subagent' || modelsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/models', { credentials: 'include' });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        const data = await res.json();
        if (!cancelled) {
          setModels(data.models ?? []);
          setModelsLoaded(true);
        }
      } catch (e) {
        console.warn('[dag-flow] load models failed:', (e as Error).message);
        if (!cancelled) setModelsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [node.type, modelsLoaded]);

  // ★ 2026-10-11 恢复到 HEAD 的既有函数（本轮脚本化删除时被误删，CDP 抓到 ReferenceError）：
  //   `writeCaseRows`（switch 分支写回）/ `onLoopBoundChange` + `loopConfigNodes`（loop 面板行）/
  //   `handleModelSelect`、`modelLabelOf`、`modelLabelCount`、`modelDisambig`、`orderedModels`（模型下拉）。
  const writeCaseRows = (rows: { k: string; v: string }[]): void => {
    setCaseRows(rows);
    const cases: Record<string, string> = {};
    for (const r of rows) { const k = r.k.trim(); if (k) cases[k] = r.v; }
    onParamsChange({ cases });
  };

  // ★ loop 循环设置（P2，2026-10-03 用户拍板）：把引擎的「over > count > while」优先级在 UI 上显式化。
  //   此前 loop 参数只能在 JSON 视图里改——用户反馈「loop 不会用」的根因之一。
  const loopParam = (node.params ?? {}) as Record<string, unknown>;
  // ★ 边界类型按「键是否存在」推导（不是按值非空）：用户刚切到「遍历数组」时值还空着，
  //   若按值推导会立刻打回「不设边界」——下拉自己跳回去、输入框根本不出现（本轮踩到）。
  //   引擎侧仍按值判定（空串等于没有边界），这点由卡片副标题与下方空值提示如实告知。
  const loopBound: string = Array.isArray(loopParam.over) || typeof loopParam.over === 'string'
    ? 'over'
    : typeof loopParam.count === 'number' ? 'count'
      : typeof loopParam.while === 'string' ? 'while'
        : 'none';
  // ★ 循环体 = 子工作流（2026-10-03 用户拍板方案 A）：选一个已保存工作流当循环体，
  //   每轮把 {{vars.loopItem}} / {{vars.loopIndex}} 映射进它的 inputs；子工作流 end 输出依次进 out.items。
  const loopBody = ((loopParam.body ?? {}) as { workflowName?: string; inputs?: Record<string, unknown> });
  const [wfNames, setWfNames] = useState<string[]>([]);
  const [wfLoaded, setWfLoaded] = useState(false);
  const [bodyRows, setBodyRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(loopBody.inputs ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) })));
  useEffect(() => {
    if (node.type !== 'loop' || wfLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/workflows', { credentials: 'include' });
        const data = await res.json();
        const list = (data?.workflows ?? data ?? []) as { name?: string }[];
        if (!cancelled) setWfNames(list.map((w) => String(w?.name ?? '')).filter(Boolean));
      } catch { /* 列表拿不到 → 只留「不设」选项 */ } finally { if (!cancelled) setWfLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [node.type, wfLoaded]);
  const writeLoopBody = (workflowName: string, rows: { k: string; v: string }[]): void => {
    setBodyRows(rows);
    if (!workflowName) { onParamsChange({ body: null }); return; }
    const inputs: Record<string, string> = {};
    for (const r of rows) { const k = r.k.trim(); if (k) inputs[k] = r.v; }
    onParamsChange({ body: { workflowName, inputs } });
  };
  const setLoopBound = (next: string): void => {
    const cleared = { count: null, while: null, over: null };
    if (next === 'count') onParamsChange({ ...cleared, count: 3 });
    else if (next === 'over') onParamsChange({ ...cleared, over: '' });
    else if (next === 'while') onParamsChange({ ...cleared, while: 'true' });
    else onParamsChange(cleared);
  };
  const loopConfigNodes = (): React.ReactNode => {
    const numInput = (key: string, label: string, min: number, max: number | null, dflt: string): React.ReactNode => createElement('input', {
      className: 'dsh-wf-input', key, type: 'number', min, ...(max ? { max } : {}), placeholder: label,
      value: typeof loopParam[key] === 'number' ? String(loopParam[key]) : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value.trim();
        if (v === '') { onParamsChange({ [key]: null }); return; }
        let n = parseInt(v, 10);
        if (!Number.isFinite(n)) return;
        n = Math.max(min, max ? Math.min(max, n) : n);
        onParamsChange({ [key]: n });
      },
    });
    const out: React.ReactNode[] = [
      createElement('label', { className: 'dsh-wf-panel-label', key: 'loop-label' }, '🔁 循环设置'),
      createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-hint' },
        'loop 只产出迭代序列（out.count / out.items），「不会重复执行下游节点」：它算出「跑几次 / 跑哪些项」，由下游节点自己逐项处理。三种边界同时只按一个生效，优先级 over > count > while。'),
      createElement('select', {
        className: 'dsh-wf-input', key: 'loop-bound', value: loopBound,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setLoopBound(e.target.value),
      },
        createElement('option', { value: 'count', key: 'b-count' }, '固定次数 count'),
        createElement('option', { value: 'over', key: 'b-over' }, '遍历数组 over'),
        createElement('option', { value: 'while', key: 'b-while' }, '条件为真 while'),
        createElement('option', { value: 'none', key: 'b-none' }, '⚠ 不设边界（运行会失败）'),
      ),
    ];
    if (loopBound === 'count') out.push(numInput('count', '迭代次数，如 3', 0, null, '3'));
    if (loopBound === 'over') out.push(createElement('input', {
      className: 'dsh-wf-input', key: 'loop-over', placeholder: '{{上游节点id.out.数组字段}} 或直接写数组',
      value: typeof loopParam.over === 'string' ? loopParam.over : Array.isArray(loopParam.over) ? JSON.stringify(loopParam.over) : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ over: e.target.value }),
    }));
    if (loopBound === 'while') out.push(createElement('input', {
      className: 'dsh-wf-input', key: 'loop-while', placeholder: '表达式（不是 {{}} 模板），如 true',
      value: typeof loopParam.while === 'string' ? loopParam.while : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ while: e.target.value }),
    }));
    if (loopBound === 'none') out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-nobound' }, '⚠ 没有边界时运行会立即失败（LOOP_NO_BOUND），画布问题面板也会报错。'));
    // 选了边界类型但值还空着 → 引擎视作「没有边界」（会 LOOP_NO_BOUND 失败），面板明说
    const boundBlank = (loopBound === 'count' && typeof loopParam.count !== 'number')
      || (loopBound === 'over' && !(Array.isArray(loopParam.over) ? loopParam.over.length > 0 : String(loopParam.over ?? '').trim() !== ''))
      || (loopBound === 'while' && String(loopParam.while ?? '').trim() === '');
    if (boundBlank) out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-blank' },
      '⚠ 边界值还是空的——引擎会当作没有边界，运行报 LOOP_NO_BOUND（卡片副标题也会显示「⚠ 无循环边界」）。'));
    out.push(numInput('maxIterations', '最大迭代次数（默认 1000，上限 100000）', 1, 100000, '1000'));
    if (loopBound === 'while') out.push(createElement('label', { className: 'dsh-wf-panel-hint', key: 'loop-inf', style: { display: 'flex', gap: 6, alignItems: 'center' } },
      createElement('input', {
        type: 'checkbox', checked: loopParam.dangerouslyAllowInfinite === true,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ dangerouslyAllowInfinite: e.target.checked }),
      }),
      'while 到上限后继续（dangerouslyAllowInfinite，慎用）',
    ));
    // —— 循环体：子工作流（方案 A）——
    out.push(createElement('label', { className: 'dsh-wf-panel-label', key: 'loop-body-label' }, '🔁 循环体（可选）'));
    out.push(createElement('select', {
      className: 'dsh-wf-input', key: 'loop-body-sel', value: loopBody.workflowName ?? '',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => writeLoopBody(e.target.value, bodyRows),
    },
      createElement('option', { value: '', key: 'lb-none' }, '（不设：只产出迭代序列 count/items）'),
      ...wfNames.map((n) => createElement('option', { value: n, key: 'lb-' + n }, n)),
      ...(loopBody.workflowName && !wfNames.includes(loopBody.workflowName)
        ? [createElement('option', { value: loopBody.workflowName, key: 'lb-cur' }, `${loopBody.workflowName}（当前值）`)] : []),
    ));
    if (loopBody.workflowName) {
      out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-body-hint' },
        '每轮调用该子工作流：值里可用 {{vars.loopItem}}（当轮的项或轮次序号）与 {{vars.loopIndex}}（序号），也可引用上游 {{节点id.out.x}}；子工作流 end 节点的输出会依次收进本节点的 out.items，下游写法不变。'));
      bodyRows.forEach((row, i) => out.push(createElement('div', { key: 'loop-body-row-' + i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '输入名（子工作流 inputs.x）', value: row.k, style: { flex: '0 0 42%' },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeLoopBody(loopBody.workflowName as string, bodyRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
        }),
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '值，如 {{vars.loopItem}}', value: row.v, style: { flex: 1 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeLoopBody(loopBody.workflowName as string, bodyRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
        }),
        createElement('button', {
          className: 'dsh-wf-btn', title: '删除该输入',
          onClick: () => writeLoopBody(loopBody.workflowName as string, bodyRows.filter((_, j) => j !== i)),
        }, '✕'),
      )));
      out.push(createElement('button', {
        className: 'dsh-wf-inputs-add', key: 'loop-body-add', title: '添加输入映射',
        onClick: () => setBodyRows((rs) => [...rs, { k: '', v: '' }]),
      }, '+'));
      out.push(createElement('select', {
        className: 'dsh-wf-input', key: 'loop-iter-err', value: String(loopParam.onIterationError ?? 'stop'),
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ onIterationError: e.target.value }),
      },
        createElement('option', { value: 'stop', key: 'ie-stop' }, '某轮失败 → 整节点失败（已完成轮次保留在 items）'),
        createElement('option', { value: 'continue', key: 'ie-cont' }, '某轮失败 → 写占位并继续跑'),
      ));
    }
    // ★ 必须包一层 dsh-wf-panel-row：面板的每块设置都是一行（switch 分支设置同款），
    //   否则元素直接挂在面板根上——样式错位，且任何按 .dsh-wf-panel-row 定位的断言/测试都找不到它
    return createElement('div', { className: 'dsh-wf-panel-row' }, ...out);
  };

  const handleModelSelect = (val: string) => {
    setSelectedModel(val);
    onParamsChange({ model: val });
  };

  // ★ 模型下拉的显示名（2026-10-03 用户要求「显示模型显示名称，不用 id」）：
  //   label = 宿主给的显示名（DeepSeek-V41-Flash）；宿主没给时回退 model id（settings 直读源）
  //   → 最后才回退旧的内部串 name（llm:provider:model），保证任何来源都不会显示成一串内部 id。
  //   存值/执行永远是 id（option 的 value），label 只影响 option 文案。
  const modelLabelOf = (m: { id: string; name?: string; label?: string; model?: string }) => m.label || m.model || m.name || m.id;
  const modelLabelCount = new Map<string, number>();
  for (const m of models) modelLabelCount.set(modelLabelOf(m), (modelLabelCount.get(modelLabelOf(m)) ?? 0) + 1);
  /** 重名时补提供方显示名（不是 id）用于消歧 */
  const modelDisambig = (m: { id: string; name?: string; label?: string; model?: string; providerLabel?: string }) =>
    (modelLabelCount.get(modelLabelOf(m)) ?? 0) > 1 ? (m.providerLabel || m.name || '') : '';

  // ★ 「重进下拉直接定位到已选模型」（2026-10-03 用户需求）：把已选中的那条挪到列表最前（紧跟占位项），
  //   原生 select 展开时就在最上面，不用翻 60 条；其余保持原顺序。**只调顺序，不复制、不改 value**。
  const orderedModels = (() => {
    if (!selectedModel) return models;
    const hit = models.find((m) => m.id === selectedModel);
    if (!hit) return models;
    return [hit, ...models.filter((m) => m.id !== selectedModel)];
  })();
  // ★ 2026-10-11（用户拍板）：「删掉画布右侧编辑画板里面的变量引用」——
  //   面板里的「🔗 变量引用」入口行、三份变量清单（上游 / 全局 / 本节点输出）与「点 chip 复制 + 已复制浮窗」
  //   整套**全部删除**，变量只出现在「🧪 参数与试跑」弹窗右侧的变量抽屉里（`VarPicker`：点变量＝插入到
  //   当前值框光标处，不再是"复制"语义）⇒ 一并删掉的死代码：`copied/copyTimer/copyRef` 与 `.dsh-wf-copy-toast`
  //   浮窗、`varQ/varOpen/varDlgOpen/varQuery/varHitCount/upstreamView` 与 `.dsh-wf-var-dlg` 变量弹窗。
  //   ★ 这里原先紧邻被删代码：改这一段时别把 `selfSpec / selfFields / varPickGroups` 一起删掉
  //     （2026-10-11 脚本化删除时踩过：切多了 → 面板白屏 + 整个文件语法错误）。
  // —— 变量抽屉用的派生数据（上游/下游变量都要展示 + 说明作用 + 含全局变量）——
  const selfSpec = outSpecOf(node.type);
  const inputKeys = Object.keys(inputs ?? {});
  /** 全局变量：所有「设置变量」节点写过的键（同名以第一个写入者为准）+ 各自谁写的 */
  const { globalVars, varOwner } = useMemo(() => {
    const owner: Record<string, string> = {};
    for (const n of defNodes) {
      if (n.type !== 'set_var') continue;
      for (const k of Object.keys((n.params?.vars as Record<string, unknown>) ?? {})) if (!owner[k]) owner[k] = n.id;
    }
    return { globalVars: Object.keys(owner), varOwner: owner };
  }, [defNodes]);
  /** 某节点的可引用字段：**优先用上次运行的真实输出反推**（用户自定义键/动态节点/深层路径都能出来），
   *  没跑过（或输出是标量）才退回静态字段表。返回的 desc 用静态表里的说明补含义，sample 是实测样例值。 */
  /**
   * ★ 2026-10-09 性能优化（用户拍板做）：字段表的**原始计算**（不做缓存，见下面的 fieldsFor 包装）。
   * outSpecOf + fieldsFromValue（真实 out 反推）+ 静态表合并 —— 每个节点都要跑一遍，原来**每次 render 都重算** ✗。
   */
  const fieldsForRaw = (nid: string, type: string, staticExtra: { path: string; desc: string }[] = []): { list: { path: string; desc: string; sample?: string }[]; live: boolean; skipped: number } => {
    const spec = outSpecOf(type);
    const out = runOuts?.[nid]?.out;
    const live = fieldsFromValue(out);
    if (out !== undefined && out !== null && live.fields.length) {
      const merged: { path: string; desc: string; sample?: string }[] = [...live.fields.map((f) => ({
        path: f.path,
        desc: (spec.fields ?? []).find((x) => x.path === f.path)?.desc
          ?? staticExtra.find((x) => x.path === f.path)?.desc ?? '',
        sample: `${f.sample}（${f.kind}）`,
      }))];
      // 静态表里有、但这次输出里没出现的字段（例如某分支才有的键）也保留，标注来源
      for (const s of [...staticExtra, ...(spec.fields ?? [])]) {
        if (merged.some((m) => m.path === s.path)) continue;
        merged.push({ path: s.path, desc: `${s.desc}（本次输出里没有，按定义补）` });
      }
      return { list: merged, live: true, skipped: live.skipped.length };
    }
    return { list: [...staticExtra, ...(spec.fields ?? []).map((f) => ({ path: f.path, desc: f.desc }))], live: false, skipped: 0 };
  };
  // ★ 2026-10-09 性能优化（用户拍板做）：按 `runOuts` 的**对象身份**分桶缓存字段表。
  //   原来的 `fieldsFor` 每次 render 都重算（outSpecOf + 真实 out 反推 + 静态表合并）✗；
  //   它只依赖 `runOuts`（outSpecOf 只看 type、上游清单在 key 里）→ 用 WeakMap 按 runOuts 身份分桶既**正确**
  //   （换成新对象就是新桶，绝不会读到旧值 ✓）又**不引入 hooks**（这段在接收 props 的组件里，避免 hooks 规则风险 ✓）。
  const fieldsCache = fieldsCacheOf(runOuts);
  const fieldsFor = (nid: string, type: string, staticExtra: { path: string; desc: string }[] = []): { list: { path: string; desc: string; sample?: string }[]; live: boolean; skipped: number } => {
    const key = `${nid}\u0000${type}\u0000${staticExtra.map((x) => `${x.path}=${x.desc}`).join(',')}`;
    const hit = fieldsCache.get(key);
    if (hit) return hit;
    const v = fieldsForRaw(nid, type, staticExtra);
    fieldsCache.set(key, v);
    return v;
  };
  /** 本节点的字段（同样优先用真实输出反推） */
  const selfFields = fieldsFor(node.id, node.type);
  // ★ 2026-10-03 用户要求：「上游变量复制和输出变量复制，提示信息，改为浮窗提示：已复制xxxx」
  //   原来是面板里一行行内小字（`已复制：xxx`，面板长了还得往下找）；现在改成 Portal 到 body 的浮窗 toast
  //   （fixed 定位，与面板滚动位置无关），文案 = 「已复制 <复制到的变量引用>」。
  //   用 {text,n} 记次数：连点同一个 chip 也能重新触发（只存字符串时 React 不重渲染、计时器不重置）。
  // ★ 2026-10-15 用户拍板「复制反馈在按钮本身」（原话「不要浮窗，就在按钮本身做，提示已复制」）：
  //   chip 点了就地变「✓ 已复制」/「✗ 复制失败」1.4s（原先的「已复制」浮窗 toast 退役）。
  //   flash 带 key：弹窗里 chips 很多，只有点中的那一颗显示提示（连点另一颗会立即切过去）。
  const { flash: chipFlash, copy: copyChip } = useCopyFlash();
  const refChip = (text: string, desc: string, key: string, isOut = false) => {
    const f = chipFlash && chipFlash.key === key ? chipFlash.kind : null;
    return createElement('span', {
      key,
      className: `dsh-wf-var-chip${isOut ? ' is-out' : ''}${f === 'ok' ? ' is-flash-ok' : ''}${f === 'bad' ? ' is-flash-bad' : ''}`,
      title: `点击复制：${text}\n作用：${desc}`,
      onClick: () => copyChip(text, key),
    }, f ? (f === 'ok' ? '✓ 已复制' : '✗ 复制失败') : text);
  };
  /**
   * ★ 2026-10-09 用户拍板方案 C：变量面板「不平铺 + 口语化搜索」。
   *   · 上游变量**已按来源节点分组**，但原来**全部展开** ✗（上游 24 个时一坨）→ 现在默认收起、点标题展开 ✓
   *   · 顶部一个搜索框，四路匹配（节点显示名 / 字段中文说明 / 变量路径 / **拼音首字母** ✓）
   *     → 命中时自动全部展开并只留命中项 ✓（搜索框空=回到"分组收起"的清爽形态 ✓）
   */
  const [varQ, setVarQ] = useState('');
  const [varOpen, setVarOpen] = useState<Record<string, boolean>>({});   // 上游分组展开态（未记录=收起）
  // ★ 2026-10-09 用户要求：「变量面板不是弹窗，最好改成弹窗格式，现在还是在编辑面板里面，导致编辑面板还是乱」
  //   → 变量三块 + 搜索框整体搬进**独立弹窗**（沿用项目弹窗约定 ✓），面板只留入口按钮 ✓
  const [varDlgOpen, setVarDlgOpen] = useState(false);
  const varQuery = varQ.trim();
  /** 变量条目（先建成条目再渲染 → 才能统一过滤 ✓） */
  type VarItem = { path: string; desc: string; key: string; isOut?: boolean };
  /** 全局变量条目（vars + inputs + loop 专用），「上游」「本节点输出」「全局变量」三处共用。
   *  ★ isOut 形参放宽为可选（strict 下暴露：原文件就有 `globalItems()` 与 `globalItems(false)` 两种调用并存，
   *    运行时 isOut=undefined 只影响 React key 前缀，不改文案——保持原行为，不"顺手修"）。 */
  const globalItems = (isOut?: boolean): VarItem[] => [
    ...globalVars.map((k) => ({ path: `{{vars.${k}}}`, desc: `「${k}」——由设置变量节点 ${varOwner[k]} 写入，流程内随处可见`, key: `${isOut ? 'self' : 'up'}-v-${k}`, isOut })),
    ...inputKeys.map((k) => ({ path: `{{inputs.${k}}}`, desc: `工作流参数「${k}」——运行本工作流时由外部/参数面板填入`, key: `${isOut ? 'self' : 'up'}-i-${k}`, isOut })),
    { path: '{{vars.loopItem}}', desc: '仅当本工作流被 loop 当循环体调用时可用：当轮的项或轮次序号', key: `${isOut ? 'self' : 'up'}-loopItem`, isOut },
    { path: '{{vars.loopIndex}}', desc: '仅当本工作流被 loop 当循环体调用时可用：当前轮序号（从 0 开始）', key: `${isOut ? 'self' : 'up'}-loopIndex`, isOut },
  ];
  const chip = (it: VarItem) => refChip(it.path, it.desc, it.key, it.isOut);
  /** 过滤 + 渲染一组条目（空查询=全给 ✓） */
  const chipsOf = (items: VarItem[]) => items.filter((it) => varMatch(varQuery, [it.path, it.desc])).map(chip);
  /** 上游每行：节点信息 + 字段（先算命中，再决定是否收起/显示哪些字段 ✓）
   *  ★ 2026-10-11：抽成「按搜索词参数化」的函数——变量弹窗用面板里的 varQuery 过滤；
   *    参数弹窗的变量抽屉用空 query 取全量（抽屉有自己的搜索框，不能被面板搜索词串味）。 */

  /** 上游每行：节点信息 + 字段（先算命中，再决定是否收起/显示哪些字段 ✓）
   *  ★ 2026-10-11：抽成「按搜索词参数化」的函数——参数弹窗的变量抽屉用空 query 取全量
   *    （抽屉有自己的搜索框，不能被别的搜索词串味）。
   *  ★ 2026-10-11（用户拍板删面板变量引用后）：上游三组数据只给抽屉用（`upstreamAll`），
   *    函数体里的命中过滤分支留着——抽屉将来要按搜索词过滤时可直接复用。 */
  const upstreamInfo = (u: string, query: string) => {
    const un = defNodes.find((n) => n.id === u);
    const spec = outSpecOf(un?.type ?? '');
    const um = findMeta(un?.type ?? '');
    const f = fieldsFor(u, un?.type ?? '',
      un?.type === 'set_var' ? Object.keys((un.params?.vars as Record<string, unknown>) ?? {}).map((k) => ({ path: k, desc: '本节点写入的全局变量（键来自节点参数）' })) : []);
    const nodeHit = varMatch(query, [u, um?.label, un?.type]);
    // 字段可检索片段里带上**节点 id 拼出的完整路径**（用户更可能直接打 fetch.out.count 这种）
    const fields = query && !nodeHit
      ? f.list.filter((x) => varMatch(query, [x.path, x.desc, x.sample, `${u}.out.${x.path}`]))
      : f.list;
    const rs = runOuts?.[u]?.status;
    const srcNote = f.live ? '（字段取自上次运行的真实输出）'
      : (rs && rs !== 'success' ? `（上次运行是 ${rs}，字段按类型推断）` : '');
    return { u, um, un, spec, f, fields, nodeHit, srcNote, show: !query || nodeHit || fields.length > 0 };
  };
  /** 全量（不带搜索过滤）：给参数弹窗的变量抽屉用 ✓ */
  const upstreamAll = upstream.map((u) => upstreamInfo(u, '')).filter((v) => v.show);
  /** ★ 2026-10-13 修复（随回退恢复变量弹窗一起补回）：变量弹窗用——
   *  `upstreamView` = 按**面板搜索词**过滤后的上游视图（搜索命中时自动全部展开）；
   *  `varHitCount` = 搜索命中总数（上游字段 + 全局条目），弹窗顶部提示「命中 N 项」用。
   *  回退时只有 JSX 回来了、这两个定义丢了 ⇒ 打开弹窗即渲染崩溃。 */
  const upstreamView = upstream.map((u) => upstreamInfo(u, varQuery)).filter((v) => v.show);
  const varHitCount = varQuery
    ? upstreamView.reduce((n, v) => n + v.fields.length + (v.nodeHit ? 1 : 0), 0)
      + globalItems(false).filter((it) => varMatch(varQuery, [it.path, it.desc])).length
    : 0;
  /** 全局变量条目（vars + inputs + loop 专用）：变量抽屉的「全局变量」分组 */

  // ★ 2026-10-11（用户拍板方案 A）：参数弹窗右侧「变量抽屉」的分组数据。
  //   ★ 2026-10-11 追加（用户「删掉画布右侧编辑画板里面的变量引用」）：变量现在**只在这里**出现，
  //     面板里的三份变量清单与「复制 chip」已删——chip 点击行为是「插入当前值框光标处」（由 ParamsEditor
  //     决定），不再是"复制到剪贴板"。用 upstreamAll（不带搜索过滤）：抽屉有自己的搜索框。
  const varPickGroups: VarPickGroup[] = [
    ...upstreamAll.map(({ u, um, un, spec, f, fields, srcNote }) => ({
      key: 'up-' + u,
      // ★ 2026-10-13 用户要求：上游分组标题统一为「显示名（节点id · 节点类型）」——id 必须保留（引用要靠它），
      //   类型用节点 type（与右侧面板「节点类型」行一致）；字段数与实测说明跟在后面。
      //   ★「显示名」= **节点自己的 label**（用户设置的显示名），缺省回退类型名；超长只显示前段 + …（全名进悬浮）。
      title: `${truncLabel(un?.label || um?.label || un?.type || '?')}（${u} · ${un?.type ?? '?'}） · ${fields.length} 个字段${spec.note ? ` —— ${spec.note}` : ''}${srcNote}`,
      titleFull: `${un?.label || um?.label || un?.type || '?'}（${u} · ${un?.type ?? '?'}） · ${fields.length} 个字段${spec.note ? ` —— ${spec.note}` : ''}${srcNote}`,
      collapsible: true,
      chips: [
        { text: `{{${u}.out}}`, desc: `「${u}」的整份输出` },
        ...fields.map((x) => ({ text: `{{${u}.out.${x.path}}}`, desc: `${x.desc || '自定义字段'}${x.sample ? `；样例：${x.sample}` : ''}` })),
        { text: `{{results.${u}}}`, desc: '该节点的执行状态/耗时（不是它的业务输出）' },
      ],
      legend: f.live
        ? '实测字段：' + f.list.map((x) => `${x.path}=${x.sample}${x.desc ? `（${x.desc}）` : ''}`).join(' · ') + (f.skipped ? ` · 另有 ${f.skipped} 个键名含点/空格，无法用 {{}} 引用` : '')
        : (f.list.length ? '字段说明：' + f.list.map((x) => `${x.path}=${x.desc}`).join(' · ') : undefined),
    })),
    {
      key: 'global',
      title: `全局变量（vars ${globalVars.length} · inputs ${inputKeys.length}）`,
      // ★ 2026-10-13 修复：这里原来直接 `chips: globalItems()`——那是**旧变量弹窗**的条目形状
      //   `{path, desc, key, isOut}`，而抽屉要的是 `{text, desc, isOut}` ⇒ 全组 chips 的 text 全是
      //   undefined：渲染成**空壳小按钮**（用户看到的「变量按钮变得很小、看不到字段」）、
      //   悬浮提示是「点击填入：undefined」。映射成抽屉的形状即可（上游/本节点输出两分组本来就是显式形状）。
      chips: globalItems().map((it) => ({ text: it.path, desc: it.desc, isOut: it.isOut })),
      legend: (!globalVars.length && !inputKeys.length)
        ? '还没有全局变量：加一个「设置变量」节点会写 vars，或在头部 ✍️ 工作流参数里加 inputs。' : undefined,
    },
    {
      key: 'self',
      title: '本节点输出（下游可直接引用）',
      chips: [
        { text: `{{${node.id}.out}}`, desc: `本节点的整份输出${selfSpec.note ? `（${selfSpec.note}）` : ''}`, isOut: true },
        ...selfFields.list.map((x) => ({ text: `{{${node.id}.out.${x.path}}}`, desc: `${x.desc || '自定义字段'}${x.sample ? `；样例：${x.sample}` : ''}`, isOut: true })),
        { text: `{{results.${node.id}}}`, desc: '本节点的执行状态/耗时（不是业务输出）', isOut: true },
        ...(node.type === 'set_var' ? Object.keys((node.params?.vars as Record<string, unknown>) ?? {}).map((k) => ({ text: `{{vars.${k}}}`, desc: `本节点写入的全局变量「${k}」`, isOut: true })) : []),
      ],
      legend: selfSpec.note ? `本节点输出是什么：${selfSpec.note}` : undefined,
    },
  ];
  return createElement(
    'div',
    null,
    createElement('div', { className: 'dsh-wf-palette-section' }, `${meta?.emoji ?? '⚙️'} ${meta?.label ?? node.type}`),
    // ★ 2026-10-11 用户反馈：「画布右侧编辑框里面的显示名应该放到面板的上面，放在中间有点奇怪」
    //   → 「显示名 (label)」放在面板第一行（节点 ID 之前）。
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '显示名 (label)'),
      createElement('input', {
        className: 'dsh-wf-input',
        defaultValue: node.label ?? node.id,
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          // `_label` ＝ 显示名的**专用提交键**：FlowPanel.handleNodeChange 会把它抽出来写
          // **顶层 `node.label`**（不是 params）。空串＝清掉显示名、画布回退显示节点 id。
          // 别改成普通参数键，否则又会退回"改名静默无效 + params 污染"。
          onParamsChange({ _label: e.target.value });
        },
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '节点 ID'),
      createElement('input', {
        className: 'dsh-wf-input',
        value: node.id,
        readOnly: true,
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '节点类型'),
      createElement('input', { className: 'dsh-wf-input', value: node.type, readOnly: true }),
    ),
    // ===== 变量引用（2026-10-03 用户需求：上游/下游变量都能看、能复制，并说明每个变量的作用）
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '🔗 变量引用'),
      createElement('button', {
        className: 'dsh-wf-btn',
        title: '打开变量弹窗：可按「政策 / 日期 / rq / tzjy」口语化搜索，点 chip 复制 {{}} 引用',
        onClick: () => setVarDlgOpen(true),
      }, '🔗 打开变量弹窗'),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        `上游 ${upstream.length} · 输出 ${selfFields.list.length} · 全局 ${globalVars.length + inputKeys.length} —— 变量都在弹窗里，可按「政策 / 日期 / rq / tzjy」口语化搜 ✓`),
    ),
    varDlgOpen && createPortal(
      createElement('div', {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setVarDlgOpen(false); },
      },
        createElement('div', { className: 'dag-flow-picker dsh-wf-var-dlg' },
          createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
            `🔗 变量引用 · ${node.id}`),
          createElement('div', {
            className: 'dag-flow-picker-body dsh-wf-var-dlg-body',
          },
            createElement('div', { className: 'dsh-wf-panel-row' },
              createElement('label', { className: 'dsh-wf-panel-label' }, '🔎 变量搜索（节点名 / 字段说明 / 拼音首字母）'),
              createElement('input', {
                className: 'dsh-wf-var-search',
                value: varQ,
                placeholder: '口语化搜：政策 · 日期 · rq · tzjy · ai_policy.out …',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setVarQ(e.target.value),
              }),
              varQuery
                ? createElement('div', { className: 'dsh-wf-panel-hint' },
                    varHitCount > 0 ? `命中 ${varHitCount} 项（已自动展开；清空搜索即回到分组收起）`
                      : '没有匹配的变量——换个词试试（支持拼音首字母，如 rq=日期）')
                : createElement('div', { className: 'dsh-wf-panel-hint' }, '输入关键词即可跨「上游 / 输出 / 全局」检索'),
            ),
            createElement('div', { className: 'dsh-wf-panel-row' },
              createElement('label', { className: 'dsh-wf-panel-label' },
                `🔗 上游变量（${upstream.length} 个上游节点${varQuery ? ` · 命中 ${upstreamView.length} 个` : ''} · 点击复制）`),
              upstream.length === 0
                ? createElement('div', { className: 'dsh-wf-panel-hint' }, '无上游节点——本节点是流程起点；下面的全局变量仍然可用。')
                : null,
              ...upstreamView.map(({ u, um, un, f, fields, srcNote }) => {
                const opened = varQuery ? true : varOpen[u] === true;
                return createElement('div', { key: 'up-' + u, className: 'dsh-wf-var-group' },
                  createElement('div', {
                    className: `dsh-wf-var-node is-toggle${opened ? '' : ' is-closed'}`,
                    title: `${un?.label || um?.label || '?'}（${u} · ${un?.type ?? '?'}） · ${fields.length} 个字段${srcNote}${opened ? '\n点击收起该节点字段' : '\n点击展开该节点字段'}`,
                    onClick: () => setVarOpen((m) => ({ ...m, [u]: !(m[u] === true) })),
                  }, `${opened ? '▾' : '▸'} ${truncLabel(un?.label || um?.label || '?')}（${u} · ${un?.type ?? '?'}） · ${fields.length} 个字段${srcNote}`),
                  opened
                    ? createElement('div', { className: 'dsh-wf-var-list' },
                        refChip(`{{${u}.out}}`, `「${u}」的整份输出`, `up-${u}-all`),
                        ...fields.map((x) => refChip(`{{${u}.out.${x.path}}}`, x.desc || '自定义字段', `up-${u}-${x.path}`)),
                        refChip(`{{results.${u}}}`, '该节点的执行状态/耗时（不是业务输出）', `up-${u}-res`),
                      )
                    : null,
                  opened && f.live
                    ? createElement('div', { className: 'dsh-wf-var-legend' }, '实测字段：' + f.list.map((x) => x.path + '=' + x.sample).join(' · '))
                    : null,
                );
              }),
              // ★ 2026-10-15 用户报 bug「画布右侧面板打开变量弹窗，弹窗里面有两份全局变量」：
              //   这里原来在上游列表末尾**又渲染了一遍** `chipsOf(globalItems(false))`，与紧接着下面
              //   那一行「🌐 全局变量（vars N · inputs M · 点击复制）」完全重复（同数据、同 chip、同顺序）。
              //   删掉这一份 —— 下面那行才是正式的那份：它有计数、有空态提示，而且上游为空时的提示语
              //   「下面的全局变量仍然可用」指的就是它（留着重复这份反而让那句提示指错地方）。
            ),
            createElement('div', { className: 'dsh-wf-panel-row' },
              createElement('label', { className: 'dsh-wf-panel-label' },
                `🌐 全局变量（vars ${globalVars.length} · inputs ${inputKeys.length} · 点击复制）`),
              createElement('div', { className: 'dsh-wf-var-list' }, ...chipsOf(globalItems(false))),
              globalVars.length === 0 && inputKeys.length === 0
                ? createElement('div', { className: 'dsh-wf-panel-hint' }, '还没有全局变量：加一个「设置变量」节点会写 vars，或在头部 ✍️ 工作流参数里加 inputs。')
                : null,
            ),
            createElement('div', { className: 'dsh-wf-panel-row' },
              createElement('label', { className: 'dsh-wf-panel-label' }, '📤 本节点输出（下游可直接引用 · 点击复制）'),
              createElement('div', { className: 'dsh-wf-var-list' },
                refChip(`{{${node.id}.out}}`, `本节点的整份输出${selfSpec.note ? `（${selfSpec.note}）` : ''}`, 'self-all', true),
                ...selfFields.list.map((x) => refChip(`{{${node.id}.out.${x.path}}}`, x.desc || '自定义字段', `self-${x.path}`, true)),
                refChip(`{{results.${node.id}}}`, '本节点的执行状态/耗时（不是业务输出）', 'self-res', true),
              ),
              createElement('div', { className: 'dsh-wf-var-legend' }, '下游这样用：参数里写 {{' + node.id + '.out.字段}}；if/switch/loop 表达式里不带 {{}}。'),
            ),
          ),
        ),
      ),
      document.body,
    ),

    // ★ 2026-10-11（用户拍板）：「删掉画布右侧编辑画板里面的变量引用」
    //   → 这里原来有「🔗 变量引用」入口行、`.dsh-wf-var-dlg` 变量弹窗（上游 / 全局 / 本节点输出三块清单）
    //     与「点 chip 复制 + 已复制浮窗」——本轮全部删除；变量与检索只保留在「🧪 参数与试跑」弹窗
    //     右侧的变量抽屉里（`VarPicker`，点变量=插入到当前值框光标处）。原入口行那条「上游 N · 输出 N ·
    //     全局 N + 口语化搜索」的说明，改成 `varDrawerHint` 跟着抽屉显示。
    //   （历史口径已迁移到抽屉：口语化四路匹配 / 上游按来源节点分组默认收起 / 每个变量都说明用途 ✓）
    // ★ 2026-10-04 轮 2：失败策略「合并成一个下拉，避免歧义」（用户原话）。
    //   旧的面板有两个入口——「🛟 失败策略」(onError) 与「🛟 失败不影响流程」(tolerate)，
    //   文案还互相矛盾（一个说"失败后继续执行下游"、一个说"失败即中断后续节点"），
    //   加上旧引擎只在 next 顺序模式读 onError，导致用户根本分不清该用哪个。
    //   现在只剩这一个「本节点失败后」，三项分别对应一套**互斥**语义（写入时清掉另一个字段）：
    //     ⛔ 停止这条支路      = 下游不走 + 计入运行失败（有错因）
    //     ⏭ 跳过这条支路不算失败 = 下游不走 + 不计失败（节点仍标 ⚠ 已容错）
    //     🛟 忽略失败继续下游   = 下游照常执行 + 不计失败（下游引用本节点输出仍会报"无输出"）
    //   ★ 三者共同点：**只影响本节点的下游，其它分支照常跑**（2026-10-04 新语义）。
    (() => {
      const policy: 'stop' | 'skip' | 'ignore' | 'goto' =
        tolerate === true ? 'ignore'
          : onError === 'continue' ? 'skip'
            : (typeof onError === 'object' && onError.goto !== undefined) ? 'goto'
              : 'stop';
      const hintOf: Record<string, string> = {
        stop: '本节点的下游不再执行；这次失败计入运行结果（运行标 ✗ 失败，并给出出错节点与原因）。其它分支照常跑。',
        skip: '本节点的下游不再执行，但这次失败「不计入」运行失败（节点自身仍标 ⚠ 已容错，悬浮可看错误详情）。适合"这条支路可有可无"的场景。',
        ignore: '失败只记在本节点（标 ⚠ 已容错），后续节点照常执行。注意：下游若引用 {{本节点.out}} 仍会因"没有输出"失败。',
        goto: `失败后跳过本节点的下游、直接跳到「${typeof onError === 'object' ? onError.goto : ''}」继续。目标只执行一次：它若排在更前面（已经跑过或已经过了它那一层），跳转不会生效、按「停止这条支路」处理（节点的错误详情里会写明原因）。`,
      };
      return [
        createElement('div', { className: 'dsh-wf-panel-row', key: 'fail-policy' },
          createElement('label', { className: 'dsh-wf-panel-label' }, '🛟 本节点失败后'),
          createElement('select', {
            className: 'dsh-wf-input dsh-wf-failpolicy',
            value: policy,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
              const v = e.target.value as 'stop' | 'skip' | 'ignore' | 'goto';
              if (v === 'goto') {
                // 切到 goto：保留已设目标，否则给一个默认（第一个非 start、非自身的节点）
                const kept = typeof onError === 'object' && onError.goto ? onError.goto : '';
                const fallback = defNodes.find((n) => n.id !== node.id && n.type !== 'start')?.id ?? '';
                onNodeError?.({ goto: kept || fallback });
              } else {
                onFailPolicyChange?.(v);
              }
            },
          },
            createElement('option', { value: 'stop' }, '⛔ 停止这条支路（默认，算运行失败）'),
            createElement('option', { value: 'skip' }, '⏭ 跳过这条支路，不算运行失败'),
            createElement('option', { value: 'ignore' }, '🛟 忽略失败，下游照常执行'),
            createElement('option', { value: 'goto' }, '↪ 失败后跳转到指定节点'),
          ),
        ),
        createElement('div', { className: 'dsh-wf-panel-hint dsh-wf-failpolicy-hint', key: 'fail-hint' }, hintOf[policy] ?? ''),
      ];
    })(),
    typeof onError === 'object' && onError.goto !== undefined && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '↪ 跳转目标'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: onError.goto,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onNodeError?.({ goto: e.target.value }),
      },
        // ★ 轮 3：目标只对"还没跑到的层"生效——把**排在本节点之前**的候选标出来，
        //   免得用户选了个永远不会生效的目标（引擎会在节点错误详情里写明"未重复执行"）。
        defNodes.filter((n) => n.id !== node.id && n.type !== 'start').map((n) => {
          const isUpstream = upstream.includes(n.id);
          return createElement('option', { key: n.id, value: n.id },
            `${n.label ?? n.id}（${n.type}）${isUpstream ? ' · ⚠ 在本节点之前执行，跳转不会生效' : ''}`);
        }),
      ),
    ),
    // ★ loop 循环设置（P2，2026-10-03 用户拍板）
    node.type === 'loop' && loopConfigNodes(),
    // ★ switch 分支设置（2026-10-02 用户需求「根据不同条件分成多个分支」）：
    //   每个 case 键在画布上生成一个输出口（外加 * 兜底口）——从对应口拖线到目标节点，
    //   边的 when 自动=case 键，执行器按 value 匹配激活对应分支、其余跳过。
    node.type === 'switch' && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '🔀 分支设置（case 列表）'),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '每个 case 在画布上生成一个输出口（从对应口拖线连目标，边自动带条件）；value 与 case 值相等时激活该分支，其余跳过。value 支持 {{上游.out}} 引用或字面量。'),
      caseRows.length === 0 && createElement('div', { className: 'dsh-wf-panel-hint' }, '暂无 case——点下方按钮添加（至少 1 个才能画分支）。'),
      caseRows.map((row, i) => createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
        createElement('input', {
          className: 'dsh-wf-input', placeholder: 'case 值（如 A）', value: row.k, style: { flex: '0 0 45%' },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeCaseRows(caseRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
        }),
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '说明（可选）', value: row.v, style: { flex: 1 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeCaseRows(caseRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
        }),
        createElement('button', {
          className: 'dsh-wf-btn', title: '删除该 case',
          onClick: () => writeCaseRows(caseRows.filter((_, j) => j !== i)),
        }, '✕'),
      )),
      createElement('button', {
        className: 'dsh-wf-inputs-add', title: '添加 case',
        onClick: () => setCaseRows((rs) => [...rs, { k: '', v: '' }]),
      }, '+'),
    ),
    // ★ 代码两种录入途径（python/bash，2026-10-02 用户定档：两种互补）——
    //   a) 简单脚本：面板「📝 编辑代码」弹窗直接写多行（存 params.code，随工作流走）；
    //   b) 复杂/多脚本：文件引用 codePath —— 约定 <DSH_HOME>/.dag-flow/scripts/<工作流名>/xxx.py
    //     （相对路径锚定 .dag-flow/，也支持绝对路径）；填了 codePath 优先于内联 code。
    // ★ 2026-10-11 用户拍板方案 A：python/bash 的「代码文件」输入框与「📝 编辑代码」按钮**都搬进
    //   「🧪 参数与试跑」弹窗**（它们本质就是 params.code / params.codePath）——面板这里只留一行只读摘要，
    //   改代码不再需要第二个弹窗；弹窗里 code 行是语言感知的代码编辑器（python/bash 高亮 + 行号 + Tab）。
    (node.type === 'python' || node.type === 'bash') && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '📄 代码'),
      createElement('div', { className: 'dsh-wf-params-summary' }, codeSummary(node.params as Record<string, unknown> | undefined, workflowName)),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '代码与代码文件都在「🧪 参数与试跑」弹窗里改（一个弹窗搞定，改完可直接试跑）。'),
    ),
    // #1 单节点试跑（2026-10-11 用户拍板方案 A：整块搬进「🧪 参数与试跑」弹窗——试跑输入按工作流参数
    //   逐字段填（默认值预填）、参数与试跑同屏、结果就地展开；面板不再放输入框与按钮，只留下面的结果区，
    //   这样面板里不会再有"又一个输入框"，而且改完参数直接就地跑。）
    // ★ 2026-10-11 用户真机反馈：「试跑输出的结果,在右侧面板里面也弹出来了，不应该弹」——
    //   试跑已整块搬进「🧪 参数与试跑」弹窗，结果**只在弹窗里就地显示**，面板不再重复渲染一份
    //   （结果状态仍留在 NodeInspector 里，因为要作为 prop 传给弹窗）。
    node.type === 'subagent' && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '选择模型'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: selectedModel,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleModelSelect(e.target.value),
        style: !selectedModel ? { borderColor: 'var(--wf-warn, #fbbf24)' } : undefined,
      },
        createElement('option', { value: '', disabled: true }, models.length === 0 ? '（dsh 未配置可用模型，请先在 dsh 添加）' : '⬇ 请选择执行模型'),
        // ★ 存值不在当前列表里（旧工作流留下的快照 id、或 dsh 已下架该模型）→ **显式列出来**。
        //   否则 controlled select 匹配不到任何 option，界面显示"请选择执行模型"，而工作流里仍是旧 id
        //   → 看起来没选模型、实际按旧 id 执行（2026-10-03 用户问「模型不是实时获取的吗」时发现的缺口）。
        ...(selectedModel && !models.some((m) => m.id === selectedModel)
          ? [createElement('option', { key: 'stale-model', value: selectedModel }, `✓ ⚠ ${selectedModel}（当前值，dsh 当前未提供）`)] : []),
        orderedModels.map((m) => createElement('option', { key: m.id, value: m.id },
          // ★ 显示「模型显示名」（用户 2026-10-03：不用内部 id，不容易分辨）；重名才补提供方名消歧
          // ★ 已选中项打「✓」前缀（用户 2026-10-03：「点开下拉选项的已经选中的下拉选项就有一个选中的状态
          //   标记它……如果没有已经选择的下拉选，点开下拉选项的时候，就没有选中状态」）——原生 <option>
          //   不能设背景色/图标，只能用文案前缀；未选任何模型时（selectedModel===''）任何一项都不带 ✓。
          `${m.id === selectedModel ? '✓ ' : ''}⚙️ ${modelLabelOf(m)}${modelDisambig(m) ? `（${modelDisambig(m)}）` : ''}${m.hasImage ? ' · 📷 图片' : ''}`,
        )),
      ),
    ),
    node.type === 'subagent' && selectedModel && !models.some((m) => m.id === selectedModel) && createElement('div', { className: 'dsh-wf-panel-hint' },
      models.length === 0
        ? `⚠ 当前保存的模型「${selectedModel}」不在 dsh 当前列表里（本次没取到模型列表）——运行时仍按这个 id 执行。`
        : `⚠ 当前保存的模型「${selectedModel}」不在 dsh 当前可用列表里——运行时仍按这个 id 执行（可能失败）。请从上面重新选一个实际可用的模型。`,
    ),
    node.type === 'subagent' && !selectedModel && createElement('div', { className: 'dsh-wf-panel-hint' },
      models.length === 0
        ? 'dsh 未发现可用模型——请先在 dsh 侧配置模型后刷新。未选择模型前，本节点无法试跑、无法保存。'
        : '⚠ 必须选择执行模型后，本节点才能试跑与保存。',
    ),
    node.type === 'subagent' && createElement('div', { className: 'dsh-wf-panel-hint' },
      '模型自动发现自 dsh 配置（dsh 存在 profile 的 cordis.patch.yml 里，旧版是 settings.yaml），密钥由 dsh 统一管理，无需在此录入。必须选择执行模型（必选）；prompt 留空（或上游输出为空）时本节点不执行，流程在此中断。',
    ),
    // ★ 保底不丢 id（用户 2026-10-03：下拉显示模型显示名，不用 id；但对照 JSON/排查时要能看到真实 id）
    node.type === 'subagent' && selectedModel && createElement('div', { className: 'dsh-wf-panel-hint' },
      `执行 id：${selectedModel}（下拉里显示的是模型显示名，运行时按这个 id 调用）`,
    ),
    node.type === 'subagent' && selectedModel && (() => {
      const m = models.find((x) => x.id === selectedModel);
      if (!m) return null;
      const caps = (m.input ?? ['text']).join(', ');
      // ★ 2026-10-16 P2（不静默降级）：把"当前配了几张图"直接显示出来——不用等跑起来才知道会不会丢图。
      //   与 host 的 `countImageEntries` 同口径（字符串按行 / 数组递归 / 对象取 path→url→file）。
      const n = countImageRows(node.params?.images);
      if (m.hasImage) {
        return createElement('div', { className: 'dsh-wf-panel-hint' },
          `✓ 所选模型支持图片输入（能力: ${caps}）${n ? `；当前已配 ${n} 张图，运行时会把它们一起发给模型` : ''}`);
      }
      return createElement('div', { className: 'dsh-wf-panel-hint' },
        `⚠️ 所选模型不支持图片输入（能力: ${caps}，仅文本）——${n ? `你已配 ${n} 张图：` : ''}prompt 中引用图片/视频/文件、或 images 里配了图时，运行会在发调用前直接失败（MODEL_MODALITY_MISMATCH，**不会静默丢图**）。需要处理图片请换带 📷 的模型，或在 dsh 配置（profile 的 cordis.patch.yml，旧版 settings.yaml）里为该模型标注 input: [text, image] 后刷新。`);
    })(),
    node.type === 'session_input' && createElement(SessionInputFields, { node, onParamsChange }),
    (node.type === 'image_generate' || node.type === 'video_generate' || node.type === 'file_save')
      && createElement(MediaFields, { node, onParamsChange }),
    (node.type === 'web_search' || node.type === 'web_fetch' || node.type === 'doc_parse')
      && createElement(WebFields, { node, onParamsChange }),
    // ★ 2026-10-11 用户反馈：「画布右侧编辑框里面的显示名应该放到面板的上面，放在中间有点奇怪」
    //   → 「显示名 (label)」已挪到面板最上面（节点 ID 之前），这里不再渲染。
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '参数与试跑'),
      createElement('button', {
        className: 'dsh-wf-btn', style: { width: '100%' },
        title: '打开「参数与试跑」：每个参数一行（可新增 / 修改 / 删除，长文本用代码级多行框），底部可直接试跑本节点',
        onClick: () => setParamsOpen(true),
      }, `🧪 参数与试跑（${Object.keys(node.params ?? {}).length} 项）`),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '可用上游数据引用：{{节点id.out}} / {{节点id.out.字段}} / {{vars.变量}} / {{inputs.输入}}',
      ),
      createElement('div', { className: 'dsh-wf-params-summary' }, paramsSummary(node.params as Record<string, unknown> | undefined)),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('button', { className: 'dsh-wf-btn dsh-wf-btn-danger', onClick: onDelete }, '🗑 删除节点'),
    ),
    // ★ 参数编辑弹窗（2026-10-11 用户拍板）：把参数从窄面板里独立出来——字段视图（逐参数增删改）
    //   + JSON 视图 + 变量抽屉 + 底部试跑条；Portal 到 body（面板的 backdrop-filter 会困住 fixed 弹窗）。
    paramsOpen && createPortal(createElement(ParamsEditor, {
      nodeId: node.id,
      nodeLabel: meta?.label,
      params: (node.params ?? {}) as Record<string, unknown>,
      varGroups: varPickGroups,
      // ★ 2026-10-11（用户拍板）：「删掉画布右侧编辑画板里面的变量引用」→ 变量只在抽屉里出现，
      //   原面板入口行那句「上游 N · 输出 N · 全局 N + 口语化搜」的说明挪到抽屉顶部（跟着抽屉显示）。
      varHint: `上游 ${upstream.length} · 输出 ${selfFields.list.length} · 全局 ${globalVars.length + inputKeys.length} · 点变量插入到值框光标处；顶部搜索支持口语化（政策 / 日期 / rq / tzjy）`,
      // ★ 方案 A：python/bash 的 `code` 行在弹窗里用**语言感知的代码编辑器**（取代原「📝 编辑代码」弹窗）；
      //   `codePath` 行给该字段专用说明（约定路径 / 填了文件优先于内联代码）。
      codeLang: node.type === 'bash' ? 'bash' : node.type === 'python' ? 'python' : undefined,
      fieldHints: (node.type === 'python' || node.type === 'bash')
        ? {
            codePath: `约定路径 scripts/${workflowName || '工作流名'}/xxx.py（📁 工作流文件夹按钮可达，按工作流分目录）；相对路径锚定 .dag-flow/，也支持绝对路径。★填了代码文件时优先于内联代码。`,
          }
        // ★ 2026-10-16 P1（多模态传图）：`images` 是"节点默认参数里没有、但要能填"的可选参数 ——
        //   在 fieldHints 里登记 ⇒ 参数弹窗会自动补出这一行（多行框），留空则不写进 def。
        : node.type === 'subagent'
          ? {
              images: '图片输入：每行一个本地路径或 http(s) 图片 URL；只写文件名＝到统一图片目录 <DSH_HOME>/.dag-flow/images/ 里找（文档解析节点抽出的图片也放这里）。只支持 png / jpg / jpeg / webp / gif，最多 20 张、单张不超 20MB。★只有走 dsh 宿主模型（下拉里带「· 📷 图片」的）才会真把图片发给模型；留空＝纯文本调用。',
            }
          : undefined,
      // ★ 2026-10-16（用户问「多张图片、多个路径或 URL 要怎么区分」）：images 行的**示例占位**——
      //   直接把三类写法摆出来（统一目录里的文件名 / 绝对路径 / URL），一眼看出"一行一个"。
      fieldPlaceholders: node.type === 'subagent'
        // ★ 2026-10-16（用户「示例占位还是没改好」）：实测**单行形态会被裁**——原示例折成一行后
        //   文字宽 443px > 输入框可用 438px；故收短成三类写法的短代表（详细规则在下方 hint 里）。
        ? { images: '每行一个：\nchart.png\nC:\\图片\\a.jpg\nhttps://x.png' }
        : undefined,
      // ★ 2026-10-16 方案 A（用户拍板）：images 行提供「🖼 选图」——从统一图片目录勾选多张，
      //   不用再一个个复制文件名。
      imagePickKeys: node.type === 'subagent' ? ['images'] : undefined,
      // ★ 方案 A：试跑条要用的东西——输入默认值取工作流参数（def.inputs），结果与运行态由面板持有
      inputDefaults: (inputs ?? {}) as Record<string, unknown>,
      canTest: node.type !== 'start' && node.type !== 'end',
      testRunning,
      testResult,
      onRunTest: (vals: Record<string, unknown>) => void runTest(vals),
      onParamsChange,
      onClose: () => setParamsOpen(false),
    }), document.body),
  );
}
