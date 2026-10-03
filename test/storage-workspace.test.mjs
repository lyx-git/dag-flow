// test/storage-workspace.test.mjs — 存储根经 workspaceRegistry 锚定到 <当前工作区>（2026-10-01）
// 用 esbuild 即时打包一个测试入口（同时 re-export storage 与 safety，保证二者共享同一份
// 模块态——storage 内嵌的 safety 必须和 initSafety 写入的是同一个实例）→ 临时 mjs → 断言。
import { build } from 'esbuild';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const ROOT = process.cwd();
const wsA = mkdtempSync(join(tmpdir(), 'dsh-ws-a-'));
const wsB = mkdtempSync(join(tmpdir(), 'dsh-ws-b-'));

const ENTRY = join(mkdtempSync(join(tmpdir(), 'dsh-ws-entry-')), 'entry.ts');
writeFileSync(ENTRY, [
  `export { createStorage, resolveStorageRoot } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  `export { initSafety } from ${JSON.stringify(join(ROOT, 'src/adapter/safety.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));

async function bundleWith(injectHost) {
  const outDir = mkdtempSync(join(tmpdir(), 'dsh-ws-bundle-'));
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

// —— 场景 1：单一工作区 → 锚定 <ws>/.dag-flow/workflow ——
{
  const registry = {
    list: async () => [{ id: 'w1', path: wsA, title: 'A', updatedAt: '2026-10-01T00:00:00Z' }],
  };
  const api = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
  const info = await api.resolveStorageRoot();
  t('单一工作区 → <ws>/.dag-flow/workflow', info.dir === join(wsA, '.dag-flow', 'workflow'), JSON.stringify(info));
  t('来源标记 workspace-registry', info.source === 'workspace-registry', info.source);
  t('目录已创建', existsSync(info.dir));

  const storage = api.createStorage();
  await storage.writeWorkflow('落地验证', { name: '落地验证', version: 1, nodes: [] });
  t('写工作流落到工作区目录', existsSync(join(wsA, '.dag-flow', 'workflow', '落地验证.json')));
}

// —— 场景 2：多工作区 → 取 updatedAt 最新（最近使用）——
{
  const registry = {
    list: async () => [
      { id: 'w1', path: wsA, title: 'A', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'w2', path: wsB, title: 'B', updatedAt: '2026-10-01T12:00:00Z' },
    ],
  };
  const api = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
  const info = await api.resolveStorageRoot();
  t('多工作区 → 取 updatedAt 最新', info.dir === join(wsB, '.dag-flow', 'workflow'), JSON.stringify(info));
}

// —— 场景 3：无 workspaceRegistry 服务 → 回退 cwd（老解析链不回归）——
{
  const api = await bundleWith({ get: () => undefined });
  const info = await api.resolveStorageRoot();
  t('无 registry → 回退 process.cwd() 链', info.source === 'process-cwd' || info.source === 'user-dir-fallback', JSON.stringify(info));
}

// —— 场景 4：registry 候选路径都不存在 → 回退 cwd 链 ——
{
  const registry = {
    list: async () => [{ id: 'x', path: join(wsA, 'not-exist-sub'), title: 'X', updatedAt: '2026-10-01T00:00:00Z' }],
  };
  const api = await bundleWith({ get: (n) => (n === 'workspaceRegistry' ? registry : undefined) });
  const info = await api.resolveStorageRoot();
  t('候选不存在 → 回退 cwd 链', info.source === 'process-cwd' || info.source === 'user-dir-fallback', JSON.stringify(info));
}

console.log(`\n=== storage-workspace: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exit(1); }
