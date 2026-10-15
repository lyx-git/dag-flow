// src/dsh-gate/attachments.ts — 防腐层·宿主附件服务门面（2026-10-15，多模态 Step 0）
//
// ★ DSH 附件服务（AttachmentStore，包 @deepseek-ai/dsh-attachment）的形状假设**只在本文件声明**。
//   dsh 升版改附件 API（方法名/入参/限制字段）时只改这里；业务代码只依赖本模块的稳定签名。
//
// 2026-10-15 经 dsh 包类型文件逐条实证（@deepseek-ai/dsh-attachment/lib/types/*.d.ts）：
//   · saveImage({data: Uint8Array, mediaType, name?}) → ImageAttachmentRef{attachmentId,mediaType,bytes,width,height,name?}
//   · saveImages([...]) 批量：**先全校验再落盘**、按输入序返回（部分失败不留半份引用）
//   · validateImage(input) 只校验不落盘
//   · imageLimits = {maxImageBytes, maxImagesPerMessage, maxMessageImageBytes, maxImagePixels, maxImageDimension, mediaTypes}
//   · mediaType 只认 image/png | image/jpeg | image/webp | image/gif
//   ★ attachmentId 是**不透明 id，不是路径/URL**；图片经宿主**内容寻址**入库 <DSH_HOME>/attachments/v1（同图去重）。
//   ★ 跑进模型 = GenerateOptions.messages[].content 里的 {type:'image', attachment: ref}（ImageBlock）。
//   ★ 服务名必须写进 HOST_INJECT（fiber.store 只快照 inject 名单）。
//   ★ 本机已挂载的运行时证据：dsh-base 的 cordis.patch.yml 有 `- id: attachment-local`，
//     且 `read_image` 工具只在 ctx.inject(['attachments']) 下注册（能调它 ⇒ 服务在）。
//
// ★ 零依赖 R3：**不 import @deepseek-ai/* 的类型**（未加该依赖），只在本模块定义结构化最小接口。

import { hostService } from './host.js';

/** 宿主图片限制（字段名与宿主 imageLimits 对齐；缺失字段按"未知"处理，不猜默认值） */
export interface HostImageLimits {
  maxImageBytes?: number;
  maxImagesPerMessage?: number;
  maxMessageImageBytes?: number;
  maxImagePixels?: number;
  maxImageDimension?: number;
  mediaTypes?: readonly string[];
}

/** 不透明图片引用（与宿主 ImageAttachmentRef 同形；attachmentId 不是路径也不是 bearer URL） */
export interface HostImageRef {
  attachmentId: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
}

/** 落盘一张图片的入参（字节 + 声明媒体类型 + 可选显示名） */
export interface SaveImageInput {
  data: Uint8Array;
  mediaType: string;
  name?: string;
}

/** 宿主附件服务的稳定形状（业务代码只依赖本接口） */
export interface HostAttachmentsRuntime {
  imageLimits?: HostImageLimits;
  saveImage?: (input: SaveImageInput) => Promise<HostImageRef>;
  saveImages?: (inputs: readonly SaveImageInput[]) => Promise<readonly HostImageRef[]>;
  validateImage?: (input: SaveImageInput) => Promise<void>;
}

/** 取宿主附件服务（未注入/不可用时返回 undefined，调用方自行降级或**明确失败**，不静默丢图）。 */
export function hostAttachments(): HostAttachmentsRuntime | undefined {
  return hostService('attachments') as HostAttachmentsRuntime | undefined;
}

/**
 * 只读诊断：把附件服务的可用性摘成一行（启动日志 + 探针用；**任何异常都不抛**）。
 * 例：`attachments ok (saveImage+saveImages; png/jpeg/webp/gif; maxImagesPerMessage=?, maxImageBytes=?)`
 */
export function describeAttachments(): string {
  let svc: HostAttachmentsRuntime | undefined;
  try {
    svc = hostAttachments();
  } catch {
    return 'attachments unavailable (probe threw)';
  }
  if (!svc) return 'attachments unavailable';
  const caps = [
    typeof svc.saveImage === 'function' ? 'saveImage' : null,
    typeof svc.saveImages === 'function' ? 'saveImages' : null,
  ].filter(Boolean).join('+') || 'no-writer';
  const lim = svc.imageLimits;
  if (!lim) return `attachments ok (${caps}; limits unknown)`;
  const mt = (lim.mediaTypes ?? []).map((m) => String(m).replace(/^image\//, '')).join('/') || '?';
  return `attachments ok (${caps}; ${mt}; maxImagesPerMessage=${lim.maxImagesPerMessage ?? '?'}, maxImageBytes=${lim.maxImageBytes ?? '?'}, maxImageDimension=${lim.maxImageDimension ?? '?'})`;
}
