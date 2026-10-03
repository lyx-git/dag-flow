// tmp-test/grab-test.tsx — 画布交互 fixture：挂载真实 FlowPanel（含 Del 快捷键链路），
// 验证节点单击选中 / 拖拽 / 双击拿起 / Del 删除 / 面板最小化，供 headless Chrome 断言。
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/client/styles.css';
import { FlowPanel } from '../src/client/FlowPanel';
import { openWorkflowPicker } from '../src/client/workflow-picker';

// CDP 测试钩子：打开「打开/新建」选择器（复制功能测试用）
(window as any).__df_openPicker = () => openWorkflowPicker((def: any) => { (window as any).__df_picked = def; });

// 支持用 URL 参数注入工作流名（CDP 测试用唯一名，避免 fixture 服务器跨轮次状态串扰）
const params = new URLSearchParams(location.search);
const wfName = params.get('name') ?? '测试工作流';

/** ?branch=1：分支键显形测试用的工作流（形状 = 画布保存后的真实产物：
 *  edges[].when 承载分支键，if 两条出边 / switch 两个 case + 兜底） */
const branchDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'if_1', type: 'if', label: '条件：有结果？', params: { condition: 'web_search1.count > 0', portKeys: ['true', 'false'] } },
    { id: 'log_t', type: 'log', label: '真分支处理', params: { level: 'info', message: 'has-result' } },
    { id: 'log_f', type: 'log', label: '假分支处理', params: { level: 'warn', message: 'no-result' } },
    { id: 'sw_1', type: 'switch', label: '模式分支', params: { value: 'prep_vars.mode', cases: { quick: 'log_t', full: 'log_f' } } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'if_1' },
    { from: 'if_1', to: 'log_t', when: 'true' },
    { from: 'if_1', to: 'log_f', when: 'false' },
    { from: 'log_t', to: 'sw_1' },
    { from: 'sw_1', to: 'log_t', when: 'quick' },
    { from: 'sw_1', to: 'log_f', when: 'full' },
    { from: 'log_f', to: 'end' },
    // ★ 故意留一条没有 when 的分支线：验证「未设分支」琥珀警示 + 问题面板告警（方案 C 的兜底）
    { from: 'if_1', to: 'end' },
  ],
  layout: {
    start: { x: 40, y: 80 }, if_1: { x: 300, y: 80 },
    log_t: { x: 600, y: 20 }, log_f: { x: 600, y: 180 },
    sw_1: { x: 300, y: 300 }, end: { x: 880, y: 100 },
  },
};

/** ?loop=1：loop 可见化测试用的工作流（P1+P2+P3，2026-10-03）
 *  - loop_count：固定 3 次 + 上限 100 → 副标题应为「循环 3 次 · 上限 100」
 *  - loop_over ：遍历数组模板        → 副标题应为「遍历 {{web_search1.out.results}} · 上限 50」
 *  - loop_while：条件表达式          → 副标题应为「while: true」
 *  - loop_none ：无任何边界          → 副标题应为「⚠ 无循环边界」+ 问题面板 error
 *  - 四条 loop 出边 → 验证连线中点出现紫色「循环」标（下游只执行一次）
 *  四个循环都接进链路，避免「无出边（死路）」噪声混进问题面板断言 */
const loopDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'loop_count', type: 'loop', label: '循环：固定次数', params: { count: 3, maxIterations: 100 } },
    { id: 'loop_over', type: 'loop', label: '循环：遍历数组', params: { over: '{{web_search1.out.results}}', maxIterations: 50 } },
    { id: 'loop_while', type: 'loop', label: '循环：条件', params: { while: 'true' } },
    { id: 'loop_none', type: 'loop', label: '循环：无边界', params: {} },
    { id: 'log_t', type: 'log', label: '下游处理', params: { level: 'info', message: 'done' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'loop_count' },
    { from: 'start', to: 'loop_over' },
    { from: 'start', to: 'loop_while' },
    { from: 'start', to: 'loop_none' },
    { from: 'loop_count', to: 'log_t' },
    { from: 'loop_over', to: 'log_t' },
    { from: 'loop_while', to: 'log_t' },
    { from: 'loop_none', to: 'log_t' },
    { from: 'log_t', to: 'end' },
  ],
  layout: {
    start: { x: 40, y: 300 }, loop_count: { x: 300, y: 40 }, loop_over: { x: 300, y: 200 },
    loop_while: { x: 300, y: 360 }, loop_none: { x: 300, y: 520 }, log_t: { x: 680, y: 300 }, end: { x: 940, y: 300 },
  },
};

/** ?many=1：switch case 过多时的尺寸/裁剪夹具（用户 2026-10-03 报「case 配置过多会导致画布上 case 超出节点」） */
const manyDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    {
      id: 'sw_many', type: 'switch', label: '分支很多',
      params: { value: 'prep.mode', cases: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`case${i + 1}`, 'log_t'])) },
    },
    { id: 'log_t', type: 'log', label: '终点', params: { level: 'info', message: 'end' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'sw_many' },
    ...Array.from({ length: 8 }, (_, i) => ({ from: 'sw_many', to: 'log_t', when: `case${i + 1}` })),
    { from: 'log_t', to: 'end' },
  ],
  layout: { start: { x: 40, y: 240 }, sw_many: { x: 320, y: 40 }, log_t: { x: 700, y: 320 }, end: { x: 940, y: 320 } },
};

/** ?stale=1：AI 节点的模型存值是旧快照（不在 dsh 当前列表里）——验证面板把它显式暴露，不再"看起来没选" */
const staleDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'ai_stale', type: 'subagent', label: 'AI：旧模型快照', params: { model: 'custom-model:glm-5.3-flash', prompt: '写一段话' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [{ from: 'start', to: 'ai_stale' }, { from: 'ai_stale', to: 'end' }],
  layout: { start: { x: 60, y: 180 }, ai_stale: { x: 340, y: 140 }, end: { x: 700, y: 180 } },
};

const initialDef: any = params.has('stale') ? staleDef : params.has('many') ? manyDef : params.has('loop') ? loopDef : params.has('branch') ? branchDef : {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {}, next: 'end' },
    { id: 'end', type: 'end', params: {} },
  ],
  layout: { start: { x: 80, y: 80 }, end: { x: 480, y: 80 } },
};

createRoot(document.getElementById('root')!).render(
  createElement(FlowPanel, {
    ctx: {
      workflow: initialDef,
      onChange: (d: any) => { (window as any).__df_def = d; },
    } as any,
    onClose: () => {},
    onCache: () => {},
  } as any),
);
