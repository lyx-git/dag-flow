// src/adapter/storage.ts — 工作流数据存储：**JSON 文件，无数据库**
//
// ★ 2026-10-11 用户拍板（原话）：「dag-flow 创建的文件，不依赖于 dsh 的工作区，默认放在
//   <DSH_HOME>\.dag-flow 文件夹下，避免工作区没选择的问题」。
//   ⇒ 存储根**固定** `<DSH_HOME>/.dag-flow/workflow/`（与工作区、cwd 全都无关），
//     运行记录 `<DSH_HOME>/.dag-flow/runs/` —— 纯 JSON、可读、可携带、可进 git。
//   （此前的四级解析链 host-ctx → workspace-registry → process.cwd → ~/.dsh/workflows 已废弃：
//     工作区没选择时会落到 ~/.dsh/workflows，用户"不知道文件去哪了"。旧的三个探测函数**保留**，
//     但现在只服务于"工作区时代数据的一次性补缺复制"，见 migrateFromLegacyRoots。）
//
// 一次性迁移（都是**只复制、不移动/删除**，且目标已存在就跳过）：
//   ① 工作区时代的 <旧工作区>/.dag-flow/（workflow/ + runs/ + schedules.json）→ 新根；
//   ② 更早的兜底目录 ~/.dsh/workflows → 新根；③ 旧目录名 / 旧 SQLite → 新根。
//
// DshStorage 接口与旧版完全一致（readWorkflow/writeWorkflow/listWorkflows/
// workflowsDir/runsDir/writeRunRecord/listRunRecords/readRunRecord + 新增 describe），
// api.ts / cli.ts / record.ts 调用方零改动。

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHost, hostService } from './safety.js';
import { dshHome } from './dsh-home.js';
import { dagFlowHome } from '../dsh-gate/paths.js';
import { isValidWorkflowName } from '../name-rule.js';
import type { WorkflowDef } from '../types.js';

export interface DshStorage {
  /** 工作流 JSON 目录（<DSH_HOME>/.dag-flow/workflow） */
  workflowsDir(): Promise<string>;
  /** 运行记录目录（工作流目录下 runs/） */
  runsDir(): Promise<string>;
  /** 存储位置说明（目录 + 解析来源，供 API/日志展示） */
  describe(): Promise<{ dir: string; source: string }>;
  readWorkflow(name: string): Promise<WorkflowDef | null>;
  writeWorkflow(name: string, def: WorkflowDef, opts?: { snapshot?: boolean; renameFrom?: string }): Promise<void>;
  /** 删除工作流（含其全部历史版本） */
  deleteWorkflow(name: string): Promise<void>;
  /** 历史版本列表（时间戳倒序，最多 20 份） */
  listVersions(name: string): Promise<{ ts: string }[]>;
  /** 读取某个历史版本 */
  readVersion(name: string, ts: string): Promise<WorkflowDef | null>;
  listWorkflows(): Promise<string[]>;
  writeRunRecord(runId: string, summary: unknown): Promise<void>;
  listRunRecords(workflowName?: string): Promise<string[]>;
  readRunRecord(runId: string): Promise<unknown | null>;
}

const USER_DIR = dshHome(); // 09-27 意见 2：DSH_HOME 统一（便携安装场景此前读不到）
// ★ 2026-10-11 起：所有运行数据锚定 **<DSH_HOME>/.dag-flow/**（与工作区无关）——
//   工作流定义 .dag-flow/workflow/、运行记录 .dag-flow/runs/、临时 .dag-flow/tmp/、日志 .dag-flow/logs/。
//   （原 `DIR_NAME = '.dag-flow/workflow'` 常量随四级解析链一起废弃：路径现在由 dagFlowHome() 拼。）
// 旧 .dag-flow-workflows/ 与 .dsh-workflows/ 不迁移不删除（历史数据原地保留）。
const LEGACY_DIR_NAMES: string[] = [];

export interface StorageInfo {
  dir: string;
  source: string; // 'dsh-home'（2026-10-11 起唯一取值）| 旧值：'host-ctx' | 'workspace-registry' | 'process-cwd' | 'user-dir-fallback'
}

let _info: StorageInfo | null = null;
let _migrated = false;

// ---------- 工作区根目录解析 ----------

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

