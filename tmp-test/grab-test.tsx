// tmp-test/grab-test.tsx — 画布交互 fixture：挂载真实 FlowPanel（含 Del 快捷键链路），
// 验证节点单击选中 / 拖拽 / 双击进入子工作流 / Del 删除 / 面板最小化，供 headless Chrome 断言。
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/client/styles.css';
import { FlowPanel } from '../src/client/FlowPanel';
import { openWorkflowPicker } from '../src/client/workflow-picker';
// 子工作流导航：用生产同一份 navStack（只有「换 def」由本夹具用 setState+key 实现）
import { bindNavSwap, backToParentWorkflow, enterSubWorkflow, navCrumbs, navCurrentName, setNavCurrent } from '../src/client/navStack';

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

/** ?chips=1：switch 4 个 case + 兜底（5 个出口）——2026-10-03 用户截图里那种「逐行竖排标签很别扭」的形状。
 *  期望新版：分支键**横排 chips** + 端口行极淡序号 + 悬停高亮；卡内不再有逐行文字标签。 */
const chipsDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    {
      id: 'sw_chips', type: 'switch', label: '多路分支：运行模式',
      params: { value: 'prep_vars.mode', cases: { quick: 'log_1', full: 'log_2', video: 'log_3', image: 'log_4' } },
    },
    { id: 'log_1', type: 'log', label: '出口1', params: { level: 'info', message: 'quick' } },
    { id: 'log_2', type: 'log', label: '出口2', params: { level: 'info', message: 'full' } },
    { id: 'log_3', type: 'log', label: '出口3', params: { level: 'info', message: 'video' } },
    { id: 'log_4', type: 'log', label: '出口4', params: { level: 'info', message: 'image' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'sw_chips' },
    { from: 'sw_chips', to: 'log_1', when: 'quick' },
    { from: 'sw_chips', to: 'log_2', when: 'full' },
    { from: 'sw_chips', to: 'log_3', when: 'video' },
    { from: 'sw_chips', to: 'log_4', when: 'image' },
    { from: 'log_1', to: 'end' }, { from: 'log_2', to: 'end' }, { from: 'log_3', to: 'end' }, { from: 'log_4', to: 'end' },
  ],
  layout: {
    start: { x: 40, y: 320 }, sw_chips: { x: 300, y: 40 },
    log_1: { x: 660, y: 20 }, log_2: { x: 660, y: 130 }, log_3: { x: 660, y: 240 }, log_4: { x: 660, y: 350 }, end: { x: 960, y: 320 },
  },
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

/** ?jump=1：子工作流跳转夹具（2026-10-03 用户需求：双击 loop/subflow 进入子工作流 + header 一键返回）
 *  子工作流名 = `<本页工作流名>-child`（测试先 POST /workflows/save 建好它）；
 *  `loop_missing` 的循环体指向一个**不存在**的工作流（验证失败提示）；
 *  `loop_nobody` 没配循环体（验证「还没选」提示）。 */
const jumpChildName = `${wfName}-child`;
const jumpDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'loop_body', type: 'loop', label: '循环：有循环体', params: { count: 2, body: { workflowName: jumpChildName } } },
    { id: 'sf_call', type: 'subflow', label: '子流程：有目标', params: { workflowName: jumpChildName } },
    { id: 'loop_nobody', type: 'loop', label: '循环：没选循环体', params: { count: 1 } },
    { id: 'loop_missing', type: 'loop', label: '循环：循环体不存在', params: { count: 1, body: { workflowName: `${wfName}-no-such` } } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'loop_body' },
    { from: 'loop_body', to: 'sf_call' },
    { from: 'sf_call', to: 'loop_nobody' },
    { from: 'loop_nobody', to: 'loop_missing' },
    { from: 'loop_missing', to: 'end' },
  ],
  layout: {
    start: { x: 40, y: 300 }, loop_body: { x: 280, y: 60 }, sf_call: { x: 560, y: 60 },
    loop_nobody: { x: 280, y: 300 }, loop_missing: { x: 560, y: 300 }, end: { x: 840, y: 300 },
  },
};

/** ?vars=1：变量引用面板夹具（2026-10-03 用户需求：右侧面板展示上游/下游所有变量 + 全局变量 + 每个变量的作用）
 *  形状：start → seed(设置变量 vars.topic/words) → fetch(网页搜索，对象型输出) → py(Python，标量输出) → ai(AI，标量) → end
 *  工作流参数 def.inputs 给了两个（验证 {{inputs.*}}）；搜索/Python 都不真跑，纯面板断言。 */
const varsDef: any = {
  name: wfName,
  version: 1,
  inputs: { 主题: '技术简报', 语言: 'zh' },
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'seed', type: 'set_var', label: '写全局变量', params: { vars: { topic: 'AI 日报', words: 3 } } },
    { id: 'fetch', type: 'web_search', label: '找资料', params: { provider: 'auto', query: 'deepseek', count: 5 } },
    { id: 'py', type: 'python', label: '整理', params: { code: 'print("x")' } },
    { id: 'ai', type: 'subagent', label: '写稿', params: { model: 'dsh:deepseek-flash', prompt: '写一段' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'seed' },
    { from: 'seed', to: 'fetch' },
    { from: 'fetch', to: 'py' },
    { from: 'py', to: 'ai' },
    { from: 'ai', to: 'end' },
  ],
  layout: {
    start: { x: 40, y: 240 }, seed: { x: 260, y: 60 }, fetch: { x: 500, y: 60 },
    py: { x: 740, y: 60 }, ai: { x: 500, y: 300 }, end: { x: 800, y: 300 },
  },
};

