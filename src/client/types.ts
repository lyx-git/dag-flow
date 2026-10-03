// src/client/types.ts
// 客户端 React 域的类型与常量，与 src/types.ts (Node 服务端) 解耦 ——
// react 域不能拉 Node child_process / fetch 等副作用代码。
// 字段集对齐 src/types.ts 的 WorkflowDef / Node / Edge，但只放 React 需要用的。

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export type NextRef =
  | string
  | string[]
  | { true: string; false: string }
  | Record<string, string>  // switch 多分支：{ [case值]: 目标节点id }（可含 '*' 兜底）
  | null;

export interface ClientNode {
  id: string;
  type: string;
  params?: Record<string, JsonValue>;
  next?: NextRef;
  onError?: 'stop' | 'continue' | { goto: string };
  label?: string;
}

export interface ClientEdge {
  from: string;
  to: string;
  when?: 'true' | 'false' | 'always';
}

export interface WorkflowDef {
  name: string;
  version: 1;
  description?: string;
  inputs?: Record<string, JsonValue>;
  nodes: ClientNode[];
  edges?: ClientEdge[];
  /** 布局持久化：节点位置映射 { [nodeId]: {x,y} }（DAG 设计，避免重开重置） */
  layout?: Record<string, { x: number; y: number }>;
}

/** 单个内置节点元数据（左侧 palette + 节点卡片配色用） */
export interface NodeMeta {
  type: string;
  label: string;
  emoji: string;
  color: string;       // 节点卡片左条色（border-color）
  bg: string;          // 节点卡片背景色
  text: string;        // 节点卡片标题色
  category: 'control' | 'script' | 'io' | 'ai' | 'data' | 'misc' | 'media';
  hasTrueFalseHandle?: boolean; // if 节点：双 source handle (true/false)
  defaultParams?: Record<string, JsonValue>;
}

/** 20 个内置节点（与 src/registry/builtin.ts 一一对应） */
export const NODE_PALETTE: NodeMeta[] = [
  { type: 'start', label: '开始', emoji: '🟢', color: '#10b981', bg: '#ecfdf5', text: '#065f46', category: 'control' },
  { type: 'end', label: '结束', emoji: '🔴', color: '#f43f5e', bg: '#fff1f2', text: '#9f1239', category: 'control' },
  { type: 'python', label: 'Python', emoji: '🐍', color: '#a855f7', bg: '#faf5ff', text: '#6b21a8', category: 'script', defaultParams: { code: '', timeoutMs: 30000 } },
  { type: 'bash', label: 'Bash', emoji: '📦', color: '#f59e0b', bg: '#fffbeb', text: '#92400e', category: 'script', defaultParams: { code: '', timeoutMs: 30000 } },
  { type: 'http', label: 'HTTP', emoji: '🌐', color: '#3b82f6', bg: '#eff6ff', text: '#1e40af', category: 'io', defaultParams: { method: 'GET', url: '' } },
  { type: 'web_search', label: '网页搜索', emoji: '🔍', color: '#f59e0b', bg: '#fffbeb', text: '#92400e', category: 'io', defaultParams: { query: '', provider: 'auto', count: 8 } },
  { type: 'web_fetch', label: '网页抓取', emoji: '📄', color: '#14b8a6', bg: '#f0fdfa', text: '#0f766e', category: 'io', defaultParams: { url: '', maxChars: 8000 } },
  { type: 'subagent', label: 'AI 子代理', emoji: '🤖', color: '#06b6d4', bg: '#ecfeff', text: '#155e75', category: 'ai', defaultParams: { prompt: '' } },
  { type: 'session_input', label: '会话输入', emoji: '💬', color: '#14b8a6', bg: '#f0fdfa', text: '#0f766e', category: 'ai', defaultParams: { sessionId: '', limit: 10 } },
  { type: 'if', label: '条件分支', emoji: '🔀', color: '#ec4899', bg: '#fdf2f8', text: '#9d174d', category: 'control', hasTrueFalseHandle: true, defaultParams: { condition: 'count > 0' } },
  { type: 'switch', label: '多路分支', emoji: '🔃', color: '#d946ef', bg: '#fae8ff', text: '#86198f', category: 'control', defaultParams: { value: '', cases: {} } },
  { type: 'merge', label: '合流', emoji: '🧲', color: '#6366f1', bg: '#eef2ff', text: '#3730a3', category: 'control' },
  { type: 'subflow', label: '子工作流', emoji: '🧩', color: '#0ea5e9', bg: '#f0f9ff', text: '#0c4a6e', category: 'control', defaultParams: { workflowName: '', inputs: {} } },
  { type: 'loop', label: '循环', emoji: '🔁', color: '#f97316', bg: '#fff7ed', text: '#9a3412', category: 'control', defaultParams: { count: 3 } },
  { type: 'set_var', label: '设置变量', emoji: '🔢', color: '#0ea5e9', bg: '#f0f9ff', text: '#0c4a6e', category: 'data', defaultParams: { vars: {} } },
  { type: 'log', label: '日志', emoji: '📝', color: '#64748b', bg: '#f8fafc', text: '#334155', category: 'misc', defaultParams: { level: 'info', message: '' } },
  { type: 'manual', label: '手动确认', emoji: '✋', color: '#84cc16', bg: '#f7fee7', text: '#3f6212', category: 'control', defaultParams: { prompt: '' } },
  { type: 'image_generate', label: '图片生成', emoji: '🖼', color: '#f472b6', bg: '#fdf2f8', text: '#9d174d', category: 'media', defaultParams: { prompt: '', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wanx-v1', size: '1024*1024', n: 1, apiKeyEnv: 'DASHSCOPE_API_KEY' } },
  { type: 'video_generate', label: '视频生成', emoji: '🎬', color: '#38bdf8', bg: '#f0f9ff', text: '#0c4a6e', category: 'media', defaultParams: { submitUrl: '', pollUrl: '', pollIntervalMs: 5000, maxWaitMs: 600000 } },
  { type: 'file_save', label: '文件保存', emoji: '💾', color: '#a3e635', bg: '#f7fee7', text: '#3f6212', category: 'media', defaultParams: { source: 'text', filename: 'output.txt' } },
];

export function findMeta(type: string): NodeMeta | undefined {
  return NODE_PALETTE.find((n) => n.type === type);
}

/** 2 个主视图（thumb/form/manage/ai 已于 2026-10-01 深夜陆续移除） */
export type ViewTab = 'canvas' | 'json';

/**
 * 兜底默认工作流：ctx.workflow 缺失（如按钮 mount 时只传 {}）时用，
 * 避免 FlowPanel `toRF(undefined)` 崩溃白屏。
 */
export const DEFAULT_WORKFLOW: WorkflowDef = {
  name: 'my-workflow',
  version: 1,
  description: '新工作流',
  nodes: [
    { id: 'start', type: 'start', label: '开始' },
    { id: 'end', type: 'end', label: '结束' },
  ],
};

/** mount() 接收的 ctx（业务侧 host 注入，DSH 宿主可用） */
export interface MountContext {
  host?: any;            // dsh host 桥（subagent.spawn 等）
  workflow: WorkflowDef; // 初始工作流
  onChange?: (def: WorkflowDef) => void; // 每次 WorkflowDef 变更
  onRun?: () => void;    // "运行"按钮回调
}