async function resolveRoot(): Promise<StorageInfo> {
  if (_info) return _info;
  // ★ 2026-10-11：**不再依赖工作区/cwd** —— 根固定在 <DSH_HOME>/.dag-flow/（用户拍板，原话见文件头）。
  _info = { dir: path.join(dagFlowHome(), 'workflow'), source: 'dsh-home' };
  await fs.mkdir(_info.dir, { recursive: true });
  if (!_migrated) {
    _migrated = true;
    await migrateFromLegacyRoots(_info);   // ① 工作区时代的 <旧工作区>/.dag-flow/ → 新根（补缺复制）
    await migrateFallbackWorkflows(_info); // ② 更早的兜底 ~/.dsh/workflows → 新根
    await migrateLegacyDirs(_info);        // ③ 旧目录名
    await migrateLegacySqlite(_info.dir);  // ④ 旧 SQLite
  }
  return _info;
}

/** 迁移标记：钉死"已从工作区时代的位置补缺复制过"，避免每次启动重跑（同 .fallback-migrated 的教训）。 */
const WORKSPACE_MIGRATION_MARKER = '.migrated-from-workspace';

/** ★ 工作区时代 → 新根的一次性**补缺复制**（2026-10-11 存储锚点变更配套）。
 *  · **只复制、绝不移动/删除**旧目录里的任何东西；目标已存在则跳过（force:false + errorOnExist:false）。
 *  · 覆盖 workflow/（含 config/ 邮件配置与 versions/ 版本历史）、runs/、schedules.json（定时任务不丢）。
 *  · 没有任何旧目录可迁时不写标记 → 将来工作区出现还能再迁一次。 */
