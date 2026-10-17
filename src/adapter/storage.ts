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
import { dagFlowHome, dagFlowImagesDir, dagFlowScopedPath } from '../dsh-gate/paths.js';
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
  pruneRunRecords(opts?: { maxPerWorkflow?: number; maxAgeDays?: number; dryRun?: boolean }): Promise<{ deleted: string[]; kept: number }>;
  listRunRecords(workflowName?: string): Promise<string[]>;
  readRunRecord(runId: string): Promise<unknown | null>;
}

// ★ 2026-10-11 用户选定的「策略 A」——运行记录保留口径（此前 runs/ 只增不减，实测 252 文件/16.44 MB）：
//   · 每个工作流保留**最近 200 条**；· 任何记录**超过 30 天**即删；· 两条谁先满足按谁（先到者为准）。
//   硬边界：只删 <runs>/run-*.json（`*.json.tmp` 与其它文件一律不碰）；`workflow/` 与版本快照永不涉及；
//   正在跑的运行**结束时才落盘**，所以不存在"删掉在跑的"；清理失败只记不报，绝不影响本次运行。
export const RUN_KEEP_MAX_PER_WORKFLOW = 200;
export const RUN_KEEP_MAX_AGE_DAYS = 30;
// ★ 2026-10-11 起：所有运行数据锚定 **<DSH_HOME>/.dag-flow/**（与工作区无关）——
//   工作流定义 .dag-flow/workflow/、运行记录 .dag-flow/runs/、临时 .dag-flow/tmp/、日志 .dag-flow/logs/。
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
  // ★ 2026-10-16（用户拍板）：统一图片目录启动即建好——AI 节点 `images` 写文件名就能读，
  //   文档解析节点将来抽出的图片也落这里。fail-soft：建不出来不影响其它功能（读取侧会给出确切路径）。
  try { await fs.mkdir(dagFlowImagesDir(), { recursive: true }); } catch { /* fail-soft */ }
  if (!_migrated) {
    _migrated = true;
    await migrateFromLegacyRoots(_info);   // ① 工作区时代的 <旧工作区>/.dag-flow/ → 新根（补缺复制）
    await migrateFallbackWorkflows(_info); // ② 更早的兜底 ~/.dsh/workflows → 新根
    await migrateLegacyDirs(_info);        // ③ 旧目录名
    await migrateLegacySqlite(_info.dir);  // ④ 旧 SQLite
    // ⑤ 2026-10-19：运行记录按工作流分目录（runs/run-*.json → runs/<工作流名>/run-*.json）
    await migrateRunRecords(_info).catch(() => { /* 迁移失败不影响运行 */ });
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
            [path.join(root, 'scripts', oldSafe), path.join(root, 'scripts', safe)],
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
        path.join(root, 'scripts', safe),          // python/bash 代码
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
      // ★ 2026-10-19：按工作流分目录 `runs/<工作流名>/`（记录里本来就带 workflowName）
      const wfName = String((summary as { workflowName?: unknown } | null)?.workflowName ?? '');
      const dir = await this.runsDir(wfName);
      const file = path.join(dir, `${path.basename(runId)}.json`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(summary, null, 2), 'utf8');
      await fs.rename(tmp, file);
      // ★ 2026-10-11（策略 A）：新记录落盘后顺手清理旧记录。**不 await**——不让清理拖慢/拖垮本次运行。
      void this.pruneRunRecords().catch(() => { /* 清理失败不影响运行 */ });
    },
    async pruneRunRecords(opts) {
      const maxPer = opts?.maxPerWorkflow ?? RUN_KEEP_MAX_PER_WORKFLOW;
      const maxAgeMs = (opts?.maxAgeDays ?? RUN_KEEP_MAX_AGE_DAYS) * 86_400_000;
      const dryRun = opts?.dryRun === true;
      // ★ 2026-10-19：分目录后要扫两级 —— `runs/` 根（历史平铺）+ `runs/<工作流名>/`
      const root = await this.runsDir();
      const dirs: string[] = [root];
      try {
        for (const d of await fs.readdir(root, { withFileTypes: true })) {
          if (d.isDirectory()) dirs.push(path.join(root, d.name));
        }
      } catch { return { deleted: [], kept: 0 }; }

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
    async listRunRecords(workflowName) {
      // ★ 2026-10-19：分目录后 —— 给了名字读 `runs/<名>/`，并并上 `runs/` 根里属于它的历史平铺记录；
      //   不给名字则遍历根 + 全部子目录。
      const root = await this.runsDir();
      if (!workflowName) {
        const all: string[] = [];
        try {
          for (const d of await fs.readdir(root, { withFileTypes: true })) {
            if (d.isDirectory()) all.push(...(await listJsonNames(path.join(root, d.name))));
          }
        } catch { /* 读不到就只返回根 */ }
        all.push(...(await listJsonNames(root)));
        return all;
      }
      const out: string[] = await listJsonNames(dagFlowScopedPath('runs', workflowName));
      for (const id of await listJsonNames(root)) {
        try {
          const buf = await fs.readFile(path.join(root, `${id}.json`), 'utf8');
          const r = JSON.parse(buf) as { workflowName?: string };
          if (r.workflowName === workflowName) out.push(id);
        } catch { /* skip */ }
      }
      return out;
    },
    async readRunRecord(runId) {
      // ★ 2026-10-19：记录现在在 `runs/<工作流名>/` 下，调用方只给 runId ⇒ 挨个目录找。
      const base = path.basename(runId);
      const root = await this.runsDir();
      const dirs: string[] = [root];
      try {
        for (const d of await fs.readdir(root, { withFileTypes: true })) {
          if (d.isDirectory()) dirs.push(path.join(root, d.name));
        }
      } catch { /* 仅有根 */ }
      for (const dir of dirs) {
        try {
          const buf = await fs.readFile(path.join(dir, `${base}.json`), 'utf8');
          return JSON.parse(buf) as unknown;
        } catch { /* 下一个目录 */ }
      }
      return null;
    },
  };
}
