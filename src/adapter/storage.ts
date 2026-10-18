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
import { dagFlowHome, dagFlowImagesDir, dagFlowRunTmpDir, dagFlowScopedPath } from '../dsh-gate/paths.js';
import { migrateFromLegacyRoots, migrateFallbackWorkflows, migrateLegacyDirs, migrateLegacySqlite, migrateRunRecords } from './storage-migrate.js';
import { isValidWorkflowName } from '../name-rule.js';
import type { WorkflowDef } from '../types.js';

export interface DshStorage {
  /** 工作流 JSON 目录（<DSH_HOME>/.dag-flow/workflow） */
  workflowsDir(): Promise<string>;
  /** 运行记录目录。★ 2026-10-19 用户要求"每个工作流产生的文件按工作流名分目录"：
   *  给名字 ⇒ `<数据根>/runs/<工作流名>/`；不给 ⇒ `<数据根>/runs/`（历史平铺记录的读取兜底） */
  runsDir(wfName?: string): Promise<string>;
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
  /** 运行记录保留策略（2026-10-11 用户选 A）：每个工作流保留最近 N 条 + 超过 D 天的删除；dryRun 只算不删 */
  /** 清理旧运行记录。给了 `workflowName` 时只扫该工作流目录（+ runs 根的历史平铺），否则全量清扫 */
  pruneRunRecords(opts?: { maxPerWorkflow?: number; maxAgeDays?: number; dryRun?: boolean; workflowName?: string }): Promise<{ deleted: string[]; kept: number }>;
  listRunRecords(workflowName?: string): Promise<string[]>;
  readRunRecord(runId: string): Promise<unknown | null>;
  /** ★ 2026-10-18（用户要求）：运行前清空这些工作流的 `tmp/<名>/` —— 同一工作流多次执行不串文件 */
  pruneRunTmp?(names: string[]): Promise<{ dirs: string[]; deleted: number }>;
  /** ★ 2026-10-18（用户要求「每个工作流保持最新的 5 条执行产生的临时数据」）：
   *  只保留最新 `keep` 个运行目录 `tmp/<名>/<runId>/`，运行前顺带清理 */
  pruneRunTmpDirs?(names: string[], keep?: number): Promise<{ removed: string[] }>;
  /** ★ 2026-10-18：从 def 递归收集本次运行会用到的工作流名（自身 + subflow + loop 循环体） */
  collectRunWorkflows?(def: WorkflowDef, depth?: number): Promise<string[]>;
  /** ★ 2026-10-18（用户要求）：日志按天保留（默认 30 天），过期即删；dryRun 只算不删 */
  pruneLogs?(opts?: { maxFiles?: number; dryRun?: boolean }): Promise<{ deleted: string[]; kept: number }>;
}

// ★ 2026-10-11 用户选定的「策略 A」——运行记录保留口径（此前 runs/ 只增不减，实测 252 文件/16.44 MB）：
//   · 每个工作流保留**最近 200 条**；· 任何记录**超过 30 天**即删；· 两条谁先满足按谁（先到者为准）。
//   硬边界：只删 <runs>/run-*.json（`*.json.tmp` 与其它文件一律不碰）；`workflow/` 与版本快照永不涉及；
//   正在跑的运行**结束时才落盘**，所以不存在"删掉在跑的"；清理失败只记不报，绝不影响本次运行。
export const RUN_KEEP_MAX_PER_WORKFLOW = 200;
export const RUN_KEEP_MAX_AGE_DAYS = 30;
// ★ 2026-10-18 用户要求（原话）：「同一个工作流执行多次生成多份文件，导致每次执行读错文件的问题，读到其他执行
//   生成的文件上去了，每次执行过后要及时清理生成的文件，否则会越积越多，每次执行的日志也要定时清理」。
//   ⇒ ①每次运行**开始前**清空本次会用到的工作流 tmp 目录（含它调用的子工作流 / loop 循环体），
//      这样运行期间「扫目录取最新」只会命中本次写出的产物，不可能读到上一次的；
//      ②日志保留最近 30 天（与运行记录同一口径），每天首次写日志时顺手清。
// ★ 2026-10-18 用户要求：「日志也要挪进 tmp 目录下，留这个日志没啥用，都是已经执行过的过去式了」
//   ⇒ 日志跟着临时数据一起清：只保留最新 N 份，不再按天数。
// ★ 2026-10-18 用户要求：「只保留最近 20 次的文件夹，超过 20 次的，下次执行的时候，自动删除最早的文件夹」
//   ⇒ 运行目录与日志统一口径：各保留最新 20 份。
export const LOG_KEEP_MAX_FILES = 20;
/** 每个工作流保留最近 20 个运行目录（tmp/<名>/<runId>/），下次执行时自动删最早的 */
export const TMP_KEEP_MAX_RUNS = 20;
// ★ 2026-10-11 起：所有运行数据锚定 **<DSH_HOME>/.dag-flow/**（与工作区无关）——
//   工作流定义 .dag-flow/workflow/、运行记录 .dag-flow/runs/、临时 .dag-flow/tmp/、日志 .dag-flow/tmp/logs/。
//   （原 `DIR_NAME = '.dag-flow/workflow'` 常量随四级解析链一起废弃：路径现在由 dagFlowHome() 拼。
//   LEGACY_DIR_NAMES 已随迁移函数族搬至 ./storage-migrate.ts，2026-10-14 重构轮 3。）

