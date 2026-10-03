// tmp-test/smoke-rename-store.mjs — storage.writeWorkflow renameFrom 联动冒烟：
// 预置 <root>/.dag-flow/{workflow/<old>.json, versions/<old>/, scripts/<old>/} →
// writeWorkflow(new, def, {snapshot:false, renameFrom:old}) → 断言：
// 旧 json 删除、versions/<new> 存在（历史搬移）、scripts/<new> 存在（脚本搬移）。
// 用法：esbuild --format=esm 打包后 node 执行（自带 --temp-root 式隔离，见 chdir）。
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createStorage } from '../src/adapter/storage.js';

const root = path.join(tmpdir(), 'dag-flow-rename-smoke-' + Date.now());
mkdirSync(path.join(root, '.dag-flow', 'workflow'), { recursive: true });
process.chdir(root);

const OLD = '旧名工作流';
const NEW = '新名工作流';
const storage = createStorage();

// 预置旧态
await storage.writeWorkflow(OLD, { name: OLD, version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] }, { snapshot: true });
await storage.writeWorkflow(OLD, { name: OLD, version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }], note: 'v2' }, { snapshot: true });
mkdirSync(path.join(root, '.dag-flow', 'scripts', OLD), { recursive: true });
writeFileSync(path.join(root, '.dag-flow', 'scripts', OLD, 'hello.py'), "print('hi')", 'utf8');

// 重命名保存
await storage.writeWorkflow(NEW, { name: NEW, version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] }, { snapshot: false, renameFrom: OLD });

let fail = 0;
const t = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const dag = path.join(root, '.dag-flow');
t(!existsSync(path.join(dag, 'workflow', `${OLD}.json`)), '旧 <旧名>.json 已删除');
t(existsSync(path.join(dag, 'workflow', `${NEW}.json`)), '新 <新名>.json 已写入');
t(existsSync(path.join(dag, 'scripts', NEW, 'hello.py')), 'scripts/<新名>/hello.py 已搬移');
t(!existsSync(path.join(dag, 'scripts', OLD)), 'scripts/<旧名>/ 已不存在');
t(existsSync(path.join(dag, 'workflow', 'versions', NEW)) && readdirSync(path.join(dag, 'workflow', 'versions', NEW)).length >= 1, 'versions/<新名>/ 历史已搬移');
t(!existsSync(path.join(dag, 'workflow', 'versions', OLD)), 'versions/<旧名>/ 已不存在');
const readBack = await storage.readWorkflow(NEW);
t(readBack?.name === NEW, '新名可读回（name=' + readBack?.name + '）');
console.log(fail ? `RENAME SMOKE: ${fail} failed` : 'RENAME SMOKE: all passed');
process.exit(fail ? 2 : 0);
