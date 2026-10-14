// src/adapter/storage-migrate.ts — 存储根的一次性迁移（**只复制、不移动/删除**，目标已存在就跳过）
// ① 工作区时代的 <旧工作区>/.dag-flow/ → 新根；② 更早的兜底 ~/.dsh/workflows → 新根；
// ③ 旧目录名；④ 旧 SQLite 导出 JSON。迁移来源探测（host workspace / workspaceRegistry / cwd）也在这里。
// 2026-10-14 重构轮 3 自 storage.ts 纯搬运拆出（依赖单向：本文件 → storage.ts 仅 import type，无运行时循环）。

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHost, hostService } from './safety.js';
import { dshHome } from './dsh-home.js';
import { isValidWorkflowName } from '../name-rule.js';
import type { StorageInfo } from './storage.js';

const USER_DIR = dshHome(); // 09-27 意见 2：DSH_HOME 统一（便携安装场景此前读不到）

// 旧 .dag-flow-workflows/ 与 .dsh-workflows/ 不迁移不删除（历史数据原地保留）。
const LEGACY_DIR_NAMES: string[] = [];

// ---------- 工作区根目录解析（迁移来源探测用） ----------

function probeHostWorkspace(): string | null {
  try {
    const host = getHost() as Record<string, any> | null;
    if (!host) return null;
    // 0.2.0：裸 host.workspace / host.cwd 会抛 inject 错误（cordis ctx 是 Proxy），
    // 统一走 hostService（ctx.get → 属性访问）。dsh 0.2.0 实测没有 workspace 服务，
    // 所以这里通常返回 null，落到 process.cwd() 兜底（StorageInfo.source 会记录来源）。
    const ws = (hostService('workspace') ?? hostService('workspaceService')) as Record<string, any> | undefined;
    const candidates: unknown[] = [
      ws?.cwd, ws?.root, ws?.path, ws?.dir,
      hostService('cwd'), hostService('baseDir'), hostService('workspacePath'),
    ];
    for (const c of candidates) {
      const v = typeof c === 'function' ? c() : c;
      if (typeof v === 'string' && v && path.isAbsolute(v)) return v;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

function usableProcessCwd(): string | null {
  try {
    const cwd = process.cwd();
    if (!cwd || !path.isAbsolute(cwd)) return null;
    const lower = cwd.toLowerCase();
    if (lower.endsWith('\\system32') || lower.endsWith('/system32')) return null;
    if (path.resolve(cwd) === path.resolve(os.homedir())) return null;
    return cwd;
  } catch {
    return null;
  }
}

// ★ 2026-10-01：0.2.0 宿主 cwd 不在工作区、也没有 workspace 服务 → 此前一路兜底到
//   ~/.dsh/workflows，用户创建的工作流"不知道放哪去了"。宿主实际提供 workspaceRegistry
//   服务（dsh-workspace，Workspace = { id, path, title, updatedAt, sessionIds }），
//   用它把存储锚定到 <当前工作区>/.dag-flow/workflow/。
//   选「当前」工作区：候选取磁盘上真实存在的 path；多个时取 updatedAt 最新（= 最近使用）。
//   ★ 2026-10-11 起存储根改为固定 <DSH_HOME>/.dag-flow/：本函数**只用于迁移来源探测**
//     （migrateFromLegacyRoots 找回工作区时代的数据），不再参与存储根解析。
async function probeWorkspaceRegistry(): Promise<string | null> {
  try {
    const wr = hostService('workspaceRegistry') as { list?: () => Promise<unknown> } | undefined;
    if (!wr || typeof wr.list !== 'function') return null;
    const list = (await wr.list()) as Array<Record<string, unknown>>;
    if (!Array.isArray(list) || list.length === 0) return null;
    const paths = list
      .map((w) => (typeof w?.path === 'string' ? w.path : ''))
      .filter((p) => p && path.isAbsolute(p));
    const existing: string[] = [];
    for (const p of paths) {
      try { if ((await fs.stat(p)).isDirectory()) existing.push(p); } catch { /* 不存在跳过 */ }
    }
    if (existing.length === 0) return null;
    if (existing.length === 1) return existing[0];
    const sorted = [...list]
      .filter((w) => existing.includes(String(w?.path)))
      .sort((a, b) => String(b?.updatedAt ?? '').localeCompare(String(a?.updatedAt ?? '')));
    const best = sorted[0]?.path;
    return typeof best === 'string' && best ? best : existing[0];
  } catch {
    return null;
  }
}

/** 迁移标记：钉死"已从工作区时代的位置补缺复制过"，避免每次启动重跑（同 .fallback-migrated 的教训）。 */
const WORKSPACE_MIGRATION_MARKER = '.migrated-from-workspace';

/** ★ 工作区时代 → 新根的一次性**补缺复制**（2026-10-11 存储锚点变更配套）。
 *  · **只复制、绝不移动/删除**旧目录里的任何东西；目标已存在则跳过（force:false + errorOnExist:false）。
 *  · 覆盖 workflow/（含 config/ 邮件配置与 versions/ 版本历史）、runs/、schedules.json（定时任务不丢）。
 *  · 没有任何旧目录可迁时不写标记 → 将来工作区出现还能再迁一次。 */
export async function migrateFromLegacyRoots(info: StorageInfo): Promise<void> {
  const marker = path.join(info.dir, WORKSPACE_MIGRATION_MARKER);
  try { await fs.access(marker); return; } catch { /* 没迁过，继续 */ }
  const newHome = path.dirname(info.dir);                      // <DSH_HOME>/.dag-flow
  const candidates: string[] = [];
  const add = (root: string | null): void => { if (root) candidates.push(path.join(root, '.dag-flow')); };
  add(probeHostWorkspace());
  add(await probeWorkspaceRegistry());
  add(usableProcessCwd());

  const seen = new Set<string>([path.resolve(newHome).toLowerCase()]);
  const done: string[] = [];
  for (const oldHome of candidates) {
    const key = path.resolve(oldHome).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try { if (!(await fs.stat(oldHome)).isDirectory()) continue; } catch { continue; }
    for (const sub of ['workflow', 'runs']) {
      const from = path.join(oldHome, sub);
      try { if (!(await fs.stat(from)).isDirectory()) continue; } catch { continue; }
      await fs.cp(from, path.join(newHome, sub), { recursive: true, force: false, errorOnExist: false });
    }
    const oldSchedules = path.join(oldHome, 'schedules.json');
    try {
      await fs.access(oldSchedules);
      const dst = path.join(newHome, 'schedules.json');
      await mergeSchedules(path.join(oldHome, 'schedules.json'), dst);
    } catch { /* 旧位置没有定时配置，正常 */ }
    done.push(oldHome);
  }
  if (done.length === 0) return;                                // 没旧数据：不写标记，留待将来
  await fs.writeFile(marker, JSON.stringify({ migratedAt: new Date().toISOString(), from: done }) + '\n', 'utf8');
  console.info('[dag-flow] storage root is now <DSH_HOME>/.dag-flow; copied missing files from:', done.join(', '));
}

/** 旧定时配置 → 新根：**按 id 合并**（2026-10-11 用户拍板加固；此前是「目标存在就整体跳过」）。
 *  为什么必须合并：目标可能已经有一份（此前迁过一半 / 用户在新根建过定时项 / 别的来源占位），
 *  整体跳过会**静默丢掉**旧位置里真实的定时任务——本机实测过这起事故：一份测试用的 schedules.json
 *  占位，差点让用户真实的「06:00 金融政策日报」迁不过来。
 *  合并口径：**目标已存在的条目一律保留、永不被覆盖**（同 id 以目标为准，不回退用户在新根的修改）；
 *  只把源里 id 不存在的条目补进来。目标文件存在但**解析不了**时**不碰它**（宁可让用户看到损坏提示，
 *  也不拿另一份数据去覆盖可能是他唯一的一份）。任一步失败静默跳过——迁移是增强，绝不能影响主流程。 */
async function mergeSchedules(from: string, to: string): Promise<void> {
  try {
    const srcParsed = JSON.parse(await fs.readFile(from, 'utf8')) as { items?: unknown };
    const srcItems = Array.isArray(srcParsed?.items) ? srcParsed.items : [];
    if (srcItems.length === 0) return;
    let dstItems: unknown[] = [];
    let dstExists = false;
    try {
      await fs.access(to);
      dstExists = true;
      const dstParsed = JSON.parse(await fs.readFile(to, 'utf8')) as { items?: unknown };
      if (!Array.isArray(dstParsed?.items)) return;             // 目标结构不认识 → 不碰
      dstItems = dstParsed.items;
    } catch {
      if (dstExists) return;                                    // 目标在但读/解析失败 → 不碰它
    }
    const idOf = (it: unknown): string => String((it as { id?: unknown } | null)?.id ?? '');
    const have = new Set(dstItems.map(idOf).filter(Boolean));
    const add = srcItems.filter((it) => { const id = idOf(it); return id !== '' && !have.has(id); });
    if (add.length === 0) return;
    // 原子写与 schedules.ts 的 writeSchedules 保持一致（tmp + rename），不留半个文件
    await fs.mkdir(path.dirname(to), { recursive: true });
    const tmp = `${to}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, items: [...dstItems, ...add] }, null, 2), 'utf8');
    await fs.rename(tmp, to);
    console.info('[dag-flow] legacy schedules merged (never lose a timer):', from, `+${add.length} items`);
  } catch { /* 源不存在/损坏：正常，跳过 */ }
}

// ---------- 兜底目录一次性迁入（fail-soft）：~/.dsh/workflows（user-dir-fallback 时代产物）→ 新根 ----------

/** 迁移一次性标记（2026-10-04 修「删掉的工作流会复活」）。
 *  点号开头 ⇒ 不会被 listJsonNames 当工作流列出（且不以 .json 结尾，双重安全）。 */
const MIGRATION_MARKER = '.fallback-migrated';

export async function migrateFallbackWorkflows(info: StorageInfo): Promise<void> {
  if (info.source === 'user-dir-fallback') return; // 仍落在兜底目录，无需自迁
  const oldDir = path.join(USER_DIR, 'workflows');
  if (path.resolve(oldDir) === path.resolve(info.dir)) return;
  // ★ 2026-10-04 修 bug（用户报「删掉的工作流又回来了」）：
  //   此前判据只有"目标文件不存在就复制"，而源目录 ~/.dsh/workflows 按设计**永久保留原文件**，
  //   迁移又会在**每次宿主启动**重跑（resolveRoot 里只有进程级 _migrated 标志）⇒ 用户在界面上
  //   删掉的工作流，下次 dsh web 重启就被原样复制回来（实测：删了 test.json/测试.json，重启后出现，
  //   且 mtime 与源一致 = 确系被重新复制）。现在用一次性标记把"这个工作区已迁过"钉死。
  //   标记只在**真的处理过兜底目录**之后才写：若旧目录不存在则不写，将来它出现了仍能迁一次。
  const marker = path.join(info.dir, MIGRATION_MARKER);
  try {
    await fs.access(marker);
    return; // 已经迁过：不再补缺（用户删掉的就是删掉了）
  } catch { /* 没迁过，继续 */ }
  try {
    const entries = await fs.readdir(oldDir);
    const jsons = entries.filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    for (const f of jsons) {
      const dst = path.join(info.dir, f);
      try { await fs.access(dst); continue; } catch { /* 不存在才复制 */ }
      await fs.copyFile(path.join(oldDir, f), dst);
    }
    // 旧 versions/ 子树（存在才复制，保留版本历史）
    const oldVersions = path.join(oldDir, 'versions');
    try {
      await fs.access(oldVersions);
      const newVersions = path.join(info.dir, 'versions');
      try { await fs.access(newVersions); } catch {
        await fs.cp(oldVersions, newVersions, { recursive: true, force: false, errorOnExist: false });
      }
    } catch { /* 无 versions 目录，正常 */ }
    await fs.writeFile(marker, JSON.stringify({ migratedAt: new Date().toISOString(), from: oldDir, files: jsons.length }) + '\n', 'utf8');
    if (jsons.length > 0) console.info('[dag-flow] fallback workflows migrated:', oldDir, '→', info.dir, `(${jsons.length} files)`);
  } catch {
    /* 旧目录不存在，正常 */
  }
}

// ---------- 旧目录名一次性迁入（fail-soft）：旧 <root>/.dsh-workflows → 新 <root>/.dag-flow-workflows ----------

export async function migrateLegacyDirs(info: StorageInfo): Promise<void> {
  for (const legacy of LEGACY_DIR_NAMES) {
    const oldDir = path.join(path.dirname(info.dir), legacy);
    if (path.resolve(oldDir) === path.resolve(info.dir)) continue;
    try {
      const entries = await fs.readdir(oldDir);
      if (entries.length === 0) continue; // 空目录不动
      // 新目录已有同名文件则跳过该文件，其余搬移
      await fs.mkdir(info.dir, { recursive: true });
      await fs.mkdir(path.join(info.dir, 'runs'), { recursive: true });
      for (const f of entries) {
        const src = path.join(oldDir, f);
        const dst = path.join(info.dir, f);
        try { await fs.access(dst); continue; } catch { /* 不存在才搬 */ }
        await fs.rename(src, dst);
      }
      const rest = await fs.readdir(oldDir);
      if (rest.length === 0) await fs.rmdir(oldDir);
      console.info('[dag-flow] legacy storage dir migrated:', oldDir, '→', info.dir);
    } catch {
      /* 旧目录不存在，正常 */
    }
  }
}

// ---------- 旧 SQLite 一次性导出（fail-soft） ----------

export async function migrateLegacySqlite(newDir: string): Promise<void> {
  const legacyDir = path.join(USER_DIR, 'workflows');
  const dbFile = path.join(legacyDir, 'workflows.db');
  try {
    if (!path.dirname(dbFile)) return;
    await fs.access(dbFile);
  } catch {
    return; // 没有旧库，无事可做
  }
  try {
    // node:sqlite 为 Node ≥22.13 内置模块（@types/node@20 无类型声明，运行时存在）
    // @ts-ignore
    const mod = (await import('node:sqlite')) as { DatabaseSync?: new (p: string) => any };
    if (typeof mod.DatabaseSync !== 'function') return;
    const db = new mod.DatabaseSync(dbFile);
    // workflows 表 → <name>.json
    try {
      const rows = db.prepare('SELECT name, def FROM workflows').all() as { name: string; def: string }[];
      for (const r of rows) {
        if (!isValidWorkflowName(r.name ?? '')) continue;
        const target = path.join(newDir, `${r.name}.json`);
        try { await fs.access(target); continue; } catch { /* 不存在才写 */ }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.def), null, 2), 'utf8');
      }
    } catch { /* 无 workflows 表 */ }
    // runs 表 → runs/<runId>.json
    try {
      const runsDir = path.join(newDir, 'runs');
      await fs.mkdir(runsDir, { recursive: true });
      const rows = db.prepare('SELECT run_id, summary FROM runs').all() as { run_id: string; summary: string }[];
      for (const r of rows) {
        const target = path.join(runsDir, `${r.run_id}.json`);
        try { await fs.access(target); continue; } catch { /* 不存在才写 */ }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.summary), null, 2), 'utf8');
      }
    } catch { /* 无 runs 表 */ }
    await fs.rename(dbFile, `${dbFile}.bak`);
    console.info('[dag-flow] legacy SQLite exported to JSON:', newDir, '(workflows.db → .bak)');
  } catch (e) {
    console.warn('[dag-flow] legacy SQLite migration skipped:', (e as Error).message);
  }
}
