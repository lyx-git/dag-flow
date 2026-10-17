// test/storage-workspace.test.mjs — 存储根契约（2026-10-11 存储锚点变更后）
//
// 用户拍板（原话）：「dag-flow 创建的文件，不依赖于 dsh 的工作区，默认放在 <DSH_HOME>\.dag-flow
//   文件夹下，避免工作区没选择的问题」。据此本文件锁三条契约：
//   ① 根**固定** <DSH_HOME>/.dag-flow/workflow，source = 'dsh-home'；
//      不再看 host-ctx / workspaceRegistry / process.cwd（旧三级解析链已从解析路径移除，
//      这三个探测函数只作为**迁移来源探测**保留）。
//   ② 迁移是一次性、**只复制不移动**、**绝不覆盖新根已有文件**：
//      · <旧工作区>/.dag-flow/ 的 workflow/ + runs/ + schedules.json → 新根，标记 .migrated-from-workspace
//      · 更早的兜底 ~/.dsh/workflows（= <DSH_HOME>/workflows）→ 新根，标记 .fallback-migrated
//      · 没有任何旧目录可迁时**不写标记**（将来工作区出现还能再迁一次）
//   ③ 用户已删掉的文件不许在下次启动被复活（2026-10-04 教训，两个标记都要锁）。
//
// 手段：esbuild 即时打包 storage.ts+safety.ts（保证共享同一份模块态）→ 每次打包都是**全新模块
//   实例** = 等价于"宿主再启动一次"，这正是能测迁移一次性行为的关键。
//   ★ DSH_HOME 必须在 import bundle **之前**设好：storage.ts 模块级就读 dshHome()（USER_DIR）。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const ROOT = process.cwd();
const ENTRY = join(tmpRoot('dsh-ws-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { createStorage, resolveStorageRoot } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  `export { initSafety } from ${JSON.stringify(join(ROOT, 'src/adapter/safety.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));

// ★ 2026-10-16 规范整改：bundle 产物落**项目内** `tmp-test/build/storage-ws/`（原落系统 TEMP，
//   每次往 TEMP 丢 dsh-ws-bundle-*）。每次用**新子目录**：ESM 按路径缓存模块，复用同一路径会让
//   第二次 initSafety 拿到旧实例。运行开始先整目录清空 ⇒ 不跨次累积。
const BUNDLE_ROOT = join(ROOT, 'tmp-test', 'build', 'storage-ws');
rmSync(BUNDLE_ROOT, { recursive: true, force: true });

let bundleSeq = 0;
async function bundleWith(injectHost) {
  const outDir = join(BUNDLE_ROOT, String(++bundleSeq));
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: join(outDir, 'storage.bundle.mjs'),
    external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(join(outDir, 'storage.bundle.mjs')).href);
  mod.initSafety(injectHost);
  return { createStorage: mod.createStorage, resolveStorageRoot: mod.resolveStorageRoot };
}

const wfDirOf = (home) => join(home, '.dag-flow', 'workflow');
const writeJson = (p, obj) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); };
const withHome = (home) => {
  const saved = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  return () => { if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved; };
};

// —— 场景 ①：根固定 <DSH_HOME>/.dag-flow，**与工作区无关**（核心契约）——
{
  const home = tmpRoot('dsh-home-a-');
  const wsA = tmpRoot('dsh-ws-a-');
  const restore = withHome(home);
  try {
    const registry = { list: async () => [{ id: 'w1', path: wsA, title: 'A', updatedAt: '2026-10-01T00:00:00Z' }] };
    const api = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
    const info = await api.resolveStorageRoot();
    t('① 根固定 <DSH_HOME>/.dag-flow/workflow', info.dir === wfDirOf(home), JSON.stringify(info));
    t('① 来源标记 dsh-home', info.source === 'dsh-home', info.source);
    t('① 目录已创建', existsSync(info.dir));
    t('① ★即使宿主任一工作区存在，也不落到 <工作区>/.dag-flow', info.dir !== join(wsA, '.dag-flow', 'workflow'));

    const storage = api.createStorage();
    await storage.writeWorkflow('落地验证', { name: '落地验证', version: 1, nodes: [] });
    t('① 写工作流落到 <DSH_HOME>/.dag-flow/workflow', existsSync(join(wfDirOf(home), '落地验证.json')));
  } finally { restore(); }
}

// —— 场景 ②：没有 workspaceRegistry、cwd 也不是工作区 → 不再回退 cwd（老解析链不回归）——
{
  const home = tmpRoot('dsh-home-b-');
  const cwdDir = tmpRoot('dsh-cwd-b-');
  const oldCwd = process.cwd();
  const restore = withHome(home);
  process.chdir(cwdDir);
  try {
    const api = await bundleWith({ get: () => undefined });
    const info = await api.resolveStorageRoot();
    t('② 无 registry / cwd 非工作区 → 仍是 <DSH_HOME>/.dag-flow，不回退 process-cwd',
      info.dir === wfDirOf(home) && info.source === 'dsh-home', JSON.stringify(info));
  } finally { process.chdir(oldCwd); restore(); }
}

