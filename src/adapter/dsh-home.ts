// src/adapter/dsh-home.ts — DSH 主目录解析（兼容壳）
//
// ★ 2026-10-02 防腐层改造：路径解析已收编 dsh-gate/paths.ts（唯一出处）。
// 本文件只保留原文件路径与导出（llm-config.test.mjs 直接打包本文件断言 dshHome()），
// 新代码一律 import { dshHome } from '../dsh-gate/paths.js'。

export { dshHome } from '../dsh-gate/paths.js';
