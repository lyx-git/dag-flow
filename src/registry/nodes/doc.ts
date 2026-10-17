// src/registry/nodes/doc.ts — doc_parse 文档解析节点（PDF / Office / 图片 → 纯文本）
// 解析内核在 ../doc-extract（零依赖纯函数）；图片/扫描版 PDF 走 OCR（../../adapter/ocr，RapidOCR）。
// ★ 参数形态坑：面板 blur / 模板解析给出的 maxChars/timeoutMs 可能是字符串——节点侧一律 Number() 强转再判。
// 拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context, NodeDefinition, NodeResult } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { extractDocument, extractPdfImages, stripImageMarks, DocError, DOC_MAX_BYTES } from '../doc-extract.js';
import { ocrImages, ocrPdf, normalizeOcrMode, OcrError } from '../../adapter/ocr.js';
import { dagFlowTmpDir } from '../../adapter/workspace.js';
// ★ 2026-10-16 用户需求「doc_parse 抽图落统一目录 + 文本相应位置注明图片位置」：写入侧（读取侧在 image-inputs）
import { saveImagesToLibrary, libraryNameFor } from '../../adapter/image-library.js';
import { dagFlowImagesDir } from '../../dsh-gate/paths.js';
import { humanizeFetchError } from '../../adapter/fetch-errors.js';
import { startedEnded, finish, resolveCodePath } from './shared.js';

