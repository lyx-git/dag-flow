// src/adapter/image-inputs.ts — AI 节点 `images` 参数的解析与载入（2026-10-16 P1 多模态传图）
//
// 职责：把节点参数里写的 images（一个字符串，**每行一个**本地路径或 URL）变成宿主附件服务
//   `saveImages()` 能直接落盘的 `{data, mediaType, name}[]`。
//
// 规范化规则＝2026-10-15 用户拍板：**容忍数组**（上游 `image_generate.out.images` 是数组，
//   元素是对象时取 path→url→file）、只 trim + 跳空行、**不发明注释语法/迷你解析器**；
//   只认 png/jpeg/webp/gif（宿主附件服务限定的四种）。
// ★ 相对路径基准＝**统一图片目录** `<DSH_HOME>/.dag-flow/images/`（2026-10-16 用户拍板：
//   「读取图片的位置，放在统一的位置，方便后续文档解析节点解析出来的图片，也放到同一个位置使用」）
//   —— 因此写裸文件名即可（`chart.png`）；绝对路径原样使用；目录唯一出处＝`dsh-gate/paths.ts`。
//   文档解析节点（doc_parse）将来从 PDF/Office 里抽出的图片也落同一目录，两边天然对齐。
// 上限＝2026-10-16 真机启动诊断实测：`attachments ok (… maxImagesPerMessage=20, maxImageBytes=20971520 …)`。
// ★ 非法项**明确报错**，绝不静默丢图——用户会以为图已经发出去了。
//
// 依赖：只用 node 内置（插件 R3 零依赖约定）；路径走防腐层 `dsh-gate/paths.ts`。
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { dagFlowImagesDir } from '../dsh-gate/paths.js';

/** 宿主附件服务的真机限制（2026-10-16 启动日志实测 maxImagesPerMessage / maxImageBytes） */
export const IMAGE_MAX_COUNT = 20;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** 扩展名 → mediaType（宿主只认这四种；与 dsh-gate/attachments.ts 的真机诊断同源） */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** 统一图片目录（`<DSH_HOME>/.dag-flow/images/`）；相对路径的唯一基准，doc_parse 出图也写这里 */
export function imageDir(): string {
  return dagFlowImagesDir();
}

/** images 相关失败的统一错误（`code` 直接进 NodeResult.error.code；文案一律中文） */
export class ImageInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ImageInputError';
  }
}

/** 一条图片输入：本地路径 或 http(s) URL */
export interface ImageSpec {
  kind: 'path' | 'url';
  value: string;
}

/** 从任意值里收集候选条目（**纯函数**）：字符串按行切；数组递归；对象取 path→url→file。 */
export function collectImageEntries(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.split(/\r?\n/);
  if (Array.isArray(value)) return value.flatMap((v) => collectImageEntries(v));
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['path', 'url', 'file'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return [v];
    }
    return [];
  }
  return [];
}

