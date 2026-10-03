// src/adapter/sessions.ts — 读取 DSH 会话历史（供「会话输入」节点使用）
//
// ★ 2026-10-02 防腐层改造：会话「存储格式」（v3/v4 zstd 多帧、消息形状、
//   session/title 事件、目录转义）收编 dsh-gate/session-format.ts——dsh 改会话
//   格式时只改那边；本文件只保留编排策略（文件 IO、缓存、截断、回退排序）。
//   行为锁定：test/sessions.test.mjs（15 断言，import 前设 DSH_HOME）。

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import {
  SESSION_FILE_CANDIDATES,
  scanWorkspaceDirs,
  decompressZstdAllFrames,
  hasZstdMagic,
  parseMessages,
  pickTitleEvent,
} from '../dsh-gate/session-format.js';
import { sessionsRoot } from '../dsh-gate/paths.js';

// 模块顶层固化（llm-config/sessions 测试契约：import 前设 DSH_HOME，import 后改 env 无效）
const SESSIONS_ROOT = sessionsRoot();

/**
 * 读取指定会话最近 N 条消息文本。返回 null 表示找不到。
 * zstd 解压（Node ≥22.13；多帧追加文件按帧切分逐帧解压——单帧调用只见 header，
 * 多帧切分逻辑在 dsh-gate/session-format.decompressZstdAllFrames）。
 */
export async function readSessionContent(sessionId: string, limit = 10, workspace?: string): Promise<string | null> {
  // 目录候选：workspace 命名变体优先 → 全盘扫描兜底（会话 id 全局唯一，命名漂移不影响命中）
  let file = '';
  outer: for (const d of scanWorkspaceDirs(workspace)) {
    for (const f of SESSION_FILE_CANDIDATES) {
      const c = path.join(SESSIONS_ROOT, d, sessionId, f);
      if (existsSync(c)) { file = c; break outer; }
    }
  }
  if (!file) return null;

  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch (e) {
    throw new Error(`无法读取会话文件: ${(e as Error).message}`);
  }

  // 多帧解压（防腐层）+ 明文 JSONL 兜底
  let text: string;
  try {
    const { zstdDecompressSync } = await import('node:zlib') as { zstdDecompressSync?: (b: Buffer) => Buffer };
    if (typeof zstdDecompressSync !== 'function') {
      throw new Error('需要 Node >= 22.13 才支持 zstd 解压');
    }
    const multi = decompressZstdAllFrames(buf, zstdDecompressSync);
    if (multi === null) {
      // 文件里没有任何 zstd 帧头 → 按明文 JSONL 处理（旧版兜底分支）
      text = buf.toString('utf8');
    } else {
      text = multi;
    }
  } catch (e) {
    // 可能是未压缩的明文 jsonl（兜底）
    if (hasZstdMagic(buf)) throw new Error(`zstd 解压失败: ${(e as Error).message}`);
    text = buf.toString('utf8');
  }

  const recent = parseMessages(text).slice(-Math.max(1, limit));
  if (recent.length === 0) return '';
  return recent.map((m) => `【${m.role}】\n${m.content}`).join('\n\n');
}

// —— 会话标题提取（2026-10-02 用户需求：下拉里全是 session id 分不清，要显示会话名称）——
// 标题优先级：
//   1) 会话文件里的 `session/title` 事件（DSH 重命名 / LLM 自动起名都会写这条事件，取 seq 最大者——
//      与 dsh client「higher-seq-wins」投影规则一致；用户重命名多发生在近期 → 头 256KB + 尾 64KB 双扫）；
//   2) 回退：首条 user 消息的文本摘要（≤40 字，空白折叠）；都没有 → 空串（调用方回退 id）。
// 性能：只读文件头 256KB + 尾 64KB、解压「完整帧」（dsh 会话按帧追加；尾部残帧解压失败自动跳过）；
//       结果按 (文件+mtime) 缓存——同一会话反复打开下拉不重复解压。
const TITLE_HEAD_BYTES = 256 * 1024;
const TITLE_TAIL_BYTES = 64 * 1024;
const titleCache = new Map<string, string>(); // key: `${file}:${mtimeMs}` → 标题（可能为空串）

