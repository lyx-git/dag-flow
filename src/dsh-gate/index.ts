// src/dsh-gate/index.ts — 防腐层统一出口
//
// ★ 防腐层（Anti-Corruption Layer）规约见 ./README.md。
// 业务代码建议直接 import 具体模块（如 '../dsh-gate/host.js'）；本桶出口
// 主要供外部浏览与「一览全部 DSH 触点」用。

export * from './host.js';
export * from './paths.js';
export * from './llm.js';
export * from './registrar.js';
export * from './llm-config.js';
export * from './session-format.js';
