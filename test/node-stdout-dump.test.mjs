// test/node-stdout-dump.test.mjs — python/bash 节点的 stdout/stderr 落本次运行目录（2026-10-18 用户选「全部落盘」）
//
// 契约：脚本节点跑完后，引擎把 stdout / stderr 各写一份到 `<runDir>/nodes/<节点id>.out|.err`；
//   · 成功、失败（含超时/退出码非零）都要落 —— 靠 settle() 统一出口保证；
//   · runDir 没注入（本地直跑）时**不落**，也不报错；
//   · 落盘失败绝不影响节点结果（fire-and-forget）。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}

const ROOT = process.cwd();
const HOME = tmpRoot('node-dump-');
process.env.DSH_HOME = HOME;

const ENTRY = join(tmpRoot('node-dump-entry-'), 'entry.ts');
const { writeFileSync } = await import('node:fs');
writeFileSync(ENTRY, [
  `export { pythonDef, bashDef } from ${JSON.stringify(join(ROOT, 'src/registry/nodes/script.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
// ★ bundle 必须放在「上两级 = 仓库根」的位置：runtime.ts 用 `['..','../..']` 相对 __dirname
//   找插件根（<根>/runtime、<根>/scripts/download-runtime.mjs），bundle 目录太深就会报 RUNTIME_DOWNLOAD_FAILED。
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'node-dump.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: BUNDLE,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite', 'node:child_process', 'node:async_hooks'],
  logLevel: 'silent',
});
const { pythonDef, bashDef } = await import(pathToFileURL(BUNDLE).href);
const mkCtx = (runDir, id) => ({ inputs: {}, vars: {}, results: {}, currentNodeId: id, runDir });

console.log('\n== ① python 成功：stdout 落 <runDir>/nodes/<id>.out ==');
{
  const runDir = join(HOME, 'run-ok');
  mkdirSync(runDir, { recursive: true });   // ★ 真实场景由 runDag 建目录；测试里要自己建，否则 spawn 的 cwd 不存在会报 ENOENT
  const r = await pythonDef.run(mkCtx(runDir, 'py1'), { code: 'print("你好-world")' });
  t('节点 status = success', r.status === 'success', JSON.stringify(r.error ?? null));
  t('out 仍是 stdout 原文', String(r.out ?? '').includes('你好-world'), String(r.out ?? '').slice(0, 80));
  const f = join(runDir, 'nodes', 'py1.out');
  t('.out 文件已落盘', existsSync(f), f);
  t('.out 内容与 out 一致', existsSync(f) && readFileSync(f, 'utf8').includes('你好-world'));
  t('没有 stderr 时不留空 .err', !existsSync(join(runDir, 'nodes', 'py1.err')));
}

console.log('\n== ② python 失败（非零退出）：两个文件都落，节点结果不受影响 ==');
{
  const runDir = join(HOME, 'run-fail');
  mkdirSync(runDir, { recursive: true });
  const r = await pythonDef.run(mkCtx(runDir, 'py2'), { code: 'import sys\nprint("partial")\nsys.stderr.write("boom\\n")\nraise SystemExit(3)' });
  t('节点 status = failed（退出码非零）', r.status === 'failed', String(r.status));
  t('失败也落了 .out', existsSync(join(runDir, 'nodes', 'py2.out')));
  t('失败也落了 .err（含 boom）', existsSync(join(runDir, 'nodes', 'py2.err')) && readFileSync(join(runDir, 'nodes', 'py2.err'), 'utf8').includes('boom'));
}

console.log('\n== ③ bash 同样落盘 ==');
{
  const runDir = join(HOME, 'run-bash');
  mkdirSync(runDir, { recursive: true });
  const r = await bashDef.run(mkCtx(runDir, 'sh1'), { code: 'echo "bash-out"' });
  t('bash 节点 status = success', r.status === 'success', JSON.stringify(r.error ?? null).slice(0, 120));
  const f = join(runDir, 'nodes', 'sh1.out');
  t('bash .out 已落盘且含 bash-out', existsSync(f) && readFileSync(f, 'utf8').includes('bash-out'));
}

console.log('\n== ④ 没有 runDir（本地直跑）：不落盘、不报错 ==');
{
  const r = await pythonDef.run({ inputs: {}, vars: {}, results: {}, currentNodeId: 'py3' }, { code: 'print("ok")' });
  t('节点照常成功', r.status === 'success');
}

console.log(`\n=== node-stdout-dump: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