async function extractSessionTitle(file: string, mtimeMs: number): Promise<string> {
  const key = `${file}:${mtimeMs}`;
  const hit = titleCache.get(key);
  if (hit !== undefined) return hit;
  let title = '';
  try {
    const fh = await fs.open(file, 'r');
    try {
      const stat = await fh.stat();
      const size = stat.size;
      // 头部块（找早期 title 事件 + 首条 user 消息）
      const headLen = Math.min(TITLE_HEAD_BYTES, size);
      const head = Buffer.alloc(headLen);
      const headRes = await fh.read(head, 0, headLen, 0);
      const headBuf = headRes.buffer.subarray(0, headRes.bytesRead);
      // 尾部块（找用户后期重命名的 title 事件；与头部有重叠也无妨，按 seq 去重取大）
      let tailBuf: Buffer | null = null;
      if (size > TITLE_HEAD_BYTES) {
        const tailLen = Math.min(TITLE_TAIL_BYTES, size - TITLE_HEAD_BYTES);
        const tail = Buffer.alloc(tailLen);
        const tailRes = await fh.read(tail, 0, tailLen, size - tailLen);
        tailBuf = tailRes.buffer.subarray(0, tailRes.bytesRead);
      }
      const decompress = async (buf: Buffer): Promise<string | null> => {
        let text: string | null = null;
        try {
          const { zstdDecompressSync } = await import('node:zlib') as { zstdDecompressSync?: (b: Buffer) => Buffer };
          if (typeof zstdDecompressSync === 'function') {
            text = decompressZstdAllFrames(buf, zstdDecompressSync);
          }
        } catch { /* 解压异常 → 走明文兜底判定 */ }
        if (text === null) {
          // 无帧头或无法解压 → 仅当整体不像 zstd（0 帧头）时按明文 JSONL 解析
          if (!hasZstdMagic(buf)) text = buf.toString('utf8');
        }
        return text;
      };
      const headText = await decompress(headBuf);
      const tailText = tailBuf ? await decompress(tailBuf) : null;
      // ① session/title 事件：头+尾合并，全局取 seq 最大者（用户重命名/LLM 起名的最终名字）
      const headHit = pickTitleEvent(headText);
      const tailHit = pickTitleEvent(tailText);
      const best = !headHit ? tailHit : (!tailHit ? headHit : (tailHit.seq > headHit.seq ? tailHit : headHit));
      if (best) title = best.title;
      // ② 回退：首条 user 消息摘要
      if (!title && headText) {
        const firstUser = parseMessages(headText).find((m) => m.role === 'user');
        if (firstUser) {
          const flat = firstUser.content.replace(/\s+/g, ' ').trim();
          title = flat.slice(0, 40) + (flat.length > 40 ? '…' : '');
        }
      }
    } finally {
      await fh.close().catch(() => {});
    }
  } catch { /* 读失败 → 空标题，回退 id */ }
  titleCache.set(key, title);
  return title;
}

/** 列出会话（id + 可读名称 + 最后活动时间）。
 *  名称 = 首条 user 消息摘要（分不清 session id 的解法，2026-10-02）；按最后活动倒序、上限 100 条。
 *  返回 null 表示 sessions 根目录不存在。 */
export async function listSessions(workspace?: string): Promise<{ id: string; name: string; mtime?: string }[] | null> {
  if (!existsSync(SESSIONS_ROOT)) return null;
  const found: { id: string; file: string; mtimeMs: number }[] = [];
  for (const d of scanWorkspaceDirs(workspace)) {
    const wsDir = path.join(SESSIONS_ROOT, d);
    try {
      const entries = readdirSync(wsDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        for (const f of SESSION_FILE_CANDIDATES) {
          const c = path.join(wsDir, e.name, f);
          if (existsSync(c)) {
            let mtimeMs = 0;
            try { mtimeMs = (await fs.stat(c)).mtimeMs; } catch { /* stat 失败按 0 排最后 */ }
            found.push({ id: e.name, file: c, mtimeMs });
            break; // 候选按优先级排列，命中即止
          }
        }
      }
    } catch { /* 忽略单目录错误 */ }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs); // 最近活动在前
  const out: { id: string; name: string; mtime?: string }[] = [];
  for (const s of found.slice(0, 100)) {
    const title = await extractSessionTitle(s.file, s.mtimeMs);
    out.push({ id: s.id, name: title || s.id, ...(s.mtimeMs ? { mtime: new Date(s.mtimeMs).toISOString() } : {}) });
  }
  return out;
}