// —— 场景 ③④：工作区时代目录 → 一次性**补缺复制**（不移动、不覆盖、不复活）——
{
  const home = tmpRoot('dsh-home-c-');
  const wsA = tmpRoot('dsh-ws-c-');
  const oldHome = join(wsA, '.dag-flow');
  const oldWf = join(oldHome, 'workflow');
  const oldRuns = join(oldHome, 'runs');
  writeJson(join(oldWf, 'ws-wf.json'), { name: 'ws-wf', version: 1, nodes: [] });
  writeJson(join(oldWf, 'ws-other.json'), { name: 'ws-other', version: 1, nodes: [] });
  writeJson(join(oldWf, 'versions', 'ws-wf', 'v1.json'), { name: 'ws-wf', version: 1, nodes: [] });
  writeJson(join(oldRuns, 'run-001.json'), { runId: 'run-001', status: 'ok' });
  // 旧工作区定时配置（真 schema：{version, items[]}）——含一条新根没有的、一条两边同 id 的
  writeJson(join(oldHome, 'schedules.json'), {
    version: 1,
    items: [
      { id: 'sch_old', workflow: 'ws-wf', cron: '0 6 * * *' },
      { id: 'sch_both', workflow: 'legacy-name', cron: '0 7 * * *' },
    ],
  });

  // 新根预置一个**同名但内容不同**的文件：补缺复制必须跳过它，不许覆盖用户在新根的工作
  const newWf = wfDirOf(home);
  writeJson(join(newWf, 'ws-wf.json'), { name: 'ws-wf', version: 99, nodes: [{ id: 'newer' }] });
  // 新根也已有一份定时配置（模拟"此前迁过一半/用户在新根建过定时项"）：
  //   sch_mine 只在新根 → 必须保留；sch_both 两边同 id → **以新根为准**，不许被旧位置回退。
  writeJson(join(home, '.dag-flow', 'schedules.json'), {
    version: 1,
    items: [
      { id: 'sch_mine', workflow: '落地验证', cron: '* * * * *' },
      { id: 'sch_both', workflow: 'mine-name', cron: '0 9 * * *' },
    ],
  });

  const restore = withHome(home);
  try {
    const registry = { list: async () => [{ id: 'c', path: wsA, title: 'C', updatedAt: '2026-10-01T00:00:00Z' }] };
    const api = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
    const info = await api.resolveStorageRoot();
    t('③ 旧工作区 workflow/ 的缺失文件被补齐', existsSync(join(newWf, 'ws-other.json')), info.dir);
    t('③ 旧工作区 runs/ 被复制进新根', existsSync(join(home, '.dag-flow', 'runs', 'run-001.json')));
    // 定时配置：按 id 合并（早先实现"目标存在就整体跳过"会静默丢掉用户真实的定时任务）
    let sch = null;
    try { sch = JSON.parse(readFileSync(join(home, '.dag-flow', 'schedules.json'), 'utf8')); } catch { /* 见下断言 */ }
    const schItems = Array.isArray(sch?.items) ? sch.items : [];
    const byId = (id) => schItems.find((it) => it?.id === id);
    t('③ 旧位置定时配置按 id 合并进新根（不再整体跳过）', !!byId('sch_old'), JSON.stringify(schItems.map((i) => i?.id)));
    t('③ 新根原有的定时项全部保留（sch_mine 不被清掉）', !!byId('sch_mine'));
    t('③ ★同 id 冲突以新根为准（sch_both 仍是 mine-name，不回退用户改过的值）', byId('sch_both')?.workflow === 'mine-name', String(byId('sch_both')?.workflow));
    t('③ 合并没留下 .tmp 半成品', !existsSync(join(home, '.dag-flow', 'schedules.json.tmp')));
    t('③ 旧工作区 versions/ 版本历史被复制', existsSync(join(newWf, 'versions', 'ws-wf', 'v1.json')));
    t('③ 一次性标记已写（新位置 .migrations/workspace.json）', existsSync(join(home, '.dag-flow', '.migrations', 'workspace.json')));
    let newer = null;
    try { newer = JSON.parse(readFileSync(join(newWf, 'ws-wf.json'), 'utf8')); } catch { /* 见下断言 */ }
    t('③ ★新根已有的同名文件不被覆盖（version 仍是 99）', newer?.version === 99, String(newer?.version));
    t('③ ★只复制不移动：旧工作区文件全部仍在',
      existsSync(join(oldWf, 'ws-wf.json')) && existsSync(join(oldWf, 'ws-other.json'))
      && existsSync(join(oldRuns, 'run-001.json')) && existsSync(join(oldHome, 'schedules.json')));

    // ④ 模拟用户在新根删掉 ws-other.json，同时旧工作区又冒出一个 ws-late.json →
    //    二次启动（全新模块实例）必须整体跳过，既不复活也不补迁。
    rmSync(join(newWf, 'ws-other.json'));
    writeJson(join(oldWf, 'ws-late.json'), { name: 'ws-late', version: 1, nodes: [] });
    const api2 = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
    await api2.resolveStorageRoot();
    t('④ ★二次启动：用户删掉的 ws-other.json 不会复活', !existsSync(join(newWf, 'ws-other.json')));
    t('④ 二次启动：旧工作区新增的 ws-late.json 也不补迁（标记生效）', !existsSync(join(newWf, 'ws-late.json')));
    t('④ 二次启动：已迁入且未删的 run-001.json 仍在（迁移没有反向删除）',
      existsSync(join(home, '.dag-flow', 'runs', 'run-001.json')));
  } finally { restore(); }
}