/** ?big=1：大图夹具（2026-10-03 画布缩放用例）—— 14 节点铺开在 ~2600×1500 世界坐标上，
 *  在 1374×800 视口里 fit 只有 ~0.45 → 用来验证「进画布默认不会小到看不清（≥75%）」
 *  与「⤢ 适应画布有 50% 缩放下限」两条 clamp。 */
const bigDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `step${i + 1}`, type: 'log', label: `步骤${i + 1}`, params: { level: 'info', message: `s${i + 1}` },
    })),
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'step1' },
    ...Array.from({ length: 11 }, (_, i) => ({ from: `step${i + 1}`, to: `step${i + 2}` })),
    { from: 'step12', to: 'end' },
  ],
  layout: {
    start: { x: 60, y: 700 },
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`step${i + 1}`, { x: 320 + (i % 4) * 700, y: 100 + Math.floor(i / 4) * 520 }])),
    end: { x: 3120, y: 620 },
  },
};

/** ?huge=1：23 节点的「真实规模」夹具（对标用户真实工作流「金融政策日报」23 节点）——
 *  用于性能实测：点输入框 / 复制文字的开销是否随节点数增长（2026-10-04 用户反馈卡顿）。
 *  节点类型混排（含 subagent/http/web_search 等"字段多"的节点），比纯 log 更接近真实渲染重量。 */
const hugeDef: any = (() => {
  const nodes: any[] = [{ id: 'start', type: 'start', params: {} }];
  const edges: any[] = [];
  const layout: Record<string, { x: number; y: number }> = { start: { x: 40, y: 700 } };
  const kinds: Array<[string, any]> = [
    ['python', { code: 'print(1)' }],
    ['log', { level: 'info', message: 'm' }],
    ['set_var', { vars: { a: 1 } }],
    ['http', { url: 'https://example.com', method: 'GET' }],
    ['web_search', { query: 'x' }],
    ['subagent', { prompt: 'p', model: 'stub-model' }],
  ];
  let prev = 'start';
  for (let i = 0; i < 21; i++) {
    const [type, params] = kinds[i % kinds.length];
    const id = `${type}_${i + 1}`;
    nodes.push({ id, type, label: `${type}${i + 1}`, params });
    edges.push({ from: prev, to: id });
    layout[id] = { x: 320 + (i % 5) * 620, y: 80 + Math.floor(i / 5) * 460 };
    prev = id;
  }
  nodes.push({ id: 'end', type: 'end', params: {} });
  edges.push({ from: prev, to: 'end' });
  layout.end = { x: 320 + (21 % 5) * 620 + 620, y: 80 + Math.floor(21 / 5) * 460 };
  return { name: wfName, version: 1, nodes, edges, layout };
})();

/** ?goto=1：失败策略「回跳不生效」告警夹具（2026-10-04 轮 5）
 *  形状：start → boom(失败策略 = 跳到 start，**start 在它之前** → 引擎按"停止这条支路"处理)
 *  → 断言问题面板给出 warn（提前显形，不必等运行）。 */
const gotoWarnDef: any = {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {} },
    { id: 'boom', type: 'python', label: '会失败的步骤', params: { code: 'import sys\nsys.exit(1)' }, onError: { goto: 'start' } },
    { id: 'tail', type: 'log', label: '后续', params: { level: 'info', message: 'tail' } },
    { id: 'end', type: 'end', params: {} },
  ],
  edges: [
    { from: 'start', to: 'boom' }, { from: 'boom', to: 'tail' }, { from: 'tail', to: 'end' },
  ],
  layout: { start: { x: 60, y: 200 }, boom: { x: 340, y: 200 }, tail: { x: 620, y: 200 }, end: { x: 900, y: 200 } },
};

const initialDef: any = params.has('goto') ? gotoWarnDef : params.has('huge') ? hugeDef : params.has('big') ? bigDef : params.has('vars') ? varsDef : params.has('jump') ? jumpDef : params.has('chips') ? chipsDef : params.has('stale') ? staleDef : params.has('many') ? manyDef : params.has('loop') ? loopDef : params.has('branch') ? branchDef : {
  name: wfName,
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {}, next: 'end' },
    { id: 'end', type: 'end', params: {} },
  ],
  layout: { start: { x: 80, y: 80 }, end: { x: 480, y: 80 } },
};

// ★ 子工作流跳转（?jump=1）：ctx.nav 接的是**生产同一份** navStack 逻辑，宿主侧只提供「换 def」能力。
//   生产 = setDockDef(def, bump) 重挂载停靠面板；这里 = setState + key 变化重挂载（效果一致，
//   从而让 CDP 也能验证「返回后重新选中来源节点」这条路径）。
function Fixture(): any {
  const [def, setDef] = useState<any>(initialDef);
  const [focus, setFocus] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  bindNavSwap((next, focusNodeId) => {
    setDef(next);
    setFocus(focusNodeId);
    setEpoch((n) => n + 1);
  });
  setNavCurrent(def);
  return createElement(FlowPanel, {
    key: epoch,
    ctx: {
      workflow: def,
      focusNodeId: focus,
      nav: { crumbs: navCrumbs(), current: navCurrentName() || def.name, enter: enterSubWorkflow, back: backToParentWorkflow },
      onChange: (d: any) => { (window as any).__df_def = d; },
    } as any,
    onClose: () => {},
    onCache: (d: any) => { setNavCurrent(d); (window as any).__df_def = d; },
  } as any);
}

createRoot(document.getElementById('root')!).render(createElement(Fixture));

