// tmp-test/smoke-rename-store.mjs
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path3 from "node:path";

// src/adapter/storage.ts
import { promises as fs } from "node:fs";
import * as path2 from "node:path";
import * as os2 from "node:os";

// src/adapter/safety.ts
function hostService(name, host = _host) {
  if (host == null) return void 0;
  const ctx = host;
  try {
    const get = ctx.get;
    if (typeof get === "function") {
      const strict = get.call(host, name);
      if (strict !== void 0 && strict !== null) return strict;
      const lax = get.call(host, name, false);
      if (lax !== void 0 && lax !== null) return lax;
    }
  } catch {
  }
  try {
    return ctx[name];
  } catch {
    return void 0;
  }
}
var _host = null;
function getHost() {
  return _host;
}

// src/adapter/dsh-home.ts
import * as os from "node:os";
import * as path from "node:path";
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

// src/name-rule.ts
var NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
function isValidWorkflowName(name) {
  return NAME_RE.test(name);
}

// src/adapter/storage.ts
var USER_DIR = dshHome();
var DIR_NAME = path2.join(".dag-flow", "workflow");
var LEGACY_DIR_NAMES = [];
var _info = null;
var _migrated = false;
function probeHostWorkspace() {
  try {
    const host = getHost();
    if (!host) return null;
    const ws = hostService("workspace") ?? hostService("workspaceService");
    const candidates = [
      ws?.cwd,
      ws?.root,
      ws?.path,
      ws?.dir,
      hostService("cwd"),
      hostService("baseDir"),
      hostService("workspacePath")
    ];
    for (const c of candidates) {
      const v = typeof c === "function" ? c() : c;
      if (typeof v === "string" && v && path2.isAbsolute(v)) return v;
    }
  } catch {
  }
  return null;
}
function usableProcessCwd() {
  try {
    const cwd = process.cwd();
    if (!cwd || !path2.isAbsolute(cwd)) return null;
    const lower = cwd.toLowerCase();
    if (lower.endsWith("\\system32") || lower.endsWith("/system32")) return null;
    if (path2.resolve(cwd) === path2.resolve(os2.homedir())) return null;
    return cwd;
  } catch {
    return null;
  }
}
async function probeWorkspaceRegistry() {
  try {
    const wr = hostService("workspaceRegistry");
    if (!wr || typeof wr.list !== "function") return null;
    const list = await wr.list();
    if (!Array.isArray(list) || list.length === 0) return null;
    const paths = list.map((w) => typeof w?.path === "string" ? w.path : "").filter((p) => p && path2.isAbsolute(p));
    const existing = [];
    for (const p of paths) {
      try {
        if ((await fs.stat(p)).isDirectory()) existing.push(p);
      } catch {
      }
    }
    if (existing.length === 0) return null;
    if (existing.length === 1) return existing[0];
    const sorted = [...list].filter((w) => existing.includes(String(w?.path))).sort((a, b) => String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")));
    const best = sorted[0]?.path;
    return typeof best === "string" && best ? best : existing[0];
  } catch {
    return null;
  }
}
async function resolveRoot() {
  if (_info) return _info;
  const fromHost = probeHostWorkspace();
  const fromRegistry = fromHost ? null : await probeWorkspaceRegistry();
  if (fromHost) {
    _info = { dir: path2.join(fromHost, DIR_NAME), source: "host-ctx" };
  } else if (fromRegistry) {
    _info = { dir: path2.join(fromRegistry, DIR_NAME), source: "workspace-registry" };
  } else {
    const cwd = usableProcessCwd();
    if (cwd) {
      _info = { dir: path2.join(cwd, DIR_NAME), source: "process-cwd" };
    } else {
      _info = { dir: path2.join(USER_DIR, "workflows"), source: "user-dir-fallback" };
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
async function migrateFallbackWorkflows(info) {
  if (info.source === "user-dir-fallback") return;
  const oldDir = path2.join(USER_DIR, "workflows");
  if (path2.resolve(oldDir) === path2.resolve(info.dir)) return;
  try {
    const entries = await fs.readdir(oldDir);
    const jsons = entries.filter((f) => f.endsWith(".json") && !f.startsWith("."));
    if (jsons.length === 0) return;
    for (const f of jsons) {
      const dst = path2.join(info.dir, f);
      try {
        await fs.access(dst);
        continue;
      } catch {
      }
      await fs.copyFile(path2.join(oldDir, f), dst);
    }
    const oldVersions = path2.join(oldDir, "versions");
    try {
      await fs.access(oldVersions);
      const newVersions = path2.join(info.dir, "versions");
      try {
        await fs.access(newVersions);
      } catch {
        await fs.cp(oldVersions, newVersions, { recursive: true, force: false, errorOnExist: false });
      }
    } catch {
    }
    console.info("[dag-flow] fallback workflows migrated:", oldDir, "\u2192", info.dir, `(${jsons.length} files)`);
  } catch {
  }
}
async function migrateLegacyDirs(info) {
  for (const legacy of LEGACY_DIR_NAMES) {
    const oldDir = path2.join(path2.dirname(info.dir), legacy);
    if (path2.resolve(oldDir) === path2.resolve(info.dir)) continue;
    try {
      const entries = await fs.readdir(oldDir);
      if (entries.length === 0) continue;
      await fs.mkdir(info.dir, { recursive: true });
      await fs.mkdir(path2.join(info.dir, "runs"), { recursive: true });
      for (const f of entries) {
        const src = path2.join(oldDir, f);
        const dst = path2.join(info.dir, f);
        try {
          await fs.access(dst);
          continue;
        } catch {
        }
        await fs.rename(src, dst);
      }
      const rest = await fs.readdir(oldDir);
      if (rest.length === 0) await fs.rmdir(oldDir);
      console.info("[dag-flow] legacy storage dir migrated:", oldDir, "\u2192", info.dir);
    } catch {
    }
  }
}
async function migrateLegacySqlite(newDir) {
  const legacyDir = path2.join(USER_DIR, "workflows");
  const dbFile = path2.join(legacyDir, "workflows.db");
  try {
    if (!path2.dirname(dbFile)) return;
    await fs.access(dbFile);
  } catch {
    return;
  }
  try {
    const mod = await import("node:sqlite");
    if (typeof mod.DatabaseSync !== "function") return;
    const db = new mod.DatabaseSync(dbFile);
    try {
      const rows = db.prepare("SELECT name, def FROM workflows").all();
      for (const r of rows) {
        if (!isValidWorkflowName(r.name ?? "")) continue;
        const target = path2.join(newDir, `${r.name}.json`);
        try {
          await fs.access(target);
          continue;
        } catch {
        }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.def), null, 2), "utf8");
      }
    } catch {
    }
    try {
      const runsDir = path2.join(newDir, "runs");
      await fs.mkdir(runsDir, { recursive: true });
      const rows = db.prepare("SELECT run_id, summary FROM runs").all();
      for (const r of rows) {
        const target = path2.join(runsDir, `${r.run_id}.json`);
        try {
          await fs.access(target);
          continue;
        } catch {
        }
        await fs.writeFile(target, JSON.stringify(JSON.parse(r.summary), null, 2), "utf8");
      }
    } catch {
    }
    await fs.rename(dbFile, `${dbFile}.bak`);
    console.info("[dag-flow] legacy SQLite exported to JSON:", newDir, "(workflows.db \u2192 .bak)");
  } catch (e) {
    console.warn("[dag-flow] legacy SQLite migration skipped:", e.message);
  }
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
function safeName(name) {
  if (!isValidWorkflowName(name)) {
    throw new Error(`\u5DE5\u4F5C\u6D41\u540D\u79F0\u4E0D\u5408\u6CD5\uFF08\u9700\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57\u5F00\u5934\uFF0C\u4EC5\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u8FDE\u5B57\u7B26\uFF0C\u226464 \u5B57\u7B26\uFF09: ${name}`);
  }
  return name;
}
async function listJsonNames(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    try {
      const st = await fs.stat(path2.join(dir, f));
      out.push({ name: f.replace(/\.json$/, ""), m: st.mtimeMs });
    } catch {
    }
  }
  return out.sort((a, b) => b.m - a.m).map((x) => x.name);
}
function createStorage() {
  return {
    async describe() {
      return resolveRoot();
    },
    async workflowsDir() {
      return (await resolveRoot()).dir;
    },
    async runsDir() {
      const dir = path2.join(path2.dirname((await resolveRoot()).dir), "runs");
      await ensureDir(dir);
      return dir;
    },
    async readWorkflow(name) {
      const safe = safeName(name);
      const file = path2.join(await this.workflowsDir(), `${safe}.json`);
      try {
        const buf = await fs.readFile(file, "utf8");
        return JSON.parse(buf);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async writeWorkflow(name, def, opts) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await ensureDir(dir);
      const file = path2.join(dir, `${safe}.json`);
      const next = JSON.stringify(def, null, 2);
      if (opts?.snapshot !== false) {
        try {
          const vdir = path2.join(dir, "versions", safe);
          const files = (await fs.readdir(vdir).catch(() => [])).filter((f) => f.endsWith(".json")).sort().reverse();
          const latest = files[0] ? await fs.readFile(path2.join(vdir, files[0]), "utf8").catch(() => null) : null;
          if (latest !== next) {
            await ensureDir(vdir);
            const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
            await fs.writeFile(path2.join(vdir, `${ts}.json`), next, "utf8");
            const vs = (await fs.readdir(vdir)).filter((f) => f.endsWith(".json")).sort().reverse();
            for (const f of vs.slice(20)) await fs.rm(path2.join(vdir, f), { force: true });
          }
        } catch {
        }
      }
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, next, "utf8");
      await fs.rename(tmp, file);
      const renameFrom = opts?.renameFrom;
      if (renameFrom && renameFrom !== name) {
        try {
          const oldSafe = safeName(renameFrom);
          const root2 = path2.dirname(dir);
          await fs.rm(path2.join(dir, `${oldSafe}.json`), { force: true });
          const pairs = [
            [path2.join(dir, "versions", oldSafe), path2.join(dir, "versions", safe)],
            [path2.join(root2, "scripts", oldSafe), path2.join(root2, "scripts", safe)]
          ];
          for (const [from, to] of pairs) {
            if (from !== to && await fs.stat(from).catch(() => null) && !await fs.stat(to).catch(() => null)) {
              await fs.rename(from, to);
            }
          }
        } catch {
        }
      }
    },
    async deleteWorkflow(name) {
      const safe = safeName(name);
      const dir = await this.workflowsDir();
      await fs.rm(path2.join(dir, `${safe}.json`), { force: true });
      await fs.rm(path2.join(dir, "versions", safe), { recursive: true, force: true });
    },
    async listVersions(name) {
      const safe = safeName(name);
      const vdir = path2.join(await this.workflowsDir(), "versions", safe);
      try {
        const files = await fs.readdir(vdir);
        return files.filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => ({ ts: f.replace(/\.json$/, "") })).sort((a, b) => a.ts < b.ts ? 1 : -1);
      } catch {
        return [];
      }
    },
    async readVersion(name, ts) {
      const safe = safeName(name);
      const file = path2.join(await this.workflowsDir(), "versions", safe, `${path2.basename(ts)}.json`);
      try {
        const buf = await fs.readFile(file, "utf8");
        return JSON.parse(buf);
      } catch {
        return null;
      }
    },
    async listWorkflows() {
      return listJsonNames(await this.workflowsDir());
    },
    async writeRunRecord(runId, summary) {
      const dir = await this.runsDir();
      const file = path2.join(dir, `${path2.basename(runId)}.json`);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(summary, null, 2), "utf8");
      await fs.rename(tmp, file);
    },
    async listRunRecords(workflowName) {
      const dir = await this.runsDir();
      const ids = await listJsonNames(dir);
      if (!workflowName) return ids;
      const out = [];
      for (const id of ids) {
        try {
          const buf = await fs.readFile(path2.join(dir, `${id}.json`), "utf8");
          const r = JSON.parse(buf);
          if (r.workflowName === workflowName) out.push(id);
        } catch {
        }
      }
      return out;
    },
    async readRunRecord(runId) {
      try {
        const buf = await fs.readFile(path2.join(await this.runsDir(), `${path2.basename(runId)}.json`), "utf8");
        return JSON.parse(buf);
      } catch {
        return null;
      }
    }
  };
}