// —— 场景 ⑤：更早的兜底 <DSH_HOME>/workflows 仍能迁入，且仍是一次性（2026-10-04 复活 bug 回归锁）——
//   背景：旧实现只判"目标文件不存在就复制"，而源目录 ~/.dsh/workflows 永久保留原文件、迁移又每次
//   宿主启动都跑 ⇒ 用户删掉的工作流会在下次启动被原样复制回来（实测：test.json/测试.json）。
{
  const home = tmpRoot('dsh-home-d-');
  const legacy = join(home, 'workflows');
  writeJson(join(legacy, 'legacy-a.json'), { name: 'legacy-a', version: 1, nodes: [] });
  writeJson(join(legacy, 'legacy-b.json'), { name: 'legacy-b', version: 1, nodes: [] });
  const restore = withHome(home);
  try {
    const wfDir = wfDirOf(home);
    const api1 = await bundleWith({ get: () => undefined });
    const info1 = await api1.resolveStorageRoot();
    t('⑤ 首次启动：兜底工作流 legacy-a 被迁入', existsSync(join(wfDir, 'legacy-a.json')), info1.dir);
    t('⑤ 首次启动：兜底工作流 legacy-b 被迁入', existsSync(join(wfDir, 'legacy-b.json')));
    t('⑤ 首次启动后写入一次性标记（新位置 .migrations/fallback.json）', existsSync(join(home, '.dag-flow', '.migrations', 'fallback.json')));

    rmSync(join(wfDir, 'legacy-a.json'));
    writeJson(join(legacy, 'legacy-c.json'), { name: 'legacy-c', version: 1, nodes: [] });

    const api2 = await bundleWith({ get: () => undefined });
    await api2.resolveStorageRoot();
    t('⑤ ★二次启动：用户删掉的 legacy-a 不会被复活', !existsSync(join(wfDir, 'legacy-a.json')));
    t('⑤ 二次启动：兜底目录里的新文件 legacy-c 也不会被补迁（标记生效）', !existsSync(join(wfDir, 'legacy-c.json')));
    t('⑤ 二次启动：已迁入且未被删的 legacy-b 仍在', existsSync(join(wfDir, 'legacy-b.json')));
  } finally { restore(); }
}

// —— 场景 ⑥：旧标记兼容（2026-10-19 标记搬到 .migrations/ 的回归锁）——
//   背景：标记从 `workflow/.fallback-migrated` 搬到 `.migrations/fallback.json`。
//   老用户机器上标记还躺在旧位置 ⇒ 新位置读不到 ⇒ 会被判"从未迁移" ⇒ 重跑补缺复制
//   ⇒ 已删的工作流复活（就是 10-04 那条 bug 的另一条通道）。
//   锁三件事：①旧标记被搬到新位置；②旧位置不再残留；③这一轮**绝不复制**兜底目录里的文件。
{
  const home = tmpRoot('dsh-home-e-');
  const legacy = join(home, 'workflows');
  writeJson(join(legacy, 'old-a.json'), { name: 'old-a', version: 1, nodes: [] });
  const oldMarkerDir = join(home, '.dag-flow', 'workflow');
  mkdirSync(oldMarkerDir, { recursive: true });
  writeFileSync(
    join(oldMarkerDir, '.fallback-migrated'),
    JSON.stringify({ migratedAt: '2026-10-04T00:00:00.000Z', from: legacy, files: 2 }) + '\n',
    'utf8',
  );
  const restore = withHome(home);
  try {
    const wfDir = wfDirOf(home);
    const api = await bundleWith({ get: () => undefined });
    await api.resolveStorageRoot();
    t('⑥ ★旧位置的标记被搬到 .migrations/fallback.json',
      existsSync(join(home, '.dag-flow', '.migrations', 'fallback.json')));
    t('⑥ 旧位置标记已移走（不再躺在 workflow/ 里）',
      !existsSync(join(wfDir, '.fallback-migrated')));
    t('⑥ ★★有旧标记 ⇒ 绝不重跑补缺复制（否则已删工作流会复活）',
      !existsSync(join(wfDir, 'old-a.json')));
  } finally { restore(); }
}

console.log(`\n=== storage-workspace: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exit(1); }
