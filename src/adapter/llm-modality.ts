// src/adapter/llm-modality.ts — 模型能力（多模态）校验
// prompt 引用了图片/视频/文件而所选模型能力不含对应模态时给出人话提示（runSubagentNode 调用前校验）。
// 2026-10-14 重构轮 3 自 subagent.ts 纯搬运拆出；符号经 subagent.ts 再导出（导入路径不变）。

import type { LlmEndpoint } from '../dsh-gate/llm-config.js';

/** 模态 → 触发扩展名（prompt 中引用此类文件而模型不支持对应模态时提示） */
const MODALITY_EXTS: Record<string, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)\b/gi,
  video: /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)\b/gi,
  file: /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi,
};

/**
 * ★ 超过这个长度的提示词按「材料型」处理、**不做模态推断**（2026-10-08 真机踩到）。
 * 起因：金融政策日报的分析节点提示词里灌了 1.5~4 万字的新闻正文，而财政部/证监会页面的
 * 「附件下载：…（征求意见稿）.pdf」这类字样在正文里是常态 → 被误判成"prompt 引用了文件"
 * → MODEL_MODALITY_MISMATCH 直接判节点失败，整份报告跟着失败。
 * 判据：**短提示词是"指令"（用户让模型看文件才是真需求），长提示词是"材料"（里面出现
 * 文件名只是引文）**。指令型提示词一般 <2000 字，材料型 >8000 字，取 4000 留余量。
 * 代价（已知、可接受）：超长指令里引用的图片/文件不再被拦——那只会让模型看不到该文件、
 * 按文本作答，属于降级而非致命；而误判会直接让节点失败，代价大得多。
 */
export const MODALITY_SCAN_MAX_CHARS = 4000;

/** 从文本中检测引用的多模态类型集合（image/video/file） */
export function detectModalities(text: string): string[] {
  const out = new Set<string>();
  for (const [modality, re] of Object.entries(MODALITY_EXTS)) {
    re.lastIndex = 0;
    if (re.test(String(text))) out.add(modality);
  }
  return [...out];
}

/**
 * 运行前模态校验：prompt 引用了图片/视频/文件，而所选模型的 input 能力不含对应模态 → 返回提示消息；通过返回 null。
 * input 未标注的模型按 dsh 语义视为仅文本（['text']）。
 */
export function checkModelModality(endpoint: Pick<LlmEndpoint, 'input' | 'model' | 'providerName' | 'modelLabel'>, prompt: string): string | null {
  const text = String(prompt ?? '');
  // ★ 材料型提示词（长文本）不做模态推断——正文里出现「附件.pdf」这类字样是引文，不是让模型读文件
  if (text.length > MODALITY_SCAN_MAX_CHARS) return null;
  const needed = detectModalities(text);
  if (needed.length === 0) return null;
  const caps = endpoint.input?.length ? endpoint.input : ['text'];
  const missing = needed.filter((m) => !caps.includes(m));
  if (missing.length === 0) return null;
  const label: Record<string, string> = { image: '图片', video: '视频', file: '文件' };
  const missingLabel = missing.map((m) => label[m] ?? m).join('、');
  const suggest = missing.includes('image') ? '（如 dsh:custom-model:kimi-k3 / minimax-m3）' : '';
  // ★ 错误消息用**显示名**（2026-10-03 用户要求「不用模型id，不容易分辨」，与下拉文案同口径）：
  //   modelLabel（宿主显示名 / settings 的 name）→ providerName → model 三级回退。
  return `所选模型 ${endpoint.modelLabel ?? endpoint.providerName ?? endpoint.model} 不支持${missingLabel}输入（能力: ${caps.join(', ')}）——prompt 中引用了${missingLabel}。请换支持对应模态的模型${suggest}，或在 dsh 配置（profile 的 cordis.patch.yml，旧版 settings.yaml）里为该模型标注 input: [text, image]`;
}

/**
 * ★ 2026-10-16 P2（**不静默降级**）：按 `images` 参数的**真实条数**再判一次模态。
 *
 * 与上面 `checkModelModality`（扫 prompt 里的扩展名）是**两条互补的判据**，都要保留：
 *   · prompt 扫描防的是"让模型读 PDF/图片路径"这种白跑（2026-10-08 特意加的）；
 *   · 本函数防的是"**配了图但模型不收图**"——那种情况下图片会被静默丢弃、模型只拿到文本，
 *     用户却以为图已经发出去了（最难发现的一类降级）。
 *
 * `count === 0` ⇒ 返回 null（不干预：不填 images 时行为与改动前完全一致）。
 */
export function checkImageModality(
  endpoint: Pick<LlmEndpoint, 'input' | 'model' | 'providerName' | 'modelLabel'>,
  count: number,
): string | null {
  if (!count) return null;
  const caps = endpoint.input?.length ? endpoint.input : ['text'];
  if (caps.includes('image')) return null;
  const who = endpoint.modelLabel ?? endpoint.providerName ?? endpoint.model;
  return `你配了 ${count} 张图片，但所选模型 ${who} 不支持图片输入（能力: ${caps.join(', ')}）——已停止本次调用：图片既不会静默丢掉、也不会只发文本。请换一个带「· 📷 图片」的模型（如 dsh:custom-model:kimi-k3 / minimax-m3），或清空 images 参数；也可以在 dsh 配置（profile 的 cordis.patch.yml，旧版 settings.yaml）里为该模型标注 input: [text, image] 后刷新。`;
}
