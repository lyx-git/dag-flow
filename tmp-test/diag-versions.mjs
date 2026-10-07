// tmp-test/diag-versions.mjs — 复现「手动保存不再生成新版本」
//   用法：node tmp-test/diag-versions.mjs
//   直接打真实存储模块（esbuild 现场打包 src/adapter/storage.ts），不经过客户端/路由，
//   用来判定问题在「存储层」还是「客户端/路由层」。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ws = mkdtempSync(join(tmpdir(), 'df-ver-diag-'));
process.chdir(ws);

const OUT = join(ws, 'storage.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/storage.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
  logLevel: 'silent',
});
const { createStorage } = await import(pathToFileURL(OUT).href);
const storage = createStorage();

const mk = (extra) => ({
  name: 'ver-diag', version: 1,
  nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }, ...extra],
});

async function cnt(tag) {
  const list = await storage.listVersions('ver-diag');
  console.log(`  ${tag} → 版本数 = ${list.length}  [${list.map((v) => v.ts).join(', ')}]`);
  return list.length;
}

console.log('--- 场景 A：连续两次「内容不同」的保存（模拟改一次存一次）---');
await storage.writeWorkflow('ver-diag', mk([]), { snapshot: true });
const a1 = await cnt('第 1 次保存（snapshot:true）');
await storage.writeWorkflow('ver-diag', mk([{ id: 'log', type: 'log', params: { message: 'v2' } }]), { snapshot: true });
const a2 = await cnt('第 2 次保存（内容已变，snapshot:true）');

console.log('--- 场景 B：内容不变再存一次（应去重、不新增）---');
await storage.writeWorkflow('ver-diag', mk([{ id: 'log', type: 'log', params: { message: 'v2' } }]), { snapshot: true });
const b1 = await cnt('第 3 次保存（内容同第 2 次）');

console.log('--- 场景 C：snapshot:false（自动保存，不该产生版本）---');
await storage.writeWorkflow('ver-diag', mk([{ id: 'log', type: 'log', params: { message: 'v3' } }]), { snapshot: false });
const c1 = await cnt('第 4 次保存（snapshot:false）');

console.log('--- 场景 D：再手动保存（内容与最新版本不同 → 应 +1）---');
await storage.writeWorkflow('ver-diag', mk([{ id: 'log', type: 'log', params: { message: 'v4' } }]), { snapshot: true });
const d1 = await cnt('第 5 次保存（snapshot:true）');

console.log('');
console.log('判定：');
console.log('  A: 第1次=%d 第2次=%d → %s', a1, a2, a2 === a1 + 1 ? 'OK（第二次确实新增）' : '★ 异常：第二次没有新增版本');
console.log('  B: 去重后=%d → %s', b1, b1 === a2 ? 'OK（内容相同被正确去重）' : '★ 异常');
console.log('  C: snapshot:false 后=%d → %s', c1, c1 === b1 ? 'OK（自动保存不产版本）' : '★ 异常');
console.log('  D: 再手动保存后=%d → %s', d1, d1 === c1 + 1 ? 'OK（手动保存新增）' : '★ 异常：手动保存没新增版本');
