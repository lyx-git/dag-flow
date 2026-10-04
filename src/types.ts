// src/types.ts — 共享类型与 JSON Schema
// v0.1 单一来源真相，被 parser / executor / registry 共用

import { WORKFLOW_NAME_PATTERN } from './name-rule';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

export interface WorkflowDef {
  name: string;
  version: 1;
  description?: string;
  inputs?: Record<string, JsonValue>;
  nodes: Node[];
  edges?: Edge[]; // 可选；若提供则覆盖 node.next
  /** 布局持久化：节点位置映射 { [nodeId]: {x,y} }（DAG 设计） */
  layout?: Record<string, { x: number; y: number }>;
}

export interface Node {
  id: string;
  type: string;
  params?: Record<string, JsonValue>;
  next?: NextRef;
  onError?: 'stop' | 'continue' | { goto: string };
  /** ★ 容错开关（2026-10-03 用户拍板 A 方案）：勾选后**本节点失败不中断后续层**——
   *  错误仍记在 result.error 且 result.tolerated=true，运行汇总计入 toleratedCount，
   *  下游节点照常执行（注意：失败节点没有 out，下游 {{本节点.out}} 解析为 null，
   *  错因请看节点悬浮卡 / 运行汇总）。
   *  动机：DAG 模式（def 带 edges）下节点级 onError 完全不生效，一次抓取/发信失败会把整条流水线拖垮。
   *  默认不勾 = 原语义（失败即中断后续层）。取消（RUN_CANCELLED）永远不算容错。 */
  tolerate?: boolean;
  label?: string;
}

export interface Edge {
  from: string;
  to: string;
  /** 分支键：if 用 'true'/'false'，switch 用 case 值（'*' 为兜底），普通边省略。
   *  ★ 2026-10-04 由字面量联合放宽为 string：WORKFLOW_SCHEMA 一直是 { type: 'string' }，
   *  switch 的 case 值本来就是任意字符串（旧联合类型迫使客户端 at flowDef.ts:167 强转）。 */
  when?: string;
}

export type NextRef =
  | string
  | string[]
  | { true: string; false: string }
  | Record<string, string>  // switch 多分支：{ [case值]: 目标节点id }（可含 '*' 兜底）
  | null;

export interface NodeResult {
  status: 'success' | 'failed' | 'skipped';
  out?: JsonValue;
  error?: { code: string; message: string; stack?: string };
  /** ★ 该失败已被 tolerate 容错放行（status 仍是 'failed'，仅供界面标注「已容错」与计数） */
  tolerated?: boolean;
  durationMs: number;
  startedAt: string; // ISO
  endedAt: string;   // ISO
}

export interface CtxLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface Context {
  inputs: Record<string, JsonValue>;
  vars: Record<string, JsonValue>;
  results: Record<string, NodeResult>;
  /** 运行时注入：当前执行节点 id（merge 等节点需要知道自身以收集上游输出） */
  currentNodeId?: string;
  /** 运行时注入：节点 → 直接上游 id 列表（merge 节点收集上游输出用） */
  upstreams?: Record<string, string[]>;
  /** 子工作流嵌套深度（subflow 节点防递归爆炸） */
  _depth?: number;
  /** 取消信号（run API 取消/超时控制） */
  signal?: AbortSignal;
  /** 运行时注入：本次运行 id（manual 挂起/恢复要按 runId 定位，2026-10-03） */
  runId?: string;
  /** 运行时注入：是否交互式运行——HTTP /run 为 true（manual 会挂起等确认）；
   *  CLI /workflow 工具与 subflow 子工作流不传 = 非交互（manual 自动通过 + warning） */
  interactive?: boolean;
  /** 运行时注入：manual 节点挂起时通知宿主，API 层据此把 /run 转成 awaiting 响应 */
  onAwaiting?: (info: { runId: string; nodeId: string; prompt: string }) => void;
  /** 运行时注入：宿主日志器（非交互自动通过等场景留痕用；结构对齐 adapter/logger.ts DshLogger） */
  logger?: CtxLogger;
}

// 节点定义（registry 注册时用）
export interface NodeDefinition<P = unknown> {
  type: string;
  schema: object; // JSONSchema
  run: (ctx: Context, params: P) => Promise<NodeResult>;
  describe?: () => { label: string; category: string };
}

// JSON Schema（顶层）
export const WORKFLOW_SCHEMA = {
  $id: 'https://dag-flow/schemas/workflow.json',
  type: 'object',
  required: ['name', 'version', 'nodes'],
  additionalProperties: false,
  properties: {
    // ★ 名字规则唯一源 name-rule.ts（2026-10-02 修复：此前漏同步，中文名工作流保存得了却过不了执行校验）
    name: { type: 'string', pattern: WORKFLOW_NAME_PATTERN },
    version: { const: 1 },
    description: { type: 'string' },
    inputs: { type: 'object', additionalProperties: true },
    nodes: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        required: ['id', 'type'],
        additionalProperties: true,
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
          type: { type: 'string', minLength: 1 },
          params: { type: 'object', additionalProperties: true },
          // 分支键映射（单一 object 分支，2026-10-02 修）：
          // if 节点 {true,false} 与 switch 节点 { [case值]: 目标 } 共用同一形状，
          // 必须合成一个分支——若并列两个 object 分支，{true,false} 会同时命中两个，
          // oneOf 要求「恰好命中一个」，会导致所有 if 节点校验失败。
          next: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              {
                type: 'object',
                minProperties: 1,
                additionalProperties: { type: 'string' },
              },
              { type: 'null' },
            ],
          },
          onError: {
            oneOf: [
              { enum: ['stop', 'continue'] },
              {
                type: 'object',
                required: ['goto'],
                additionalProperties: false,
                properties: { goto: { type: 'string' } },
              },
            ],
          },
          label: { type: 'string' },
          // ★ 容错开关（2026-10-03）：失败不中断后续层（节点级 onError 在 DAG 模式不生效）
          tolerate: { type: 'boolean' },
        },
      },
    },
    // ★ layout=画布节点位置（UI 保存必带；2026-10-02 修复：schema 此前不认 layout，
    //   导致 UI 保存的工作流一执行就被「多余字段」拒绝——「运行按钮没用」的真根因之一）
    layout: { type: 'object', additionalProperties: true },

    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          // 分支键：if 用 true/false，switch 用 case 值（'*' 兜底），普通边省略
          when: { type: 'string' },
        },
      },
    },
  },
} as const;

// 默认节点超时（ms）
export const DEFAULT_NODE_TIMEOUT_MS = 30_000;
export const DEFAULT_LOOP_MAX_ITERATIONS = 1_000;
