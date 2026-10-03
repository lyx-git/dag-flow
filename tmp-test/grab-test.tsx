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
const wfName = new URLSearchParams(location.search).get('name') ?? '测试工作流';

const initialDef: any = {
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