// ---------- doc_parse（文档解析：PDF / Office / 图片 → 纯文本） ----------
//   零依赖（解析逻辑在 ./doc-extract.ts）。支持 pdf/docx/xlsx/pptx/txt/md/csv/json/html；
//   **图片（png/jpg/webp/bmp/tif）走 OCR**（引擎 RapidOCR，适配层 ../../adapter/ocr.ts；需把「OCR」设为自动/强制）；
//   扫描版 PDF（无文本层）明确报 DOC_NO_TEXT_LAYER；旧版 .doc/.xls/.ppt 提示另存为 docx/xlsx/pptx。
interface DocParseParams { path?: string; url?: string; maxChars?: number; timeoutMs?: number; ocr?: unknown; ocrMaxPages?: unknown; ocrTimeoutMs?: unknown; extractImages?: unknown }
async function runDocParseNode(p: DocParseParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const fail = (code: string, message: string): NodeResult =>
    ({ ...makeResult('failed', { error: { code, message } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() });

  const rel = String(p.path ?? '').trim();
  const url = String(p.url ?? '').trim();
  if (!rel && !url) return fail('DOC_NO_PATH', 'path/url 都为空——填本地文件路径，或填下载地址（本地相对路径锚定 <DSH_HOME>/.dag-flow/）');
  if (ctx.signal?.aborted) return fail('RUN_CANCELLED', '运行已由用户取消');

  let buf: Buffer;
  let name = rel;
  if (url) {
    // ★ 别信类型：面板 blur 写的是**字符串**（`e.target.value`），JSON 手写/AI 生成/`{{}}` 模板解析出来的
    //   也可能是字符串。这里统一 Number() 强转再判——否则 `Number.isFinite('60')` 为 false，
    //   用户设的上限会被**静默忽略**（2026-10-11 实测：面板填 60 仍按默认 20 万跑）。
    const tmo = Number(p.timeoutMs);
    const timeoutMs = Number.isFinite(tmo) && tmo > 0 ? tmo : 60_000;
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const onAbort = (): void => ac.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const resp = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      if (!resp.ok) return fail('DOC_URL_FAILED', `下载失败（HTTP ${resp.status}）——检查地址是否需要登录、是否有防盗链`);
      const len = Number(resp.headers.get('content-length') ?? 0);
      if (len > DOC_MAX_BYTES) return fail('DOC_TOO_LARGE', `文件过大（${(len / 1048576).toFixed(1)} MB，上限 ${DOC_MAX_BYTES / 1048576} MB）`);
      const ab = await resp.arrayBuffer();
      if (ab.byteLength > DOC_MAX_BYTES) return fail('DOC_TOO_LARGE', `文件过大（${(ab.byteLength / 1048576).toFixed(1)} MB，上限 ${DOC_MAX_BYTES / 1048576} MB）`);
      buf = Buffer.from(ab);
      const last = new URL(url).pathname.split('/').filter(Boolean).pop();
      if (last) { try { name = decodeURIComponent(last); } catch { name = last; } }
    } catch (e) {
      if (timedOut) return fail('DOC_URL_FAILED', `下载超时（${timeoutMs}ms）——若文件较大可加大 timeoutMs`);
      if (ctx.signal?.aborted || (e as Error).name === 'AbortError') return fail('RUN_CANCELLED', '下载期间运行被取消');
      return fail('DOC_URL_FAILED', humanizeFetchError(e));
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  } else {
    const abs = await resolveCodePath(rel);
    try { buf = await readFile(abs); }
    catch (e) {
      const enoent = (e as NodeJS.ErrnoException).code === 'ENOENT';
      return fail('DOC_NOT_FOUND', `读不到文件：${abs}${enoent ? '（文件不存在——相对路径锚定 <DSH_HOME>/.dag-flow/，也可填绝对路径）' : `（${(e as Error).message}）`}`);
    }
  }

  // ★ OCR（2026-10-11 轮 2 图片 / 轮 3 扫描版 PDF）
  //   · 图片：一律走 OCR（off 时明确拒绝，并告诉他去开）
  //   · PDF：auto ＝ 先读原生文本层，**没有文本层才**栅格化 + OCR；force ＝ 不管有没有都栅格化
  const ocrMode = normalizeOcrMode(p.ocr);
  const ext = (name.match(/\.[^./\\]+$/) ?? [''])[0]!.toLowerCase();
  const isPdf = ext === '.pdf';
  let tmpPath = '';
  // OCR 引擎只吃**磁盘上的文件**：本地路径直接用；url 下载来的先落临时文件，用完删掉
  const localPathForOcr = async (suffix: string): Promise<string> => {
    if (!url) return await resolveCodePath(rel);
    const tmpDir = await dagFlowTmpDir();
    tmpPath = join(tmpDir, `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`);
    await writeFile(tmpPath, buf);
    return tmpPath;
  };
  // maxChars 对 OCR 出来的文本同样生效（与原生文本层一致）
  const applyMaxChars = (text: string): { text: string; truncated: boolean } => {
    const mc = Number(p.maxChars);
    if (!Number.isFinite(mc) || mc <= 0 || text.length <= mc) return { text, truncated: false };
    return { text: text.slice(0, mc), truncated: true };
  };
  const pdfOcrOut = (r: Awaited<ReturnType<typeof ocrPdf>>): Record<string, unknown> => {
    const cut = applyMaxChars(r.text);
    return {
      text: cut.text,
      format: 'pdf',
      chars: cut.text.length,
      truncated: cut.truncated,
      meta: {
        file: name, bytes: buf.length,
        pages: r.pages, ocrPages: r.ocrPages, ocrPagesTruncated: r.truncated,
        ocr: true, ocrEngine: r.engine, ocrConfidence: Number(r.confidence.toFixed(3)), ocrMs: r.durationMs,
      },
    };
  };
  const runPdfOcr = async (): Promise<NodeResult> => {
    try {
      const r = await ocrPdf(await localPathForOcr('.pdf'), { maxPages: p.ocrMaxPages, timeoutMs: p.ocrTimeoutMs, signal: ctx.signal });
      return finish(t0, startedAt, { out: pdfOcrOut(r) as never });
    } catch (e) {
      if (e instanceof OcrError) return fail(e.code, e.message);
      return fail('OCR_FAILED', `扫描版 PDF 识别失败：${(e as Error).message}`);
    }
  };

  try {
    // A. 图片 → OCR
    if (OCR_IMAGE_EXTS.has(ext)) {
      if (ocrMode === 'off') {
        return fail('OCR_DISABLED', `这是图片（${ext}），要用「文档解析」读里面的文字得开 OCR——把节点参数里的「OCR（图片识别）」设为「自动」或「强制」`);
      }
      try {
        const r = await ocrImages([await localPathForOcr(ext)], { timeoutMs: p.ocrTimeoutMs, signal: ctx.signal });
        const cut = applyMaxChars(r.text);
        return finish(t0, startedAt, {
          out: {
            text: cut.text,
            format: 'image',
            chars: cut.text.length,
            truncated: cut.truncated,
            meta: {
              file: name, bytes: buf.length,
              ocr: true, ocrEngine: r.engine, ocrConfidence: Number(r.confidence.toFixed(3)),
              ocrLines: r.lines, ocrMs: r.durationMs,
            },
          } as never,
        });
      } catch (e) {
        if (e instanceof OcrError) return fail(e.code, e.message);
        return fail('OCR_FAILED', `OCR 失败：${(e as Error).message}`);
      }
    }

    // B. PDF + 强制 → 不看文本层，直接栅格化识别
    if (isPdf && ocrMode === 'force') return await runPdfOcr();

    // C. 其它（含 PDF 自动）：先抽原生文本层
    try {
      const mc = Number(p.maxChars);        // 同上：字符串形态（面板 blur / 模板 / 手写 JSON）也要生效
      const r = extractDocument(buf, name, { maxChars: Number.isFinite(mc) && mc > 0 ? mc : undefined });
      // ★ 2026-10-16（用户需求「图片抽到哪里去了，需要在文本资料里面相应位置注明图片位置」）：
      //   把文档内嵌图**落进统一图片目录**（与 AI 节点 images 参数同一个目录），再把文本里的
      //   `[图片 #N]` 占位换成真实文件名 ⇒ 文本里就地能看到「这张图在哪、叫什么」。
      //   · 默认 `extractImages: auto`；填 `off` 则只解析文本、不落盘。
      //   · **fail-soft**：落盘失败不拖垮整份解析——文本保留 `[图片 #N]`，meta.imageError 说明原因。
      const wantImages = String(p.extractImages ?? 'auto').toLowerCase() !== 'off';
      if (!wantImages || r.images.length === 0) {
        // ★ 2026-10-17 修：选「关」时，文本里的 `[图片 #N]` 占位必须洗掉 ——
        //   占位是 extractDocument 按"有没有抽到图"无条件插入的，这里却把 images 清空了 ⇒ 留着就是
        //   "指向不存在文件的假地址"，还会被下游 AI 当正文读。
        const text = wantImages ? r.text : stripImageMarks(r.text);
        // ★ 2026-10-17 修（独立审查报的 D2）：`{...r}` 会把 extractDocument 写下的 `meta.images = N`
        //   原样带出，而这里已经把 out.images 清空 ⇒ 元数据假报"有 N 张图"（磁盘上一张都没有）。
        const meta0 = wantImages ? r.meta : { ...r.meta, images: undefined };
        return finish(t0, startedAt, { out: { ...r, text, chars: text.length, images: [], meta: meta0 } as never });
      }
      const landed = await landImages(name, r.text, r.images);
      const meta = {
        ...r.meta,
        ...(landed.images.length ? { imageCount: landed.images.length, imageDir: dagFlowImagesDir() } : {}),
        ...(landed.imageError ? { imageError: landed.imageError } : {}),
      };
      return finish(t0, startedAt, {
        out: { ...r, text: landed.text, chars: landed.text.length, meta, images: landed.images } as never,
      });
    } catch (e) {
      if (e instanceof DocError) {
        // 扫描版 PDF：没有文本层 → 栅格化 + OCR（轮 3 起真做，不再只是提示）
        if (e.code === 'DOC_NO_TEXT_LAYER' && ocrMode !== 'off' && isPdf) return await runPdfOcr();
        // OCR 关着：这句话的原版说「本节点不做 OCR」——轮 3 起已经不成立，必须说清怎么开
        if (e.code === 'DOC_NO_TEXT_LAYER' && isPdf && ocrMode === 'off') {
          // ★ 2026-10-16 第二轮（用户：「只有图没有文字的，text 里面说明抽出来的图片地址就行」）：
          //   整页是图的扫描件在 OCR 关着时**不再一律报错**——能抽出图就成功返回，文本逐行列出抽出的图片
          //   （落盘后是 `[图片：<文件名>]`，文件就在统一图片目录里 ⇒ 这段文本就是"图片地址清单"）。
          //   · 没有图（如纯空白/矢量页）⇒ 保持原来的 DOC_NO_TEXT_LAYER 提示，行为不变。
          //   · extractImages:off ⇒ 按用户要求不抽，也走原来的报错。
          const only = String(p.extractImages ?? 'auto').toLowerCase() !== 'off' ? extractPdfImages(buf) : null;
          if (only && only.images.length) {
            const refs = only.images.map((im, i) => ({
              index: i + 1, bytes: im.bytes, mediaType: im.mediaType,
              source: im.page > 0 ? `第 ${im.page} 页 (对象 ${im.objNum})` : `未引用对象 ${im.objNum}`,
            }));
            const outline = `（本 PDF 没有文字层，整页内容都是图片；下面是抽出的图片）\n${refs.map((r) => `[图片 #${r.index}]`).join('\n')}`;
            const landed = await landImages(name, outline, refs);
            // ★ 2026-10-17 修：这条通路的**全部价值**就是那份"图片地址清单"（用户原话：「只有图没有文字的，
            //   text 里面说明抽出来的图片地址就行」）⇒ 落盘全失败时清单是空的，不能算成功（否则用户拿到一堆
            //   指向不存在文件的 `[图片 #N]`）。
            if (!landed.images.length && landed.imageError) {
              return fail('IMAGE_SAVE_FAILED', `抽出了 ${refs.length} 张图但落盘失败：${landed.imageError}（文本里的图片地址清单会指向不存在的文件，故按失败处理）`);
            }
            const meta: Record<string, string | number | boolean> = {
              file: name.replace(/^.*[\\/]/, ''), bytes: buf.length, imagesOnly: true,
              ...(landed.images.length ? { imageCount: landed.images.length, imageDir: dagFlowImagesDir() } : {}),
              ...(only.skipped > 0 ? { skippedImages: only.skipped } : {}),
              ...(landed.imageError ? { imageError: landed.imageError } : {}),
            };
            return finish(t0, startedAt, {
              out: {
                format: 'pdf', text: landed.text, chars: landed.text.length, truncated: false, meta, images: landed.images,
                ...(Object.keys(only.reasons).length ? { skippedImageReasons: only.reasons } : {}),
              } as never,
            });
          }
          return fail(e.code, '这是扫描版 PDF（没有文本层）。本节点开了 OCR 就能识别：把参数「OCR（图片识别）」设为「自动」或「强制」，它会逐页转成图片再识别；不开 OCR 就只能拿到空文本。');
        }
        if (e.code === 'DOC_NO_TEXT_LAYER' && ocrMode !== 'off') {
          return fail(e.code, `${e.message}（OCR 已开启，但这个格式没有栅格化通路——只有 PDF 和图片能走 OCR）`);
        }
        return fail(e.code, e.message);
      }
      return fail('DOC_PARSE_FAILED', `解析失败：${(e as Error).message}`);
    }
  } finally {
    if (tmpPath) { try { await rm(tmpPath, { force: true }); } catch { /* 临时文件删不掉不影响结果 */ } }
  }
}
/** 图片扩展名（走 OCR 的那一类） */
const OCR_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);

interface LandedImages {
  /** 已把 `[图片 #N]` 换成 `[图片：<文件名>]` 的文本 */
  text: string;
  images: { name: string; path: string; mediaType: string; bytes: number; source: string; reused: boolean }[];
  /** 落盘失败原因（fail-soft：只记不抛，文本保留占位） */
  imageError: string;
}
/**
 * 把文档内嵌图片落进统一图片目录，并把文本里的 `[图片 #N]` 占位换成真实文件名。
 * 主流程（有文本层的文档）与「纯图 PDF」两条路径共用，避免两份落盘代码分叉。
 */
async function landImages(
  docName: string,
  text: string,
  refs: readonly { index: number; bytes: Buffer; mediaType: string; source: string }[],
): Promise<LandedImages> {
  let outText = text;
  let saved: Awaited<ReturnType<typeof saveImagesToLibrary>> = [];
  let imageError = '';
  try {
    saved = await saveImagesToLibrary(refs.map((im) => ({
      name: libraryNameFor(docName, im.index, im.mediaType), bytes: im.bytes, mediaType: im.mediaType,
    })));
    for (let i = 0; i < saved.length; i++) {
      const ref = refs[i];
      if (!ref) continue;
      outText = outText.split(`[图片 #${ref.index}]`).join(`[图片：${saved[i]!.name}]`);
    }
  } catch (e) {
    imageError = (e as Error).message;
  }
  const images = saved.map((s, i) => ({
    name: s.name, path: s.path, mediaType: s.mediaType, bytes: s.bytes,
    source: refs[i]?.source ?? '', reused: s.reused,
  }));
  return { text: outText, images, imageError };
}
export const docParseDef: NodeDefinition<DocParseParams> = {
  type: 'doc_parse',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      path: { type: 'string' },
      url: { type: 'string' },
      maxChars: { type: 'integer', minimum: 200, maximum: 2_000_000 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
      ocr: { type: 'string', enum: ['off', 'auto', 'force'], description: '图片 OCR：auto 自动（默认）—— 图片与扫描版 PDF 自动识别 / off 关 / force 强制（连有文本层的 PDF 也重识别）' },
      ocrMaxPages: { type: 'integer', minimum: 1, maximum: 200 },
      ocrTimeoutMs: { type: 'integer', minimum: 1000, maximum: 1_800_000 },
      extractImages: { type: 'string', enum: ['auto', 'off'], description: '抽取文档内嵌图片：auto 自动（抽到就存进统一图片目录 .dag-flow/images/，并在文本相应位置标注文件名）/ off 只解析文本' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runDocParseNode(p as never, ctx)),
  describe: () => ({ label: '文档解析', category: 'io' }),
};
