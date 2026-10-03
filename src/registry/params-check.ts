// src/registry/params-check.ts — 节点 params 必填项集中校验
//
// 目标：防止"生成的 DAG 工作流无法使用"——AI 生成或手写的工作流在运行前一次性
// 检出参数缺失，而不是跑到一半被节点失败中断（默认 stop 语义）或静默出错。
//
// 拦截范围（只做「执行层没有明确错误码、会静默出错或报错含糊」的项）：
//   python/bash  code 纯空白（run 内只查空串，空白会 spawn 后才语法报错）
//   http         url 空白（run 内无检查，fetch('') 报 Invalid URL 含糊）
//   if           condition 空白（静默当 false，分支走错）
//   switch       value 空白 / cases 空对象（静默 matched=''，分支全 skip）
//   log          message 空白（静默输出 "[workflow] undefined"）
//   manual       prompt 空白（确认弹窗里没有任何等待说明）
//   set_var      vars 缺失/非对象/空对象（静默成功但什么都没写）
//   subflow      workflowName 空白（not found 报错含糊）
//   file_save    filename 空白（落到 saveAsset 才报含糊错误）
//
// 不在预检范围（已有专属错误码，语义被测试锁定，避免预检抢码）：
//   subagent（MODEL_REQUIRED / SUBAGENT_EMPTY_PROMPT）、web_search（SEARCH_EMPTY_QUERY）、
//   web_fetch（FETCH_NO_URL）、image_generate / video_generate（IMAGE_NO_* / VIDEO_NO_*）、
//   session_input（SESSION_INPUT_NOT_FOUND）、merge（MERGE_NO_UPSTREAM）、loop（LOOP_NO_BOUND）
//
// {{}} 模板引用（如 "{{u.out.x}}" / "{{inputs.u}}"）视为合法非空——运行时才解析。

import type { JsonValue, WorkflowDef } from '../types.js';

export interface ParamProblem {
  nodeId: string;
  type: string;
  msg: string;
}

function isBlank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim().length === 0;
}

/** 单节点检查器：返回该节点的问题消息列表（空数组 = 通过） */
type Checker = (params: Record<string, JsonValue>) => string[];

const CHECKERS: Record<string, Checker> = {
  python: (p) =>
    isBlank(p.code) && isBlank(p.codePath)
      ? ['code/codePath 为空（纯空白也不允许）——填写要执行的 Python 代码']
      : [],
  bash: (p) =>
    isBlank(p.code) && isBlank(p.codePath)
      ? ['code/codePath 为空（纯空白也不允许）——填写要执行的 Bash 脚本']
      : [],
  http: (p) => (isBlank(p.url) ? ['url 为空——填写请求地址（可引用 {{u.out.xxx}}）'] : []),
  if: (p) => (isBlank(p.condition) ? ['condition 为空——条件表达式缺失会静默走 false 分支'] : []),
  switch: (p) => {
    const problems: string[] = [];
    if (isBlank(p.value)) problems.push('value 为空——匹配值缺失会静默匹配不到任何分支');
    const cases = p.cases;
    if (cases == null || typeof cases !== 'object' || Array.isArray(cases) || Object.keys(cases as object).length === 0) {
      problems.push('cases 为空——至少配置一个分支（{匹配值: 目标节点id}），或含 "*" 兜底');
    }
    return problems;
  },
  log: (p) => (isBlank(p.message) ? ['message 为空——日志会输出 "undefined"'] : []),
  manual: (p) => (isBlank(p.prompt) ? ['prompt 为空——用户将看不到任何等待输入的说明'] : []),
  set_var: (p) => {
    const vars = p.vars;
    if (vars == null || typeof vars !== 'object' || Array.isArray(vars) || Object.keys(vars as object).length === 0) {
      return ['vars 为空——set_var 节点没有要写入的变量，属于无效节点'];
    }
    return [];
  },
  subflow: (p) => (isBlank(p.workflowName) ? ['workflowName 为空——填写要调用的子工作流名称'] : []),
  file_save: (p) => (isBlank(p.filename) ? ['filename 为空——填写保存文件名（可含子目录）'] : []),
};

/** 校验单个节点的 params；返回问题列表（空数组 = 通过） */
export function checkNodeParams(type: string, params: Record<string, JsonValue> | undefined, nodeId: string): ParamProblem[] {
  const checker = CHECKERS[type];
  if (!checker) return []; // 未知类型由执行器报 UNKNOWN_NODE_TYPE
  const msgs = checker(params ?? {});
  return msgs.map((msg) => ({ nodeId, type, msg }));
}

/** 校验整个工作流全部节点；返回问题列表（空数组 = 通过） */
export function checkWorkflowParams(def: Pick<WorkflowDef, 'nodes'>): ParamProblem[] {
  const problems: ParamProblem[] = [];
  for (const node of def.nodes ?? []) {
    problems.push(...checkNodeParams(node.type, node.params as Record<string, JsonValue>, node.id));
  }
  return problems;
}

/** 把问题列表格式化成一条可读错误消息（用于 NODE_PARAMS_INVALID / AI 生成拒绝）。
 *  ★ labels 可选（2026-10-02 用户要求）：传入「节点 id → 显示名_id」映射，让错误消息
 *  带上节点显示名（如「网页抓取：样例正文_web_fetch1」），一眼定位问题节点。 */
export function formatParamProblems(problems: ParamProblem[], labels?: (id: string) => string): string {
  return problems
    .map((p) => {
      const tag = labels ? labels(p.nodeId) : p.nodeId;
      return `节点 ${tag}(${p.type}): ${p.msg}`;
    })
    .join('；');
}
