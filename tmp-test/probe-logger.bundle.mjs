// src/adapter/logger.ts
import { appendFile } from "node:fs/promises";
import * as path4 from "node:path";

// src/dsh-gate/host.ts
var _host = null;
function getHost() {
  return _host;
}
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

// src/adapter/workspace.ts
import { promises as fs2 } from "node:fs";
import * as path3 from "node:path";

// src/adapter/storage.ts
import { promises as fs } from "node:fs";
import * as path2 from "node:path";
import * as os2 from "node:os";

// src/dsh-gate/paths.ts
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
async function resolveStorageRoot() {
  return resolveRoot();
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

// src/adapter/workspace.ts
async function dagFlowDir() {
  const info = await resolveStorageRoot();
  return path3.dirname(info.dir);
}
var ensured = null;
async function ensureDagFlowDirs() {
  if (!ensured) {
    ensured = (async () => {
      const root = await dagFlowDir();
      await fs2.mkdir(path3.join(root, "tmp"), { recursive: true });
      await fs2.mkdir(path3.join(root, "logs"), { recursive: true });
      await fs2.mkdir(path3.join(root, "scripts"), { recursive: true });
    })().catch(() => {
    });
  }
  return ensured;
}
async function dagFlowLogsDir() {
  await ensureDagFlowDirs();
  return path3.join(await dagFlowDir(), "logs");
}

// src/adapter/logger.ts
function consoleOut(level, msg, meta) {
  const tag = `[dag-flow]`;
  const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
  console[level](`${tag} ${line}`);
}
function todayLogPath() {
  const d = /* @__PURE__ */ new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `dag-flow-${y}-${m}-${day}.log`;
}
function cstStamp(d = /* @__PURE__ */ new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1e3);
  return t.toISOString().replace("T", " ").replace("Z", "");
}
function appendToLogFile(level, line) {
  const stamp = cstStamp();
  const text = `${stamp} [${level.toUpperCase()}] ${line}
`;
  void dagFlowLogsDir().then((dir) => appendFile(path4.join(dir, todayLogPath()), text, "utf8")).catch(() => {
  });
}
function createLogger() {
  const hostLogger = hostService("logger");
  const emit = (level, hostFn, msg, meta) => {
    const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
    appendToLogFile(level, line);
    if (!hostFn) {
      consoleOut(level, msg, meta);
      return;
    }
    try {
      hostFn.call(hostLogger, msg, meta);
    } catch (e) {
      consoleOut(level, `${msg} (logger call failed: ${e.message})`, meta);
    }
  };
  return {
    info(msg, meta) {
      emit("info", hostLogger?.info, msg, meta);
    },
    warn(msg, meta) {
      emit("warn", hostLogger?.warn, msg, meta);
    },
    error(msg, meta) {
      emit("error", hostLogger?.error, msg, meta);
    }
  };
}

// tmp-test/probe-logger.mjs
var logger = createLogger();
logger.info("\u65F6\u95F4\u6233\u683C\u5F0F\u9A8C\u8BC1\uFF08\u5E94\u4E3A\u4E1C\u516B\u533A YYYY-MM-DD HH:mm:ss.SSS\uFF09");
await new Promise((r) => setTimeout(r, 300));
console.log("probe done");