/** 取扩展名对应的 mediaType（忽略 URL 的 query/hash；大小写不敏感）；不认识返回 null */
export function mediaTypeOf(target: string): string | null {
  const clean = String(target).split(/[?#]/)[0] ?? '';   // URL 常见 `x.png?token=…`
  const ext = path.extname(clean).replace(/^\./, '').toLowerCase();
  return MEDIA_TYPES[ext] ?? null;
}

/** images 参数值 → 条目列表（**纯函数**、不做 IO，便于单测）。非法项直接抛 ImageInputError。 */
export function parseImageList(value: unknown): ImageSpec[] {
  const raw = collectImageEntries(value).map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return [];
  if (raw.length > IMAGE_MAX_COUNT) {
    throw new ImageInputError('IMAGE_TOO_MANY', `images 最多 ${IMAGE_MAX_COUNT} 张（当前 ${raw.length} 张）——请减少后重试（宿主附件服务每条消息的上限就是 ${IMAGE_MAX_COUNT} 张）`);
  }
  const allowed = Object.keys(MEDIA_TYPES).join(' / ');
  return raw.map((v) => {
    const kind: ImageSpec['kind'] = /^https?:\/\//i.test(v) ? 'url' : 'path';
    if (!mediaTypeOf(v)) {
      throw new ImageInputError('IMAGE_UNSUPPORTED_TYPE', `不支持的图片格式：${v}（只支持 ${allowed}；路径要写到具体文件、扩展名不能省）`);
    }
    return { kind, value: v };
  });
}

/** 本地路径 → 绝对路径。★ 相对路径锚定**统一图片目录** `<DSH_HOME>/.dag-flow/images/`
 *  （写 `chart.png` 即可；子目录如 `年报/chart.png` 也在这个目录下找）；绝对路径原样使用。 */
export function resolveImagePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(imageDir(), p);
}

/** 展示名（basename；URL 取 pathname 且去掉 query/hash） */
function displayName(spec: ImageSpec): string {
  const clean = spec.value.split(/[?#]/)[0] ?? spec.value;
  try { return decodeURIComponent(path.basename(clean)); } catch { return path.basename(clean); }
}

/** 载入一张图的字节（本地读 / URL 下载）＋大小校验；返回宿主 `saveImage` 的入参形状 */
export async function loadImageInput(spec: ImageSpec): Promise<{ data: Uint8Array; mediaType: string; name: string }> {
  const mediaType = mediaTypeOf(spec.value);
  if (!mediaType) throw new ImageInputError('IMAGE_UNSUPPORTED_TYPE', `不支持的图片格式：${spec.value}`);
  const name = displayName(spec);

  if (spec.kind === 'path') {
    const abs = resolveImagePath(spec.value);
    let stat;
    try { stat = await fs.stat(abs); } catch {
      throw new ImageInputError('IMAGE_NOT_FOUND', `图片文件不存在或不可读：${abs}（相对路径以统一图片目录 <DSH_HOME>/.dag-flow/images/ 为基准，放进去写文件名即可）`);
    }
    if (!stat.isFile()) throw new ImageInputError('IMAGE_NOT_FOUND', `不是文件：${abs}`);
    if (stat.size > IMAGE_MAX_BYTES) {
      throw new ImageInputError('IMAGE_TOO_LARGE', `图片超过 ${Math.round(IMAGE_MAX_BYTES / 1048576)}MB 上限：${abs}（${(stat.size / 1048576).toFixed(1)}MB）`);
    }
    const buf = await fs.readFile(abs);
    return { data: new Uint8Array(buf), mediaType, name };
  }

  // URL：先下载成字节（宿主附件服务只接受字节 + mediaType，不接受远端 URL 直接引用）
  let resp: Response;
  try {
    resp = await fetch(spec.value);
  } catch (e) {
    throw new ImageInputError('IMAGE_DOWNLOAD_FAILED', `图片下载失败：${spec.value}（${(e as Error).message}）`);
  }
  if (!resp.ok) throw new ImageInputError('IMAGE_DOWNLOAD_FAILED', `图片下载失败（HTTP ${resp.status}）：${spec.value}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.byteLength > IMAGE_MAX_BYTES) {
    throw new ImageInputError('IMAGE_TOO_LARGE', `图片超过 ${Math.round(IMAGE_MAX_BYTES / 1048576)}MB 上限：${spec.value}（${(buf.byteLength / 1048576).toFixed(1)}MB）`);
  }
  return { data: buf, mediaType, name };
}

/** 批量载入（保序；任一张失败即抛错——不静默丢图） */
export async function loadImageInputs(specs: ImageSpec[]): Promise<{ data: Uint8Array; mediaType: string; name: string }[]> {
  const out: { data: Uint8Array; mediaType: string; name: string }[] = [];
  for (const s of specs) out.push(await loadImageInput(s));
  return out;
}

/** ★ 2026-10-16 P2（不静默降级）：数一数 images 里有几条（**纯函数、不抛错**）——供"配了图但模型不收图"
 *  的模态预检用；严格校验（扩展名白名单 / ≤20 张）仍走 `parseImageList`，两者互不替代。 */
export function countImageEntries(value: unknown): number {
  return collectImageEntries(value).map((s) => s.trim()).filter(Boolean).length;
}

/** 统一图片目录里的一张图（供「🖼 选图」弹窗列清单用） */
export interface ImageFileInfo {
  name: string;
  bytes: number;
  /** 修改时间（ms epoch）——弹窗按它倒序（刚放进去的图排最前） */
  mtime: number;
}

/** 列目录用到的结构化类型（省去 import Dirent：只需 name/isFile 两个成员） */
type DirEntry = { name: string; isFile(): boolean };

/** 列出统一图片目录里的图片（**只读**）：只根目录、跳过子目录与隐藏文件、只认白名单扩展名、按修改时间倒序。
 *  ★ 2026-10-16 用户需求「多张图片一个一个复制名称有点麻烦」⇒ 「🖼 选图」弹窗从这里取清单让用户勾选。 */
export async function listImageFiles(): Promise<ImageFileInfo[]> {
  const dir = imageDir();
  let entries: DirEntry[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as DirEntry[];
  } catch {
    return [];   // 目录还不存在（还没放过图）= 空清单，不是错误
  }
  const out: ImageFileInfo[] = [];
  for (const e of entries) {
    const name = String(e?.name ?? '');
    if (!name || name.startsWith('.')) continue;          // 隐藏文件不收
    if (typeof e?.isFile === 'function' && !e.isFile()) continue;   // 子目录 / 符号链接不收
    if (!mediaTypeOf(name)) continue;                     // 只认 png/jpg/jpeg/webp/gif
    try {
      const st = await fs.stat(path.join(dir, name));
      out.push({ name, bytes: st.size, mtime: st.mtimeMs });
    } catch { /* 单个文件读不到就跳过，不影响整份清单 */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