// tmp-test/smoke-rename-store.mjs
var root = path3.join(tmpdir(), "dag-flow-rename-smoke-" + Date.now());
mkdirSync(path3.join(root, ".dag-flow", "workflow"), { recursive: true });
process.chdir(root);
var OLD = "\u65E7\u540D\u5DE5\u4F5C\u6D41";
var NEW = "\u65B0\u540D\u5DE5\u4F5C\u6D41";
var storage = createStorage();
await storage.writeWorkflow(OLD, { name: OLD, version: 1, nodes: [{ id: "start", type: "start", next: "end" }, { id: "end", type: "end" }] }, { snapshot: true });
await storage.writeWorkflow(OLD, { name: OLD, version: 1, nodes: [{ id: "start", type: "start", next: "end" }, { id: "end", type: "end" }], note: "v2" }, { snapshot: true });
mkdirSync(path3.join(root, ".dag-flow", "scripts", OLD), { recursive: true });
writeFileSync(path3.join(root, ".dag-flow", "scripts", OLD, "hello.py"), "print('hi')", "utf8");
await storage.writeWorkflow(NEW, { name: NEW, version: 1, nodes: [{ id: "start", type: "start", next: "end" }, { id: "end", type: "end" }] }, { snapshot: false, renameFrom: OLD });
var fail = 0;
var t = (cond, msg) => {
  console.log((cond ? "  \u2713 " : "  \u2717 ") + msg);
  if (!cond) fail++;
};
var dag = path3.join(root, ".dag-flow");
t(!existsSync(path3.join(dag, "workflow", `${OLD}.json`)), "\u65E7 <\u65E7\u540D>.json \u5DF2\u5220\u9664");
t(existsSync(path3.join(dag, "workflow", `${NEW}.json`)), "\u65B0 <\u65B0\u540D>.json \u5DF2\u5199\u5165");
t(existsSync(path3.join(dag, "scripts", NEW, "hello.py")), "scripts/<\u65B0\u540D>/hello.py \u5DF2\u642C\u79FB");
t(!existsSync(path3.join(dag, "scripts", OLD)), "scripts/<\u65E7\u540D>/ \u5DF2\u4E0D\u5B58\u5728");
t(existsSync(path3.join(dag, "workflow", "versions", NEW)) && readdirSync(path3.join(dag, "workflow", "versions", NEW)).length >= 1, "versions/<\u65B0\u540D>/ \u5386\u53F2\u5DF2\u642C\u79FB");
t(!existsSync(path3.join(dag, "workflow", "versions", OLD)), "versions/<\u65E7\u540D>/ \u5DF2\u4E0D\u5B58\u5728");
var readBack = await storage.readWorkflow(NEW);
t(readBack?.name === NEW, "\u65B0\u540D\u53EF\u8BFB\u56DE\uFF08name=" + readBack?.name + "\uFF09");
console.log(fail ? `RENAME SMOKE: ${fail} failed` : "RENAME SMOKE: all passed");
process.exit(fail ? 2 : 0);
