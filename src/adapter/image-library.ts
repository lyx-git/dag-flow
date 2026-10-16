// src/adapter/image-library.ts — 统一图片目录的**写入**侧（2026-10-16 doc_parse 抽图落盘）
//
// 定位：AI 节点 `images` 参数（读）与 doc_parse 抽图（写）共用**同一个目录** `<DSH_HOME>/.dag-flow/images/`
//   （用户拍板：「读取图片的位置，放在统一的位置，方便后续文档解析节点解析出来的图片，也放到同一个位置使用」）。
//   读取侧的解析/载入在 `./image-inputs.ts`；本文件只管"把字节写进去、并给出稳定可复用的文件名"。
//
// 幂等口径（重要）：反复解析同一份文档不应堆出一堆副本 ⇒
//   · 同名 + 内容相同 ⇒ **不重写**（沿用已有文件，标记 reused=true）；
//   · 同名 + 内容不同（文档改版了）⇒ 写成 `<原名>-<内容哈希6>.<ext>`，两份都在，谁也不覆盖谁。
//
// 依赖：node 内置 + 防腐层路径（R3 零依赖）。
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dagFlowImagesDir } from '../dsh-gate/paths.js';

/** mediaType → 扩展名（与 image-inputs / doc-extract 的白名单一致：png/jpeg/webp/gif）。
 *  ★ 2026-10-17：bmp 已从抽图白名单移除（宿主附件服务与「🖼 选图」都不认它）⇒ 该分支不再可达，删除。 */
const EXT_OF_MEDIA: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Windows/Linux 文件名都要安全：只取文件名、去掉非法字符、限长（留出 `-<index>.<ext>` 的余量）。
 *  ★ 2026-10-16 实测踩到：doc_parse 的 `path` 参数可能是**绝对路径**，直接当文件名会被安全化成
 *  `C_Users_..._doc-1.png` 这种长串 ⇒ 这里先取 basename。 */
export function safeImageName(raw: string): string {
  const leaf = String(raw ?? '').replace(/^.*[\\/]/, '');     // 只取文件名（去目录）
  const base = leaf.replace(/\.[A-Za-z0-9]+$/, '');          // 去扩展名（后面按 mediaType 重新加）
  const cleaned = base
    .replace(/[\\/:*?"<>|]+/g, '_')     // 路径分隔符 + Windows 非法字符
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')    // 首尾的点与空格（Windows 不允许结尾点/空格）
    .trim();
  const clipped = cleaned.slice(0, 48);
  return clipped || 'doc';
}

/** 抽出的第 index 张图在统一目录里的文件名：`<文档名>-<index>.<ext>` */
export function libraryNameFor(docName: string, index: number, mediaType: string): string {
  const ext = EXT_OF_MEDIA[mediaType] ?? '.png';
  return `${safeImageName(docName)}-${index}${ext}`;
}

export interface LibraryImageInput {
  /** 期望的文件名（由 `libraryNameFor` 生成） */
  name: string;
  bytes: Buffer | Uint8Array;
  mediaType: string;
}

export interface LibraryImageSaved {
  /** 实际落盘的文件名（冲突时会带内容哈希后缀） */
  name: string;
  /** 绝对路径 */
  path: string;
  bytes: number;
  mediaType: string;
  /** true ＝ 目录里已有同名同内容的文件，本次没重写（幂等） */
  reused: boolean;
}

/**
 * 把一批图片写进统一图片目录（自动建目录）。
 * 单个文件写失败会**直接抛出**（由调用方决定是 fail-soft 还是失败整节点——doc_parse 选择 fail-soft）。
 */
export async function saveImagesToLibrary(items: LibraryImageInput[]): Promise<LibraryImageSaved[]> {
  if (!items.length) return [];
  const dir = dagFlowImagesDir();
  await fs.mkdir(dir, { recursive: true });
  const out: LibraryImageSaved[] = [];
  for (const it of items) {
    const buf = Buffer.isBuffer(it.bytes) ? it.bytes : Buffer.from(it.bytes);
    const want = path.join(dir, path.basename(it.name));
    // ① 同名同内容 ⇒ 直接复用（反复解析同一份文档不会堆副本）
    try {
      const old = await fs.readFile(want);
      if (old.equals(buf)) {
        out.push({ name: path.basename(want), path: want, bytes: buf.length, mediaType: it.mediaType, reused: true });
        continue;
      }
      // ② 同名但内容不同（文档改版）⇒ 加内容哈希后缀，两份都留
      const ext = path.extname(want);
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 6);
      const alt = path.join(dir, `${path.basename(want, ext)}-${hash}${ext}`);
      try {
        const altOld = await fs.readFile(alt);
        if (!altOld.equals(buf)) await fs.writeFile(alt, buf);
      } catch {
        await fs.writeFile(alt, buf);
      }
      out.push({ name: path.basename(alt), path: alt, bytes: buf.length, mediaType: it.mediaType, reused: false });
      continue;
    } catch { /* 不存在 ⇒ 走下面的新建分支 */ }
    await fs.writeFile(want, buf);
    out.push({ name: path.basename(want), path: want, bytes: buf.length, mediaType: it.mediaType, reused: false });
  }
  return out;
}
