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

/**
 * 节点输出字段表（2026-10-03 用户需求：右侧节点面板要展示「上游能传过来的所有变量」「本节点能给下游
 * 输出的所有变量」，点击可复制，**并说明每个变量是干什么的**，方便写工作流时直接用）。
 * 只登记**已核实**的输出形状（逐个读 src/registry/builtin.ts 各 run() 的 out）：
 *   · object  = 输出是对象，fields 是可直接引用的字段/嵌套路径（复制成 {{id.out.<path>}}）
 *   · scalar  = 输出是字符串/布尔（只能整取 {{id.out}}，note 说明它是什么）
 *   · dynamic = 字段随参数或上游而变（note 说明来源），只给整取引用 + 提示，绝不瞎猜字段名
 */
export interface NodeOutField { path: string; desc: string }
export interface NodeOutSpec {
  kind: 'object' | 'scalar' | 'dynamic';
  /** object 型：可直接引用的字段 + 每个字段是干什么的 */
  fields?: NodeOutField[];
  /** scalar/dynamic 型：整份输出是什么 / 字段从哪来 */
  note?: string;
}

export const NODE_OUT_SPECS: Record<string, NodeOutSpec> = {
  start: { kind: 'dynamic', note: '整份输出 = 开始节点收到的输入' },
  end: { kind: 'dynamic', note: '整份输出 = 全局变量 vars + end 配置的 outputs' },
  python: { kind: 'scalar', note: '整份输出 = 脚本 stdout 文本' },
  bash: { kind: 'scalar', note: '整份输出 = 脚本 stdout 文本' },
  subagent: { kind: 'scalar', note: '整份输出 = 模型返回的文本' },
  log: { kind: 'scalar', note: '整份输出 = 日志文本' },
  if: { kind: 'scalar', note: '整份输出 = 布尔值 true / false' },
  http: {
    kind: 'object',
    fields: [
      { path: 'status', desc: 'HTTP 状态码' },
      { path: 'body', desc: '响应体（JSON 自动解析成对象，否则是文本）' },
    ],
  },
  web_search: {
    kind: 'object',
    fields: [
      { path: 'query', desc: '实际用的搜索词' },
      { path: 'engine', desc: '命中的引擎（bing/ddg/…）' },
      { path: 'viaHost', desc: '是否走宿主搜索' },
      { path: 'count', desc: '结果条数' },
      { path: 'results', desc: '结果数组' },
      { path: 'results.0.title', desc: '第 1 条标题' },
      { path: 'results.0.url', desc: '第 1 条链接' },
      { path: 'results.0.snippet', desc: '第 1 条摘要' },
    ],
  },
  web_fetch: {
    kind: 'object',
    fields: [
      { path: 'url', desc: '抓取地址' },
      { path: 'status', desc: 'HTTP 状态码' },
      { path: 'contentType', desc: '响应内容类型' },
      { path: 'mode', desc: '解析模式（text / json / raw）' },
      { path: 'chars', desc: '正文字符数' },
      { path: 'text', desc: '正文文本' },
      { path: 'json', desc: '解析后的 JSON（mode=json 时）' },
    ],
  },
  session_input: { kind: 'dynamic', note: '整份输出 = 读到的会话消息列表' },
  set_var: { kind: 'dynamic', note: '整份输出 = 本节点写入的变量（取值用 {{vars.键名}}，见下方全局变量）' },
  switch: {
    kind: 'object',
    fields: [
      { path: 'matched', desc: '命中的 case 值' },
      { path: 'target', desc: '该 case 指向的节点 id' },
    ],
  },
  loop: {
    kind: 'object',
    fields: [
      { path: 'count', desc: '实际迭代次数' },
      { path: 'items', desc: '每轮结果数组（循环体是子工作流时 = 各轮 end 输出）' },
    ],
  },
  manual: {
    kind: 'object',
    fields: [
      { path: 'prompt', desc: '确认提示语' },
      { path: 'confirmed', desc: '是否已确认' },
      { path: 'value', desc: '用户填写 / 确认的值' },
      { path: 'confirmedAt', desc: '确认时间' },
      { path: 'autoPassed', desc: '是否非交互自动通过' },
    ],
  },
  merge: { kind: 'dynamic', note: '整份输出 = 每个上游一份（键名 = 上游节点 id，或用 keys 参数指定的名字）' },
  subflow: {
    kind: 'object',
    fields: [
      { path: 'workflow', desc: '子工作流名' },
      { path: 'status', desc: '子流程最终状态' },
      { path: 'totalDurationMs', desc: '子流程总耗时' },
      { path: 'output', desc: '子流程 end 节点的输出' },
      { path: 'failedCount', desc: '子流程失败节点数' },
    ],
  },
  image_generate: {
    kind: 'object',
    fields: [
      { path: 'images', desc: '生成的图片数组' },
      { path: 'count', desc: '生成张数' },
      { path: 'images.0.path', desc: '第 1 张的落盘路径' },
      { path: 'images.0.url', desc: '第 1 张的 URL' },
    ],
  },
  video_generate: {
    kind: 'object',
    fields: [
      { path: 'taskId', desc: '任务 id' },
      { path: 'videoUrl', desc: '视频地址' },
      { path: 'path', desc: '本地落盘路径' },
      { path: 'bytes', desc: '文件字节数' },
      { path: 'waitedMs', desc: '轮询等待毫秒' },
    ],
  },
  file_save: {
    kind: 'object',
    fields: [
      { path: 'path', desc: '相对路径（同 relativePath）' },
      { path: 'relativePath', desc: '相对 <DSH_HOME> 的路径（.dag-flow/…）' },
      { path: 'absolutePath', desc: '磁盘绝对路径' },
      { path: 'bytes', desc: '文件字节数' },
      { path: 'source', desc: '内容来源（text / url）' },
      { path: 'preview', desc: '文本内容前 200 字' },
    ],
  },
};

/** 取某节点类型的输出形状（未登记的类型按 dynamic：只给整取引用 + 提示，不猜字段名） */
export function outSpecOf(type: string): NodeOutSpec {
  return NODE_OUT_SPECS[type] ?? { kind: 'dynamic', note: '整份输出（字段随节点实现而变，可先整取看结果）' };
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