async function migrateFromLegacyRoots(info: StorageInfo): Promise<void> {
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

export async function resolveStorageRoot(): Promise<StorageInfo> {
  return resolveRoot();
}

// ---------- 兜底目录一次性迁入（fail-soft）：~/.dsh/workflows（user-dir-fallback 时代产物）→ 新根 ----------

/** 迁移一次性标记（2026-10-04 修「删掉的工作流会复活」）。
 *  点号开头 ⇒ 不会被 listJsonNames 当工作流列出（且不以 .json 结尾，双重安全）。 */
const MIGRATION_MARKER = '.fallback-migrated';

async function migrateFallbackWorkflows(info: StorageInfo): Promise<void> {
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

async function migrateLegacyDirs(info: StorageInfo): Promise<void> {
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

async function migrateLegacySqlite(newDir: string): Promise<void> {
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

// ---------- 基础工具 ----------

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

function safeName(name: string): string {
  if (!isValidWorkflowName(name)) {
    throw new Error(`工作流名称不合法（需中文/字母/数字开头，仅中文/字母/数字/下划线/连字符，≤64 字符）: ${name}`);
  }
  return name;
}

/** 按 mtime 新→旧列 JSON 文件（排除隐藏与 .bak） */
async function listJsonNames(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; m: number }[] = [];
  for (const f of entries) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const st = await fs.stat(path.join(dir, f));
      out.push({ name: f.replace(/\.json$/, ''), m: st.mtimeMs });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.m - a.m).map((x) => x.name);
}

// ---------- 存储实现 ----------

export function createStorage(): DshStorage {
  return {
    async describe() {
      return resolveRoot();
    },
    async workflowsDir() {
      return (await resolveRoot()).dir;
    },
    async runsDir() {
      // 运行记录独立于 workflow 定义：.dag-flow/runs/（其余运行数据一律落 .dag-flow/ 下）
      const dir = path.join(path.dirname((await resolveRoot()).dir), 'runs');
      await ensureDir(dir);
      return dir;
    },
    async readWorkflow(name) {
      const safe = safeName(name);
      const file = path.join(await this.workflowsDir(), `${safe}.json`);
      try {
        const buf = await fs.readFile(file, 'utf8');
        return JSON.parse(buf) as WorkflowDef;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async writeWorkflow(name, def, opts) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await ensureDir(dir);
      const file = path.join(dir, `${safe}.json`);
      const next = JSON.stringify(def, null, 2);
      // 版本快照（#14-②；2026-10-01 夜 语义调整）：snapshot!==false 时把「本次保存的内容」存档到
      // versions/<name>/<ts>.json（手动保存=生成一个可回载版本；自动保存传 snapshot:false 不生成——
      // 否则 2s 防抖自动保存会把版本列表刷爆）。与最新版本内容相同时跳过（重复保存不产生重复版本）。
      if (opts?.snapshot !== false) {
        try {
          const vdir = path.join(dir, 'versions', safe);
          const files = (await fs.readdir(vdir).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort().reverse();
          const latest = files[0] ? await fs.readFile(path.join(vdir, files[0]), 'utf8').catch(() => null) : null;
          if (latest !== next) {
            await ensureDir(vdir);
            // 时间戳 + 随机后缀，防同毫秒并发保存互相覆盖（C5）
            const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            await fs.writeFile(path.join(vdir, `${ts}.json`), next, 'utf8');
            const vs = (await fs.readdir(vdir)).filter((f) => f.endsWith('.json')).sort().reverse();
            for (const f of vs.slice(20)) await fs.rm(path.join(vdir, f), { force: true });
          }
        } catch { /* 版本快照失败不阻塞保存 */ }
      }
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, next, 'utf8');
      await fs.rename(tmp, file); // 同盘原子替换
      // ★ 重命名联动（2026-10-02 用户需求「名称改了，响应使用的地方也要改，保持一致」）：
      //   renameFrom=旧名时——删旧 <旧名>.json、versions/ 与 scripts/ 子目录搬移到新名下。
      //   失败静默（搬移是增强，不阻塞保存）。scripts/<工作流名>/ 是 python/bash codePath
      //   相对路径的锚定目录（按工作流分目录）。
      const renameFrom = opts?.renameFrom;
      if (renameFrom && renameFrom !== name) {
        try {
          const oldSafe = safeName(renameFrom);
          const root = path.dirname(dir); // .dag-flow/
          await fs.rm(path.join(dir, `${oldSafe}.json`), { force: true });
          // versions 在 workflow/ 之下；scripts 在 .dag-flow/ 之下——分开拼
          const pairs: [string, string][] = [
            [path.join(dir, 'versions', oldSafe), path.join(dir, 'versions', safe)],
            [path.join(root, 'scripts', oldSafe), path.join(root, 'scripts', safe)],
          ];
          for (const [from, to] of pairs) {
            if (from !== to && (await fs.stat(from).catch(() => null)) && !(await fs.stat(to).catch(() => null))) {
              await fs.rename(from, to);
            }
          }
        } catch { /* 重命名搬移失败不阻塞保存 */ }
      }
    },
    async deleteWorkflow(name) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await fs.rm(path.join(dir, `${safe}.json`), { force: true });
      await fs.rm(path.join(dir, 'versions', safe), { recursive: true, force: true });
    },
    async listVersions(name) {
      const safe = safeName(name);
      const vdir = path.join(await this.workflowsDir(), 'versions', safe);
      try {
        const files = await fs.readdir(vdir);
        return files
          .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
          .map((f) => ({ ts: f.replace(/\.json$/, '') }))
          .sort((a, b) => (a.ts < b.ts ? 1 : -1));
      } catch {
        return [];
      }
    },
    async readVersion(name, ts) {
      const safe = safeName(name);
      const file = path.join(await this.workflowsDir(), 'versions', safe, `${path.basename(ts)}.json`);
      try {
        const buf = await fs.readFile(file, 'utf8');
        return JSON.parse(buf) as WorkflowDef;
      } catch {
        return null;
      }
    },
    async listWorkflows() {
      return listJsonNames(await this.workflowsDir());
    },
    async writeRunRecord(runId, summary) {
      const dir = await this.runsDir();
      const file = path.join(dir, `${path.basename(runId)}.json`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(summary, null, 2), 'utf8');
      await fs.rename(tmp, file);
    },
    async listRunRecords(workflowName) {
      const dir = await this.runsDir();
      const ids = (await listJsonNames(dir));
      if (!workflowName) return ids;
      const out: string[] = [];
      for (const id of ids) {
        try {
          const buf = await fs.readFile(path.join(dir, `${id}.json`), 'utf8');
          const r = JSON.parse(buf) as { workflowName?: string };
          if (r.workflowName === workflowName) out.push(id);
        } catch { /* skip */ }
      }
      return out;
    },
    async readRunRecord(runId) {
      try {
        const buf = await fs.readFile(path.join(await this.runsDir(), `${path.basename(runId)}.json`), 'utf8');
        return JSON.parse(buf) as unknown;
      } catch {
        return null;
      }
    },
  };
}
