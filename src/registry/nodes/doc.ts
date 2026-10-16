// src/registry/nodes/doc.ts — doc_parse 文档解析节点（PDF / Office / 图片 → 纯文本）
// 解析内核在 ../doc-extract（零依赖纯函数）；图片/扫描版 PDF 走 OCR（../../adapter/ocr，RapidOCR）。
// ★ 参数形态坑：面板 blur / 模板解析给出的 maxChars/timeoutMs 可能是字符串——节点侧一律 Number() 强转再判。
// 拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context, NodeDefinition, NodeResult } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { extractDocument, DocError, DOC_MAX_BYTES } from '../doc-extract.js';
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
      //   · 默认 `extractImages: auto`；填 `off` 则只解析文本、不落盘（老行为）。
      //   · **fail-soft**：落盘失败不拖垮整份解析——文本保留 `[图片 #N]`，meta.imageError 说明原因。
      const wantImages = String(p.extractImages ?? 'auto').toLowerCase() !== 'off';
      if (!wantImages || r.images.length === 0) {
        return finish(t0, startedAt, { out: { ...r, images: [] } as never });
      }
      let text = r.text;
      let saved: Awaited<ReturnType<typeof saveImagesToLibrary>> = [];
      let imageError = '';
      try {
        saved = await saveImagesToLibrary(r.images.map((im) => ({
          name: libraryNameFor(name, im.index, im.mediaType), bytes: im.bytes, mediaType: im.mediaType,
        })));
        for (let i = 0; i < saved.length; i++) {
          const ref = r.images[i];
          if (!ref) continue;
          text = text.split(`[图片 #${ref.index}]`).join(`[图片：${saved[i]!.name}]`);
        }
      } catch (e) {
        imageError = (e as Error).message;
      }
      const imagesOut = saved.map((s, i) => ({
        name: s.name, path: s.path, mediaType: s.mediaType, bytes: s.bytes,
        source: r.images[i]?.source ?? '', reused: s.reused,
      }));
      const meta = {
        ...r.meta,
        ...(imagesOut.length ? { imageCount: imagesOut.length, imageDir: dagFlowImagesDir() } : {}),
        ...(imageError ? { imageError } : {}),
      };
      return finish(t0, startedAt, {
        out: { ...r, text, chars: text.length, meta, images: imagesOut } as never,
      });
    } catch (e) {
      if (e instanceof DocError) {
        // 扫描版 PDF：没有文本层 → 栅格化 + OCR（轮 3 起真做，不再只是提示）
        if (e.code === 'DOC_NO_TEXT_LAYER' && ocrMode !== 'off' && isPdf) return await runPdfOcr();
        // OCR 关着：这句话的原版说「本节点不做 OCR」——轮 3 起已经不成立，必须说清怎么开
        if (e.code === 'DOC_NO_TEXT_LAYER' && isPdf && ocrMode === 'off') {
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
export const docParseDef: NodeDefinition<DocParseParams> = {
  type: 'doc_parse',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      path: { type: 'string' },
      url: { type: 'string' },
      maxChars: { type: 'integer', minimum: 200, maximum: 2_000_000 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
      ocr: { type: 'string', enum: ['off', 'auto', 'force'], description: '图片 OCR：off 关 / auto 自动（图片就识别）/ force 强制' },
      ocrMaxPages: { type: 'integer', minimum: 1, maximum: 200 },
      ocrTimeoutMs: { type: 'integer', minimum: 1000, maximum: 1_800_000 },
      extractImages: { type: 'string', enum: ['auto', 'off'], description: '抽取文档内嵌图片：auto 自动（抽到就存进统一图片目录 .dag-flow/images/，并在文本相应位置标注文件名）/ off 只解析文本' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runDocParseNode(p as never, ctx)),
  describe: () => ({ label: '文档解析', category: 'io' }),
};
