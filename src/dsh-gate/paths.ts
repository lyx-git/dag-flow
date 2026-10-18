// src/dsh-gate/paths.ts — 防腐层·DSH 文件系统布局
//
// ★ DSH 主目录与派生路径的唯一出处（2026-09-27 降耦审计意见 2 落地）：
//   此前 5 处各自拼接 ~/.dsh 且行为不一致（仅 sessions 尊重 DSH_HOME，
//   subagent/runtime/storage 裸拼 homedir），便携/自定义安装（DSH_HOME 指向别处）
//   时 AI 节点读不到模型配置而会话节点正常。统一后所有 ~/.dsh 直读走本模块。
//
// dsh 升版改目录布局（如 .dsh 改名、sessions 挪位置）时只改本文件。
// 注：scripts/download-runtime.mjs 为独立脚本无法 import TS，内有一份同步副本。

import * as os from 'node:os';
import * as path from 'node:path';
import { isValidWorkflowName } from '../name-rule.js';

/** DSH 主目录（settings.yaml / .credentials.yaml / profiles / sessions / runtime 的根）。
 *  DSH_HOME 环境变量优先（便携/自定义安装），默认 ~/.dsh。每次调用时求值。 */
export function dshHome(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

// —— 派生路径（函数形态：由调用方决定固化时机；subagent/sessions 在模块顶层调用
//    以保持「import 前设 DSH_HOME」的测试契约，见 llm-config.test.mjs L15 注释）——

/** 会话存储根（sessions.ts 的「会话输入」节点数据源） */
export function sessionsRoot(): string {
  return path.join(dshHome(), 'sessions');
}

/** DSH 全局设置（LLM 配置等；0.2.0 起部分键迁入 profile patch，读取链见 dsh-gate/llm-config.ts） */
export function settingsYamlPath(): string {
  return path.join(dshHome(), 'settings.yaml');
}

/** 凭证存储（refs.<ENV名> = key 或同名环境变量） */
export function credentialsYamlPath(): string {
  return path.join(dshHome(), '.credentials.yaml');
}

/** ★ dag-flow 自己的数据根（**与 DSH 工作区无关**，2026-10-11 用户拍板）：
 *  「dag-flow 创建的文件，不依赖于 dsh 的工作区，默认放在 <DSH_HOME>\.dag-flow 文件夹下，
 *    避免工作区没选择的问题」—— 所有落盘路径（workflow/ runs/ tmp/ tmp/logs/ scripts/ 产出/ schedules.json）
 *  都锚定到这里。改布局只改本函数。 */
export function dagFlowHome(): string {
  return path.join(dshHome(), '.dag-flow');
}

/** ★ 统一图片目录 `<DSH_HOME>/.dag-flow/images/`（2026-10-16 用户拍板原话：「读取图片的位置，
 *  放在统一的位置，方便后续文档解析节点解析出来的图片，也放到同一个位置使用」）。
 *  ＝ AI 节点 `images` 参数里相对路径的唯一基准（写文件名即可），也是 doc_parse 将来抽图的落点。
 *  别在别处再拼 'images'——要改布局只改本函数。
 *  ★ 2026-10-19 用户新要求：**每个工作流产生的文件按工作流名分目录** ⇒ 新写入走
 *    `dagFlowScopedPath('images', 工作流名)`；本函数保留为**根目录**（历史平铺图片的读取兜底）。 */
export function dagFlowImagesDir(): string {
  return path.join(dagFlowHome(), 'images');
}

/** ★ 2026-10-19 用户原话：「dag-flow插件每个工作流产生的文件都要以 .dag-flow/**\/工作流名称/文件
 *  的方式存放，如果文件夹不存在，dag-flow需要自动创建」。
 *  某工作流的专属子目录：`<数据根>/<kind>/<工作流名>`。
 *  · name 非法/为空 ⇒ 退回 `<数据根>/<kind>`（兼容历史平铺文件、以及没有工作流上下文的调用）；
 *  · 只算路径**不建目录**——建目录由调用方按需 `fs.mkdir(..., {recursive:true})`。
 *  · kind 的取值与数据根下的目录一一对应：images / tmp / runs / scripts。 */
export function dagFlowScopedPath(kind: 'images' | 'tmp' | 'runs' | 'scripts', wfName?: string): string {
  // ★ 2026-10-18 用户要求：「工作流层面不能随意删除的，都搬到 .dsh/.dag-flow/workflow 文件夹下，
  //   比如 scripts 的脚本（python/bash 节点脚本存放的位置）」——scripts 属于**持久**数据，
  //   改挂到 workflow/scripts 下；images / tmp / runs 仍在数据根同级。
  const base = kind === 'scripts'
    ? path.join(dagFlowHome(), 'workflow', 'scripts')
    : path.join(dagFlowHome(), kind);
  const name = String(wfName ?? '').trim();
  if (!name || !isValidWorkflowName(name)) return base;
  return path.join(base, name);
}

/** ★ 2026-10-18 用户要求（原话）：「同一个工作流每次执行的时候，在 tmp 目录下新建一个新的目录，
 *  保证本次运行的文件都在此处，节点之间相互读取数据的时候，也在这个临时目录下读取，
 *  保证不会读取到其他执行的数据，每个工作流保持最新的 5 条执行产生的临时数据」。
 *  ⇒ **一次运行独占的临时目录**：`<数据根>/tmp/<顶层工作流名>/<runId>/`。
 *  · runId 做字符白名单（防 `../` 之类跑出 tmp 根）；空 runId 退回 `<数据根>/tmp/<名>`（兼容旧行为）；
 *  · 只算路径**不建目录**——建目录由执行器在运行时做。 */
export function dagFlowRunTmpDir(wfName: string, runId: string): string {
  const base = dagFlowScopedPath('tmp', wfName);
  const id = String(runId ?? '').trim().replace(/[^\w.-]/g, '_');
  return id ? path.join(base, id) : base;
}

/** ★ 2026-10-18：运行目录**相对数据根**的子路径（'tmp/<名>/<runId>'，一律 `/` 分隔）。
 *  给「📁 数据存于 … → 打开文件夹」用：服务端算好，客户端不必自己拼（工作流名会做白名单）。 */
export function dagFlowRunTmpSubDir(wfName: string, runId: string): string {
  const parts = ['tmp'];
  const name = String(wfName ?? '').trim();
  if (name && isValidWorkflowName(name)) parts.push(name);
  const id = String(runId ?? '').trim().replace(/[^\w.-]/g, '_');
  if (id) parts.push(id);
  return parts.join('/');
}

/** profile 目录根（0.2.0 的配置持久层 profiles/<name>/cordis.patch.yml） */
export function profilesDir(): string {
  return path.join(dshHome(), 'profiles');
}

/** 某 profile 的 cordis.patch.yml 完整路径 */
export function profilePatchPath(profile: string): string {
  return path.join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
}
