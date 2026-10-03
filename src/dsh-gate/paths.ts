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

/** profile 目录根（0.2.0 的配置持久层 profiles/<name>/cordis.patch.yml） */
export function profilesDir(): string {
  return path.join(dshHome(), 'profiles');
}

/** 某 profile 的 cordis.patch.yml 完整路径 */
export function profilePatchPath(profile: string): string {
  return path.join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
}