export interface StorageInfo {
  dir: string;
  source: string; // 'dsh-home'（2026-10-11 起唯一取值）| 旧值：'host-ctx' | 'workspace-registry' | 'process-cwd' | 'user-dir-fallback'
}

let _info: StorageInfo | null = null;
let _migrated = false;

async function resolveRoot(): Promise<StorageInfo> {
  if (_info) return _info;
  // ★ 2026-10-11：**不再依赖工作区/cwd** —— 根固定在 <DSH_HOME>/.dag-flow/（用户拍板，原话见文件头）。
  _info = { dir: path.join(dagFlowHome(), 'workflow'), source: 'dsh-home' };
  await fs.mkdir(_info.dir, { recursive: true });
  // ★ 2026-10-21 用户要求「别再自动创建 images」：启动时**不预建**图片目录。
  //   真正落图时由 image-library / 产出节点自己 mkdir（读侧只给路径、不建目录）。
  if (!_migrated) {
    _migrated = true;
    await migrateFromLegacyRoots(_info);   // ① 工作区时代的 <旧工作区>/.dag-flow/ → 新根（补缺复制）
    await migrateFallbackWorkflows(_info); // ② 更早的兜底 ~/.dsh/workflows → 新根
    await migrateLegacyDirs(_info);        // ③ 旧目录名
    await migrateLegacySqlite(_info.dir);  // ④ 旧 SQLite
    // ⑤ 2026-10-19：运行记录按工作流分目录（runs/run-*.json → runs/<工作流名>/run-*.json）
    // ★ 2026-10-20：运行记录不再有 runs/ 落点 ⇒ 不再做 runs 迁移（用户已删除旧数据）。
  }
  return _info;
}

