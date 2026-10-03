// src/dsh-gate/session-format.ts — 防腐层·DSH 会话存储格式
//
// ★ DSH 会话文件的「存储格式假设」全部收敛在本文件：
//   目录：<DSH主目录>/sessions/--<工作区名转义>--/<会话id>/<数据文件>
//   数据文件（2026-10-01 真机实测漂移）：0.2.0 起写 session.v4.jsonl.zstd
//   （旧会话 v3 / 更旧 session.jsonl.zstd 并存）——三代候选都试（fail-soft）。
//   zstd 压缩 JSONL，每行 {role,content} 或事件流形状；明文 JSONL 兜底可读。
//   ★ zstd 文件是多帧追加式（每帧一个独立 zstd stream），必须逐帧解压拼接。
// 工作区目录名转义（09-27 真机实测）：路径分隔符 : \ / → '-'，其余非字母数字 → ~XXXX；
//   会话 id 本身全局唯一 → 目录名转义方式只影响候选顺序、不做硬过滤（全盘扫描兜底）。
//
// dsh 升版改会话格式（v5 / 新转义规则 / 新消息形状）时只改本文件；
// adapter/sessions.ts 的编排逻辑（读文件/缓存/截断策略）不动。

import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import { sessionsRoot } from './paths.js';

/** 会话数据文件候选（v4 优先；v3/旧版继续兼容） */
export const SESSION_FILE_CANDIDATES = ['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.jsonl.zstd'];

/** zstd 帧头 magic（28 B5 2F FD） */
export function hasZstdMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd;
}

/**
 * 多帧 zstd 解压（2026-10-01 真机实测）：dsh 写会话文件是「每次追加一个独立 zstd 帧」
 * （实测 2MB 文件含 640 个帧头，7MB 含 4189 个），而 zstdDecompressSync 只解第一个帧——
 * 单帧调用只能读到 header 行，消息全在后续帧里。按帧头 magic 切分逐帧解压拼接。
 * - 恰好 1 个帧头且在 offset 0 → 单帧快路径（兼容旧文件与测试夹具）
 * - 多帧 → 逐帧解压拼接；坏帧/伪 magic 容忍跳过（fail-soft，宁缺不炸）
 * - 0 个帧头 → 返回 null（调用方走明文 JSONL 兜底分支）
 */
export function decompressZstdAllFrames(buf: Buffer, decompressSync: (b: Buffer) => Buffer): string | null {
  const offsets: number[] = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i);
  }
  if (offsets.length === 0) return null;
  if (offsets.length === 1 && offsets[0] === 0) {
    return decompressSync(buf).toString('utf8'); // 单帧快路径
  }
  const parts: string[] = [];
  for (let k = 0; k < offsets.length; k++) {
    const start = offsets[k];
    const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length;
    try {
      parts.push(decompressSync(buf.subarray(start, end)).toString('utf8'));
    } catch { /* 坏帧或伪 magic：跳过该段 */ }
  }
  // ★ 帧间补换行再拼接：帧边界不保证有换行符（实测 header 帧结尾无 \n，直接 join 会把
  //   header 行与下一条消息黏成同一行 → JSON.parse 失败丢消息）。空行无害（解析层会滤掉）。
  return parts.join('\n');
}

/** 旧版转义：非 [A-Za-z0-9-] → ~XX（变长 hex 大写） */
function escapeDirNameLegacy(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else out += '~' + ch.charCodeAt(0).toString(16).toUpperCase();
  }
  return out;
}

/** 新版转义（09-27 真机实测）：: \ / → '-'，其余非 [A-Za-z0-9-] → ~XXXX（4位 hex 大写） */
function escapeDirNameV3(s: string): string {
  let out = '';
  for (const ch of s) {
    if (/[A-Za-z0-9-]/.test(ch)) out += ch;
    else if (ch === ':' || ch === '\\' || ch === '/') out += '-';
    else out += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/** 扫描 sessions 根下所有 --...-- 工作区目录；workspace 仅用于把命名命中的排前面（不做硬过滤）。 */
export function scanWorkspaceDirs(workspace?: string): string[] {
  const root = sessionsRoot();
  let all: string[] = [];
  try {
    all = readdirSync(root).filter((d) => d.startsWith('--') && d.endsWith('--'));
  } catch { return []; }
  if (!workspace) return all;
  const preferred = new Set([
    `--${workspace}--`,
    `--${escapeDirNameLegacy(workspace)}--`,
    `--${escapeDirNameV3(workspace)}--`,
  ]);
  const hit = all.filter((d) => preferred.has(d));
  const rest = all.filter((d) => !preferred.has(d));
  return [...hit, ...rest];
}

/** 某会话 id 的候选文件全路径（按优先级；existsSync 由调用方判定） */
export function sessionFileCandidates(sessionId: string, dirName: string): string[] {
  const root = sessionsRoot();
  return SESSION_FILE_CANDIDATES.map((f) => path.join(root, dirName, sessionId, f));
}

/**
 * 从已解压的会话文本解析消息（读内容与标题提取共用）。
 * 两代行形状（2026-10-01 真机实测）：①旧/直陈 {role, content}；②0.1.x+/0.2.x 事件流
 * {type: 'user/message'|'assistant/message', data: {content: [{type:'text',text}], role, ...}}
 * （消息包在 data 里、content 为多模态数组；其余 type 事件——tool/call、step/*、compaction/* 等——跳过）
 */
export function parseMessages(text: string): { role: string; content: string }[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const messages: { role: string; content: string }[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      let role = '';
      let payload: unknown = obj;
      if ((obj.type === 'user/message' || obj.type === 'assistant/message') && obj.data && typeof obj.data === 'object') {
        role = obj.type === 'user/message' ? 'user' : 'assistant';
        payload = obj.data;
      } else {
        role = String(obj.role ?? obj.type ?? '');
        if (role === 'session' || role === 'user/message' || role === 'assistant/message') continue;
      }
      const contentObj = (payload as { content?: unknown })?.content;
      let content = '';
      if (typeof contentObj === 'string') content = contentObj;
      else if (Array.isArray(contentObj)) {
        // 多模态内容数组：取 text 部分
        content = contentObj.map((c: any) => (c && typeof c.text === 'string' ? c.text : '')).join('\n');
      }
      if (role && content) messages.push({ role, content });
    } catch { /* 跳过坏行 */ }
  }
  return messages;
}

/** 从一段已解压文本里找 session/title 事件，返回 seq 最大的 {seq, title}（没有返回 null）。
 *  DSH 重命名 / LLM 自动起名都写这条事件；取 seq 最大者与 dsh client「higher-seq-wins」
 *  投影规则一致。 */
export function pickTitleEvent(text: string | null): { seq: number; title: string } | null {
  if (!text) return null;
  let best: { seq: number; title: string } | null = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || !t.includes('"session/title"')) continue;
    try {
      const obj = JSON.parse(t);
      if (obj?.type === 'session/title' && typeof obj.data?.title === 'string' && obj.data.title.trim()) {
        const seq = Number(obj.seq ?? 0);
        if (!best || seq >= best.seq) best = { seq, title: obj.data.title };
      }
    } catch { /* 坏行跳过 */ }
  }
  return best;
}
