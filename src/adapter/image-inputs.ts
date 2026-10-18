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
//   ★2026-10-17 修：**还兼容相对 `<DSH_HOME>` 的 `.dag-flow/images/x.png`** —— 上游节点产物（如
//   `image_generate` 的 `path`/`relativePath`）就是这个形态（adapter/assets.ts 用 `path.relative(DSH_HOME, file)`），
//   若只按统一图片目录拼会变成 `.dag-flow/images/.dag-flow/images/x.png` ⇒ 官方推荐的
//   `{{img.out.images}}` 传图必失败（IMAGE_NOT_FOUND）。现按候选顺序探测，见 imagePathCandidates()。
//   文档解析节点（doc_parse）将来从 PDF/Office 里抽出的图片也落同一目录，两边天然对齐。
// 上限＝2026-10-16 真机启动诊断实测：`attachments ok (… maxImagesPerMessage=20, maxImageBytes=20971520 …)`。
// ★ 非法项**明确报错**，绝不静默丢图——用户会以为图已经发出去了。
//
// 依赖：只用 node 内置（插件 R3 零依赖约定）；路径走防腐层 `dsh-gate/paths.ts`。
import { promises as fs, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { dagFlowScopedPath, dshHome } from '../dsh-gate/paths.js';

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

/** 图片目录：**按工作流分** `<DSH_HOME>/.dag-flow/images/<工作流名>/`
 *  ★ 2026-10-19 用户要求「每个工作流产生的文件都要以 .dag-flow/**\/工作流名称/文件 的方式存放」，
 *   并明确「全部严格按照要求做，不做兼容」⇒ 图片按工作流隔离，**不再读 `images/` 根目录**。
 *   无工作流上下文（如手工/工具调用）时退回 `images/` 根。 */
export function imageDir(wfName?: string): string {
  return dagFlowScopedPath('images', wfName);
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

/** 本工作流各次运行目录里的 images/（新的在前；数量受「每个工作流保留 20 个运行目录」限制，所以很轻）。
 *  ★ 2026-10-21 修：排序优先用**运行目录名里的毫秒时间戳**（`run-<ms>-<rand>`），取不到才退回目录 mtime。
 *    只按目录 mtime 会误判——往旧目录里补一个文件就把它的 mtime 顶到最新，"取最新那份"会挑错。 */
function runImageDirsNewestFirst(wfName?: string): string[] {
  const base = dagFlowScopedPath('tmp', wfName);
  let subs: DirEntry[] = [];
  try { subs = readdirSync(base, { withFileTypes: true }) as unknown as DirEntry[]; } catch { return []; }
  const rows: { dir: string; t: number }[] = [];
  for (const d of subs) {
    if (typeof d?.isDirectory === 'function' && !d.isDirectory()) continue;
    const name = String(d.name);
    const dir = path.join(base, name, 'images');
    let t = Number((/^run-(\d{10,})/.exec(name) ?? [])[1]) || 0;   // 目录名里的毫秒时间戳
    if (!t) { try { t = statSync(dir).mtimeMs; } catch { continue; } }
    try { statSync(dir); } catch { continue; }                      // 这次运行没产出图（没有 images/）
    rows.push({ dir, t });
  }
  return rows.sort((a, b) => b.t - a.t).map((r) => r.dir);
}

/** 本地路径 → 绝对路径。★ 相对路径锚定**本工作流最近一次运行**的图片目录
 *  （写 `chart.png` 即可）；绝对路径原样使用。 */
export function resolveImagePath(p: string, wfName?: string): string {
  if (path.isAbsolute(p)) return p;
  const first = runImageDirsNewestFirst(wfName)[0];
  return path.resolve(first ?? path.join(dagFlowScopedPath('tmp', wfName), 'images'), p);
}

/** ★ 相对路径的**候选探测顺序**：① 绝对路径 = 唯一候选；② 本工作流的图片目录（官方基准，写裸名）；
 *  ③ `<DSH_HOME>` 基准——**这条只用来接住上游节点自己产出的相对路径**
 *  （如 image_generate 写出的 `.dag-flow/images/<名>/x.png`），不是"兼容旧图"。
 *  ★ 2026-10-19 用户口径「全部严格按照要求做，不做兼容」⇒ **已去掉 `images/` 根目录兜底**。 */
export function imagePathCandidates(p: string, wfName?: string): string[] {
  if (path.isAbsolute(p)) return [p];
  // ★ 2026-10-20：各次运行的 images/ 依次探（新的在前）+ <DSH_HOME> 相对兜底（接上游节点写出的
  //   `.dag-flow/tmp/.../images/x.png` 这类形态）。旧 `images/<名>/` 不再参与。
  return [...new Set([
    ...runImageDirsNewestFirst(wfName).map((d) => path.resolve(d, p)),
    path.resolve(dshHome(), p),
  ])];
}

/** 展示名（basename；URL 取 pathname 且去掉 query/hash） */
function displayName(spec: ImageSpec): string {
  const clean = spec.value.split(/[?#]/)[0] ?? spec.value;
  try { return decodeURIComponent(path.basename(clean)); } catch { return path.basename(clean); }
}

/** 载入一张图的字节（本地读 / URL 下载）＋大小校验；返回宿主 `saveImage` 的入参形状 */
export async function loadImageInput(spec: ImageSpec, wfName?: string): Promise<{ data: Uint8Array; mediaType: string; name: string }> {
  const mediaType = mediaTypeOf(spec.value);
  if (!mediaType) throw new ImageInputError('IMAGE_UNSUPPORTED_TYPE', `不支持的图片格式：${spec.value}`);
  const name = displayName(spec);

  if (spec.kind === 'path') {
    // ★ 多候选探测：裸文件名按**本工作流的图片目录**找；带 `.dag-flow/` 前缀的按 <DSH_HOME> 相对路径找
    const cands = imagePathCandidates(spec.value, wfName);
    let abs = cands[0]!;
    let stat: { isFile(): boolean; size: number } | null = null;
    for (const c of cands) {
      try { stat = await fs.stat(c); abs = c; break; } catch { /* 试下一个候选 */ }
    }
    if (!stat) {
      throw new ImageInputError('IMAGE_NOT_FOUND', `图片文件不存在或不可读，已尝试：${cands.join(' 与 ')}（相对路径以**本次运行产出的图片目录** <DSH_HOME>/.dag-flow/tmp/${wfName || '<工作流名>'}/<runId>/images/ 为基准、写文件名即可；也兼容 .dag-flow/… 这类相对 <DSH_HOME> 的写法）`);
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
export async function loadImageInputs(specs: ImageSpec[], wfName?: string): Promise<{ data: Uint8Array; mediaType: string; name: string }[]> {
  const out: { data: Uint8Array; mediaType: string; name: string }[] = [];
  for (const s of specs) out.push(await loadImageInput(s, wfName));
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

/** 列目录用到的结构化类型（省去 import Dirent：只需 name/isFile/isDirectory 三个成员） */
type DirEntry = { name: string; isFile(): boolean; isDirectory?(): boolean };

/** 列出**本工作流各次运行**产出的图片（**只读**）：跳过隐藏文件、只认白名单扩展名、按修改时间倒序。
 *  ★ 2026-10-16 用户需求「多张图片一个一个复制名称有点麻烦」⇒ 「🖼 选图」弹窗从这里取清单让用户勾选。
 *  ★ 2026-10-20 用户拍板「不用兼容旧位置数据，都删了」⇒ 只扫 `tmp/<名>/<runId>/images/`，
 *    旧 `images/<名>/` 历史库**不再参与**（同名取 mtime 较新的那份，整体按 mtime 倒序）。 */
export async function listImageFiles(wfName?: string): Promise<ImageFileInfo[]> {
  const dirs: string[] = [];
  try {
    const tmpBase = dagFlowScopedPath('tmp', wfName);
    for (const d of (await fs.readdir(tmpBase, { withFileTypes: true })) as unknown as DirEntry[]) {
      if (typeof d?.isDirectory === 'function' && !d.isDirectory()) continue;
      dirs.push(path.join(tmpBase, String(d.name), 'images'));
    }
  } catch { /* 还没跑过任何一次 */ }
  const byName = new Map<string, ImageFileInfo>();
  for (const dir of dirs) {
    for (const it of await scanImageDir(dir)) {
      const old = byName.get(it.name);
      if (!old || it.mtime > old.mtime) byName.set(it.name, it);
    }
  }
  return [...byName.values()].sort((a, b) => b.mtime - a.mtime);
}

/** 扫单个目录里的图片（隐藏文件 / 子目录 / 非白名单扩展名一律跳过；单文件失败不影响整份清单） */
async function scanImageDir(dir: string): Promise<ImageFileInfo[]> {
  let entries: DirEntry[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as DirEntry[];
  } catch {
    return [];   // 目录还不存在（还没放过图）= 空清单，不是错误
  }
  const out: ImageFileInfo[] = [];
  for (const e of entries) {
    const name = String(e?.name ?? '');
    if (!name || name.startsWith('.')) continue;
    if (typeof e?.isFile === 'function' && !e.isFile()) continue;
    if (!mediaTypeOf(name)) continue;
    try {
      const st = await fs.stat(path.join(dir, name));
      out.push({ name, bytes: st.size, mtime: st.mtimeMs });
    } catch { /* 单个文件读不到就跳过 */ }
  }
  return out;
}