export async function resolveStorageRoot(): Promise<StorageInfo> {
  return resolveRoot();
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

/** ★ 2026-10-18：运行记录落 `tmp/<名>/<runId>/run.json`（目录名即 runId）。
 *  给 wfName 只扫该工作流；不给则扫全部工作流（`GET /runs` 全量列表用）。
 *  返回 [runId, 记录所在目录]：列表拿来合并，读取拿来记「id → 目录」缓存。 */
async function listRunRecordsInTmp(wfName?: string): Promise<Array<[string, string]>> {
  type DirLike = { name: string; isDirectory(): boolean };
  const tmpRoot = dagFlowScopedPath('tmp');
  let wfDirs: string[] = [];
  if (wfName) {
    wfDirs = [dagFlowScopedPath('tmp', wfName)];
  } else {
    try {
      const subs = (await fs.readdir(tmpRoot, { withFileTypes: true })) as unknown as DirLike[];
      for (const d of subs) {
        if (typeof d.isDirectory === 'function' && !d.isDirectory()) continue;
        wfDirs.push(path.join(tmpRoot, String(d.name)));
      }
    } catch { return []; }   // 还没跑过任何工作流
  }
  const out: Array<[string, string]> = [];
  for (const root of wfDirs) {
    let subs: DirLike[] = [];
    try { subs = (await fs.readdir(root, { withFileTypes: true })) as unknown as DirLike[]; } catch { continue; }
    for (const d of subs) {
      if (typeof d.isDirectory === 'function' && !d.isDirectory()) continue;
      const dir = path.join(root, String(d.name));
      try { await fs.access(path.join(dir, 'run.json')); out.push([String(d.name), dir]); } catch { /* 该次运行没写记录 */ }
    }
  }
  return out;
}

/**
 * 列目录下的 JSON 名（排除隐藏与 .bak）。
 * · sortBy='mtime'（默认）：按修改时间新→旧 —— 工作流列表要这个，文件数少，stat 无所谓。
 * · sortBy='name'：按文件名**倒序**，**零 stat** —— 给运行记录用：
 *   记录名是 `run-<13 位 epoch ms>-<rand>.json`，字典序 ≡ 时间序。
 *   ★ 2026-10-19 自检实测（用户机器 343 条记录 / 23 个目录）：
 *     老实现「readdir + 每文件串行 fs.stat」= **23.22ms**；本实现（withFileTypes 零 stat + 子目录并行）= **0.68ms**。
 *   为什么要换：`/runs` 与每次运行后的 `pruneRunRecords` 都走这条路，而记录数只增不减，
 *   串行 stat 等于把 O(n) 次系统调用摊在每次调用上。
 */
async function listJsonNames(dir: string, sortBy: 'mtime' | 'name' = 'mtime'): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  // 符号链接也算文件（老实现是 readdir(名字)+stat，会跟随链接；这里保持同一口径）
  const files = entries
    .filter((d) => (d.isFile() || d.isSymbolicLink()) && d.name.endsWith('.json') && !d.name.startsWith('.'))
    .map((d) => d.name);

  if (sortBy === 'name') {
    return files.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map((f) => f.replace(/\.json$/, ''));
  }

  // mtime 模式：并行 stat（原来逐个 await，串行 I/O）
  const stats = await Promise.all(files.map(async (f) => {
    try {
      const st = await fs.stat(path.join(dir, f));
      return { name: f.replace(/\.json$/, ''), m: st.mtimeMs };
    } catch {
      return null;
    }
  }));
  return stats
    .filter((x): x is { name: string; m: number } => x !== null)
    .sort((a, b) => b.m - a.m)
    .map((x) => x.name);
}

// ---------- 存储实现 ----------

/**
 * runId → 它所在的目录。
 * 动机（2026-10-19 自检）：记录按工作流分目录后，`readRunRecord(runId)` 只拿到 id，
 * 只能逐目录试读。而 `GET /runs` 一次要读最近 20 条 ⇒ 最坏 20×24 次 fs 尝试（实测 23ms）。
 * 解决：`listRunRecords` 本来就要扫全部目录，顺手把「id → 目录」记下来，`readRunRecord` 命中即精确读。
 * 失效安全：命中但读不到（文件被删/搬走）⇒ 删缓存项并回退到逐目录试，不需要精细失效逻辑。
 */
const _runLoc = new Map<string, string>();

