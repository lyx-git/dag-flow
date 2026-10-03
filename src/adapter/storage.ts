// src/adapter/storage.ts — 工作流数据存储：**工作区 JSON 文件，无数据库**
//
// 2026-09-23 重构（用户拍板）：SQLite 退役。工作流保存为 JSON（当前：<工作区>/.dag-flow/workflow/<name>.json），
// 运行记录为 <工作区>/.dag-flow/runs/<runId>.json —— 纯 JSON、可读、可携带、可进 git。
//
// 存储根目录解析链（进程内解析一次并缓存，来源记录在 storageInfo）：
//   1) host ctx 上的工作区线索：ctx.workspace.{cwd|root|path|dir} / ctx.cwd()
//   2) process.cwd()（DSH web profile 通常从工作区目录启动 → 即工作区根；
//      排除用户主目录与 system32，防启动环境异常时误判）
//   3) 回退 ~/.dsh/workflows（旧行为，兜底永远可用）
//
// 一次性迁移：旧 ~/.dsh/workflows/workflows.db（SQLite）若存在，启动时把
// workflows/runs 两表导出成 JSON 写入新目录，然后改名 .db.bak。node:sqlite 不可用时静默跳过。
//
// DshStorage 接口与旧版完全一致（readWorkflow/writeWorkflow/listWorkflows/
// workflowsDir/runsDir/writeRunRecord/listRunRecords/readRunRecord + 新增 describe），
// api.ts / cli.ts / record.ts 调用方零改动。

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHost, hostService } from './safety.js';
import { dshHome } from './dsh-home.js';
import { isValidWorkflowName } from '../name-rule.js';
import type { WorkflowDef } from '../types.js';

export interface DshStorage {
  /** 工作流 JSON 目录（工作区内） */
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
// 2026-09-26 布局统一（用户指令）：全部运行数据收拢 <工作区>/.dag-flow/ 下——
//   工作流定义 .dag-flow/workflow/、运行记录 .dag-flow/runs/、临时 .dag-flow/tmp/、日志 .dag-flow/logs/
// 旧 .dag-flow-workflows/ 与 .dsh-workflows/ 不迁移不删除（历史数据原地保留）。
const DIR_NAME = path.join('.dag-flow', 'workflow');
const LEGACY_DIR_NAMES: string[] = [];

export interface StorageInfo {
  dir: string;
  source: string; // 'host-ctx' | 'workspace-registry' | 'process-cwd' | 'user-dir-fallback'
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

async function resolveRoot(): Promise<StorageInfo> {  if (_info) return _info;
  const fromHost = probeHostWorkspace();
  const fromRegistry = fromHost ? null : await probeWorkspaceRegistry();
  if (fromHost) {
    _info = { dir: path.join(fromHost, DIR_NAME), source: 'host-ctx' };
  } else if (fromRegistry) {
    _info = { dir: path.join(fromRegistry, DIR_NAME), source: 'workspace-registry' };
  } else {
    const cwd = usableProcessCwd();
    if (cwd) {
      _info = { dir: path.join(cwd, DIR_NAME), source: 'process-cwd' };
    } else {
      _info = { dir: path.join(USER_DIR, 'workflows'), source: 'user-dir-fallback' };
    }
  }
  await fs.mkdir(_info.dir, { recursive: true });
  if (!_migrated) {
    _migrated = true;
    await migrateFallbackWorkflows(_info);
    await migrateLegacyDirs(_info);
    await migrateLegacySqlite(_info.dir);
  }
  return _info;
}

export async function resolveStorageRoot(): Promise<StorageInfo> {
  return resolveRoot();
}

// ---------- 兜底目录一次性迁入（fail-soft）：~/.dsh/workflows（user-dir-fallback 时代产物）→ 新根 ----------

async function migrateFallbackWorkflows(info: StorageInfo): Promise<void> {
  if (info.source === 'user-dir-fallback') return; // 仍落在兜底目录，无需自迁
  const oldDir = path.join(USER_DIR, 'workflows');
  if (path.resolve(oldDir) === path.resolve(info.dir)) return;
  try {
    const entries = await fs.readdir(oldDir);
    const jsons = entries.filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    if (jsons.length === 0) return;
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
    console.info('[dag-flow] fallback workflows migrated:', oldDir, '→', info.dir, `(${jsons.length} files)`);
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