export function createStorage(): DshStorage {
  return {
    async describe() {
      return resolveRoot();
    },
    async workflowsDir() {
      return (await resolveRoot()).dir;
    },
    async runsDir(wfName?: string) {
      // ★ 2026-10-19：运行记录按工作流分目录 `<数据根>/runs/<工作流名>/`（用户要求"每个工作流产生的文件
      //   都以 .dag-flow/**/工作流名称/文件 存放"）。不给名字 ⇒ `runs/` 根，兼容历史平铺记录。
      const dir = dagFlowScopedPath('runs', wfName);
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
      // ★ 2026-10-19 用户拍板 A：**改名撞名绝不允许覆盖**（与 workflow-picker「创建」那条路径同一把尺子）。
      //   旧行为：直接 writeFile 覆盖 ⇒ 改名成已存在的名字时，对方工作流的定义被静默吃掉，
      //   而改名方自己的 runs/images/tmp 还会并进对方目录，两边数据混在一起、再也分不开。
      //   检查必须放在**写入之前**（否则已经覆盖了才发现）。
      //   注意：只有「带 renameFrom 的改名保存」才查——普通保存写的是自己那份文件，覆盖属正常语义。
      const renameFromEarly = opts?.renameFrom;
      if (renameFromEarly && renameFromEarly !== name) {
        if (await fs.stat(file).catch(() => null)) {
          throw new Error(`工作流「${name}」已存在——改名会覆盖它，已拒绝。换一个名字，或先处理掉「${name}」。`);
        }
      }
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, next, 'utf8');
      await fs.rename(tmp, file); // 同盘原子替换
      // ★ 重命名联动（2026-10-02 用户需求「名称改了，响应使用的地方也要改，保持一致」）：
      //   renameFrom=旧名时——删旧 <旧名>.json，并把**所有以工作流名命名的目录**搬到新名下。
      //   失败静默（搬移是增强，不阻塞保存）。
      // ★ 2026-10-19（用户：「工作流名称发生变动，涉及工作流名称的路径也要同步变更」）：
      //   此前只搬 versions/ 与 scripts/ 两个；按工作流分目录后新增的 runs/images/tmp **全漏了**
      //   ⇒ 改名后运行记录、抽出的图、临时文件全部留在旧名下（等于丢失归属，也被当成别人工作流的）。
      const renameFrom = opts?.renameFrom;
      if (renameFrom && renameFrom !== name) {
        try {
          const oldSafe = safeName(renameFrom);
          const root = path.dirname(dir); // .dag-flow/
          await fs.rm(path.join(dir, `${oldSafe}.json`), { force: true });
          // versions 在 workflow/ 之下；其余四个在 .dag-flow/ 之下——分开拼
          const pairs: [string, string][] = [
            [path.join(dir, 'versions', oldSafe), path.join(dir, 'versions', safe)],
            [path.join(root, 'workflow', 'scripts', oldSafe), path.join(root, 'workflow', 'scripts', safe)],
            [path.join(root, 'runs', oldSafe), path.join(root, 'runs', safe)],
            [path.join(root, 'images', oldSafe), path.join(root, 'images', safe)],
            [path.join(root, 'tmp', oldSafe), path.join(root, 'tmp', safe)],
          ];
          for (const [from, to] of pairs) {
            // 目标已存在就**合并**而不是放弃：改名时新名字可能已经有目录（先跑过又改回去），两边的文件都该留住。
            if (from === to) continue;
            try { await fs.stat(from); } catch { continue; }        // 旧目录不存在：没什么可搬
            if (await fs.stat(to).catch(() => null)) {
              await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false }).catch(() => {});
              await fs.rm(from, { recursive: true, force: true }).catch(() => {});
            } else {
              await fs.rename(from, to);
            }
          }
        } catch { /* 重命名搬移失败不阻塞保存 */ }
      }
    },
    async deleteWorkflow(name) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      const root = path.dirname(dir);              // <数据根>/.dag-flow
      await fs.rm(path.join(dir, `${safe}.json`), { force: true });
      // ★ 2026-10-19 用户要求：「删除工作流的时候，也要以这种方式，清理对应工作流的所有文件和文件夹」。
      //   此前只删「定义 json + versions」，`scripts/`、`runs/`、`images/`、`tmp/` 下的同名目录全部残留
      //   （真机实况：删完工作流，磁盘上仍留着它的代码、运行记录、抽出来的图）。
      //   这里按"每个工作流一个专属子目录"的布局逐个清；单个失败不阻塞其它（force 也不报缺失）。
      const ownedDirs = [
        path.join(dir, 'versions', safe),          // 历史版本
        path.join(root, 'workflow', 'scripts', safe),   // python/bash 代码（2026-10-18 起挂 workflow/ 下）
        path.join(root, 'runs', safe),             // 运行记录
        path.join(root, 'images', safe),           // 抽图 / 生成的图片
        path.join(root, 'tmp', safe),              // 中间产物
      ];
      for (const d of ownedDirs) {
        try { await fs.rm(d, { recursive: true, force: true }); } catch { /* 单个失败不影响其它 */ }
      }
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
      // ★ 2026-10-18 用户要求：运行记录也随本次运行目录走 —— `tmp/<工作流名>/<runId>/run.json`，
      //   由「每个工作流只保留最新 20 个运行目录」统一清理；旧 `runs/<名>/` 里的历史记录仍可读（见 listRunRecords）。
      const wfName = String((summary as { workflowName?: unknown } | null)?.workflowName ?? '') || '__anonymous__';
      const dir = dagFlowRunTmpDir(wfName, runId);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'run.json');
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(summary, null, 2), 'utf8');
      await fs.rename(tmp, file);
      // ★ 2026-10-20：记录已经住在运行目录里，由「每个工作流保留最新 20 个运行目录」统一清理 ⇒
      //   原来这次 fire-and-forget 的 runs/ 清理已无对象（用户已删掉旧 runs/ 数据），去掉以免再建目录。
    },
    async pruneRunRecords(opts) {
      const maxPer = opts?.maxPerWorkflow ?? RUN_KEEP_MAX_PER_WORKFLOW;
      const maxAgeMs = (opts?.maxAgeDays ?? RUN_KEEP_MAX_AGE_DAYS) * 86_400_000;
      const dryRun = opts?.dryRun === true;
      // ★ 2026-10-19：分目录后要扫两级 —— `runs/` 根（历史平铺）+ `runs/<工作流名>/`
      const root = await this.runsDir();
      // ★ 2026-10-19 自检修正：给了 `workflowName` 就**只扫它自己的目录**（+ 根里的历史平铺）。
      //   写入路径（writeRunRecord）会传名字 ⇒ 每次运行不再全树扫描；不传名字时保持全量清扫（配管/手工调用）。
      let dirs: string[] = [root];
      if (opts?.workflowName) {
        dirs = [dagFlowScopedPath('runs', opts.workflowName), root];
      } else {
        try {
          for (const d of await fs.readdir(root, { withFileTypes: true })) {
            if (d.isDirectory()) dirs.push(path.join(root, d.name));
          }
        } catch { return { deleted: [], kept: 0 }; }
      }

      type Entry = { file: string; name: string; group: string; t: number };
      const entries: Entry[] = [];
      for (const dir of dirs) {
        let names: string[] = [];
        try { names = await fs.readdir(dir); } catch { continue; }
        for (const f of names) {
          if (!/^run-.*\.json$/.test(f)) continue;   // 只认运行记录；.tmp 与其它文件一律不碰
          const full = path.join(dir, f);
          // 时间戳优先取「文件名里的 epoch ms」（run-<ms>-<rand>.json），其次记录里的 finishedAt/endedAt/startedAt，最后 mtime
          let t = Number(/-(\d{10,})-[^.]*\.json$/.exec(f)?.[1] ?? 0);
          let group = '(未命名)';
          try {
            const fh = await fs.open(full, 'r');
            try {
              const buf = Buffer.alloc(256);
              const { bytesRead } = await fh.read(buf, 0, 256, 0);
              const head = buf.subarray(0, bytesRead).toString('utf8');
              const g = /"workflowName"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
              if (g !== undefined) group = JSON.parse(`"${g}"`) as string;
              const fin = /"(?:finishedAt|endedAt|startedAt)"\s*:\s*"([^"]+)"/.exec(head)?.[1];
              const parsed = fin ? Date.parse(fin) : NaN;
              if (Number.isFinite(parsed)) t = parsed;
            } finally { await fh.close(); }
          } catch { /* 读不到就退化成文件名/mtime */ }
          if (!t) { try { t = (await fs.stat(full)).mtimeMs; } catch { t = 0; } }
          entries.push({ file: full, name: f, group, t });
        }
      }

      const byGroup = new Map<string, Entry[]>();
      for (const e of entries) {
        const arr = byGroup.get(e.group);
        if (arr) arr.push(e); else byGroup.set(e.group, [e]);
      }
      const now = Date.now();
      const doomed: Entry[] = [];
      for (const arr of byGroup.values()) {
        arr.sort((a, b) => b.t - a.t);            // 新的在前：排名 ≥ maxPer 的淘汰
        arr.forEach((e, i) => {
          const tooMany = i >= maxPer;
          // t=0（既无时间戳也无 mtime）不按年龄淘汰，避免"读不到时间就误删"
          const tooOld = e.t > 0 && now - e.t > maxAgeMs;
          if (tooMany || tooOld) doomed.push(e);
        });
      }
      if (!dryRun) {
        for (const e of doomed) { try { await fs.rm(e.file, { force: true }); } catch { /* 单个失败忽略 */ } }
      }
      return { deleted: doomed.map((e) => e.name).sort(), kept: entries.length - doomed.length };
    },
    /** ★ 2026-10-18：收集本次运行会用到的工作流名（自身 + subflow + loop 循环体，递归 2 层）。
     *  读不到子工作流定义时**也把名字带上**（可能是已改名/已删的旧目录，照样该清）。 */
    async collectRunWorkflows(def, depth = 2) {
      const out = new Set<string>();
      const walk = async (d: WorkflowDef | null, left: number): Promise<void> => {
        if (!d) return;
        const name = String((d as { name?: unknown }).name ?? '').trim();
        if (name) out.add(name);
        if (left <= 0) return;
        const subs: string[] = [];
        for (const n of (d.nodes ?? []) as { type?: string; params?: Record<string, unknown> }[]) {
          const p = (n.params ?? {}) as Record<string, unknown>;
          if (n.type === 'subflow' && typeof p.workflowName === 'string' && p.workflowName.trim()) subs.push(p.workflowName.trim());
          if (n.type === 'loop') {
            const body = p.body as { workflowName?: unknown } | undefined;
            if (body && typeof body.workflowName === 'string' && body.workflowName.trim()) subs.push(body.workflowName.trim());
          }
        }
        for (const s of subs) {
          if (out.has(s)) continue;
          let sub: WorkflowDef | null = null;
          try { sub = await this.readWorkflow(s); } catch { /* 读不到就只清目录 */ }
          if (sub) await walk(sub, left - 1);
          else out.add(s);
        }
      };
      await walk(def, depth);
      return [...out];
    },
    /** ★ 2026-10-18（用户要求「每执行一次产生一个独立文件夹…只保留最近 20 次，下次执行时自动删最早的」）：
     *  按 mtime 只留最新 `keep-1` 个运行目录（本次运行还会新建一个 ⇒ 跑完正好 keep 条）。
     *  · 只认 `tmp/<名>/` 下的**子目录**（= 运行目录）；历史平铺的散文件不碰（交给 pruneRunTmp）；
     *  · 单个目录删失败不影响其它，也不抛给调用方。 */
    async pruneRunTmpDirs(names, keep = TMP_KEEP_MAX_RUNS) {
      const removed: string[] = [];
      const limit = Math.max(0, Math.trunc(keep) - 1);
      for (const raw of names ?? []) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        const dir = dagFlowScopedPath('tmp', name);
        let entries: { name: string; isDirectory(): boolean }[] = [];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        const subs: { name: string; t: number }[] = [];
        for (const e of entries) {
          if (typeof e.isDirectory === 'function' && !e.isDirectory()) {
            // 历史平铺文件（旧结构把产物直接放在 `tmp/<名>/` 下）：一并清掉，
            // 否则新旧结构混在一层，节点的「扫目录取最新」又可能读到旧的。
            try { await fs.rm(path.join(dir, e.name), { force: true }); removed.push(e.name); } catch { /* 忽略 */ }
            continue;
          }
          let t = 0;
          try { t = (await fs.stat(path.join(dir, e.name))).mtimeMs; } catch { t = 0; }
          subs.push({ name: e.name, t });
        }
        subs.sort((a, b) => b.t - a.t);                 // 新的在前
        for (const s of subs.slice(limit)) {
          try { await fs.rm(path.join(dir, s.name), { recursive: true, force: true }); removed.push(s.name); } catch { /* 忽略 */ }
        }
      }
      return { removed };
    },
    /** ★ 2026-10-18：清空这些工作流的 tmp 目录内容（目录本身保留）。
     *  只在本工作流的**顶层运行入口**调用（用户手动 / 定时 / CLI）——
     *  子工作流内部调用（control.ts 的 subflow / loop 体）绝不能清，否则上层节点读不到刚写出的产物。
     *  单个文件删失败不影响其它，也不抛给调用方。 */
    async pruneRunTmp(names) {
      const dirs: string[] = [];
      let deleted = 0;
      for (const raw of names ?? []) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        const dir = dagFlowScopedPath('tmp', name);
        let entries: { name: string }[] = [];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        if (entries.length) dirs.push(dir);
        for (const e of entries) {
          try { await fs.rm(path.join(dir, e.name), { recursive: true, force: true }); deleted += 1; } catch { /* 单个失败忽略 */ }
        }
      }
      return { dirs, deleted };
    },
    /** ★ 2026-10-18：清理过期日志（默认保留 30 天）。判据优先用**文件名里的日期**（与日志分天口径一致），
     *  读不到再退 mtime；只删 `dag-flow-YYYY-MM-DD.log`，目录里其它文件一律不碰。 */
    /** ★ 2026-10-18 用户要求「日志也要挪进 tmp 目录下…都是已经执行过的过去式了」：
     *  日志改落 `tmp/logs/`，只保留最新 `maxFiles`（默认 5）份，与临时数据同一口径。
     *  · 只认 `dag-flow-YYYY-MM-DD.log`（文件名日期即字典序），其它文件一律不算也不碰；
     *  · dryRun 只算不删。 */
    async pruneLogs(opts) {
      const maxFiles = Math.max(1, Math.trunc(opts?.maxFiles ?? LOG_KEEP_MAX_FILES));
      const dir = path.join(dagFlowHome(), 'tmp', 'logs');
      let names: string[] = [];
      try { names = await fs.readdir(dir); } catch { return { deleted: [], kept: 0 }; }
      const logs = names.filter((f) => /^dag-flow-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      const keep = new Set(logs.slice(Math.max(0, logs.length - maxFiles)));
      const deleted: string[] = [];
      let kept = names.length - logs.length;
      for (const f of logs) {
        if (keep.has(f)) { kept += 1; continue; }
        if (opts?.dryRun !== true) {
          try { await fs.rm(path.join(dir, f), { force: true }); } catch { kept += 1; continue; }
        }
        deleted.push(f);
      }
      return { deleted: deleted.sort(), kept };
    },
    async listRunRecords(workflowName) {
      // ★ 2026-10-20 用户拍板「不用兼容旧位置数据，都删了」⇒ 运行记录只在
      //   `tmp/<名>/<runId>/run.json`，旧 `runs/` 不再参与列表。
      //   排序与 listJsonNames('name') 同口径：按名**倒序**（run-<ms>-* 字典序≡时间序，最新在前）。
      const recs = await listRunRecordsInTmp(workflowName);
      for (const [id, dir] of recs) _runLoc.set(id, dir);
      return recs.map(([id]) => id).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    },
    async readRunRecord(runId) {
      // ★ 2026-10-20：记录只在运行目录里（`tmp/<名>/<runId>/run.json`），旧 `runs/` 不再兜底。
      //   优先用 `listRunRecords` 记下的「id → 目录」精确读，未命中才扫一遍运行目录（数量受「最新 20 个」限制）。
      const base = path.basename(runId);
      const cached = _runLoc.get(base);
      if (cached) {
        try { return JSON.parse(await fs.readFile(path.join(cached, 'run.json'), 'utf8')) as unknown; }
        catch { _runLoc.delete(base); }   // 文件被删/搬走：清缓存，下面重新扫
      }
      for (const [id, dir] of await listRunRecordsInTmp()) {
        if (id !== base) continue;
        try {
          _runLoc.set(base, dir);
          return JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8')) as unknown;
        } catch { /* 这条坏掉就看下一条 */ }
      }
      return null;
    },
  };
}
