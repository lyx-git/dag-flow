import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/storage-json.test.mjs — 存储层端到端验证：工作区 JSON 文件（无 SQLite）
// 用 esbuild 即时打包 src/adapter/storage.ts → 临时 mjs → 跑断言
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 让 storage 的 process.cwd() 解析链落到临时目录（模拟"从工作区启动"）
const ROOT = process.cwd(); // 插件根目录（chdir 前先记下，入口路径要用）
const fakeWorkspace = tmpRoot('dsh-wf-test-');
process.chdir(fakeWorkspace);

const OUT = join(fakeWorkspace, 'storage.test.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/storage.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
  logLevel: 'silent',
});

const { createStorage } = await import(pathToFileURL(OUT).href);
const storage = createStorage();

const info = await storage.describe();
console.log('[1] storage dir =', info.dir, '(source:', info.source + ')');
if (!info.dir.includes(join('.dag-flow', 'workflow'))) throw new Error('dir should contain .dag-flow/workflow');
if (!existsSync(info.dir)) throw new Error('dir should exist');

// 写 → 读 → 列
await storage.writeWorkflow('demo-flow', {
  name: 'demo-flow', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'end' },
    { id: 'end', type: 'end' },
  ],
});
const back = await storage.readWorkflow('demo-flow');
console.log('[2] readWorkflow roundtrip =', back?.nodes?.length === 2 ? 'OK' : 'FAIL');
if (back?.nodes?.length !== 2) throw new Error('roundtrip failed');

// 磁盘上必须是可读 JSON
const raw = JSON.parse(readFileSync(join(info.dir, 'demo-flow.json'), 'utf8'));
console.log('[3] raw JSON on disk:', raw.name, '| pretty-printed:', raw.nodes ? 'yes' : 'no');

const list = await storage.listWorkflows();
console.log('[4] listWorkflows =', JSON.stringify(list));
if (!list.includes('demo-flow')) throw new Error('list should contain demo-flow');

// 运行记录
await storage.writeRunRecord('run-abc-1', { workflowName: 'demo-flow', status: 'success' });
const recs = await storage.listRunRecords('demo-flow');
const rec = await storage.readRunRecord('run-abc-1');
console.log('[5] runs:', JSON.stringify(recs), '| read:', rec?.status);
if (recs[0] !== 'run-abc-1' || rec?.status !== 'success') throw new Error('runs failed');

// 非法名拒绝
let rejected = false;
try { await storage.writeWorkflow('BAD NAME!', { name: 'BAD NAME!' }); } catch { rejected = true; }
console.log('[6] invalid name rejected:', rejected);
if (!rejected) throw new Error('invalid name should be rejected');

// 中文名（2026-10-01 起合法：src/name-rule.ts）
await storage.writeWorkflow('每日简报', { name: '每日简报', version: 1, nodes: [] });
const cn = await storage.readWorkflow('每日简报');
console.log('[7] chinese name roundtrip:', cn?.name);
if (cn?.name !== '每日简报') throw new Error('chinese name roundtrip failed');

// ===== [8] ★ 2026-10-19 用户要求：每个工作流产生的文件按工作流名分目录 + 删除时级联清理 =====
//   用户原话：「dag-flow插件每个工作流产生的文件都要以 .dag-flow/**/工作流名称/文件 的方式存放，
//   如果文件夹不存在，dag-flow需要自动创建；然后删除工作流的时候，也要以这种方式，清理对应工作流的
//   所有文件和文件夹」。
import { mkdirSync, writeFileSync } from 'node:fs';
{
  const root = resolve(info.dir, '..');           // <DSH_HOME>/.dag-flow
  const wf = 'demo-flow';
  // ① 运行记录落在 runs/<工作流名>/ 下
  const runInOwnDir = existsSync(join(root, 'runs', wf, 'run-abc-1.json'));
  console.log('[8a] 运行记录落在 runs/<工作流名>/ =', runInOwnDir);
  if (!runInOwnDir) throw new Error(`期望 runs/${wf}/run-abc-1.json 存在`);

  // ② 造齐该工作流的各类专属目录（模拟它跑过：代码 / 抽图 / 中间产物 / 版本）
  for (const rel of [join('scripts', wf), join('images', wf), join('tmp', wf), join('workflow', 'versions', wf)]) {
    mkdirSync(join(root, rel), { recursive: true });
    writeFileSync(join(root, rel, 'keep.bin'), 'x');
  }
  // ③ 删掉工作流 → 所有专属目录都要跟着消失
  await storage.deleteWorkflow(wf);
  const leftovers = [
    join(info.dir, `${wf}.json`),
    join(root, 'scripts', wf), join(root, 'images', wf), join(root, 'tmp', wf),
    join(root, 'runs', wf), join(root, 'workflow', 'versions', wf),
  ].filter((p) => existsSync(p));
  console.log('[8b] 删除后残留 =', JSON.stringify(leftovers));
  if (leftovers.length > 0) throw new Error(`删除工作流后仍有残留：${leftovers.join(', ')}`);

  // ④ 别人的东西不能被误删（同级的其它工作流目录仍在）
  mkdirSync(join(root, 'images', '每日简报'), { recursive: true });
  writeFileSync(join(root, 'images', '每日简报', 'other.png'), 'x');
  await storage.writeWorkflow(wf, { name: wf, version: 1, nodes: [] });
  await storage.deleteWorkflow(wf);
  const keptOther = existsSync(join(root, 'images', '每日简报', 'other.png'));
  console.log('[8c] 其它工作流的目录未被误删 =', keptOther);
  if (!keptOther) throw new Error('删除 demo-flow 时误删了「每日简报」的图片目录');
}

// ===== [9] ★ 2026-10-19 用户要求：工作流名称变动时，涉及工作流名称的路径同步变更 =====
//   原话：「工作流如果没名称，禁止运行和自动保存、手动保存；如果工作流名称发生变动，
//   涉及工作流名称的路径也要同步变更」。
//   改名前只搬 versions/ 与 scripts/，按工作流分目录后新增的 runs/images/tmp 全漏了 —— 这条锁住全部 5 个。
{
  const root = resolve(info.dir, '..');
  const OLD = '改名前的流程';
  const NEW = '改名后的流程';
  await storage.writeWorkflow(OLD, { name: OLD, version: 1, nodes: [] });
  const kinds = [
    join('workflow', 'versions', OLD),
    join('scripts', OLD), join('runs', OLD), join('images', OLD), join('tmp', OLD),
  ];
  for (const rel of kinds) {
    mkdirSync(join(root, rel), { recursive: true });
    writeFileSync(join(root, rel, 'payload.txt'), 'x');
  }
  // 带 renameFrom 保存 = 界面改名的真实路径
  await storage.writeWorkflow(NEW, { name: NEW, version: 1, nodes: [] }, { renameFrom: OLD });

  const expectNew = kinds.map((rel) => rel.replace(OLD, NEW));
  const missNew = expectNew.filter((rel) => !existsSync(join(root, rel, 'payload.txt')));
  const remainOld = kinds.filter((rel) => existsSync(join(root, rel)));
  console.log('[9a] 改名后新目录齐备 =', missNew.length === 0, '| 残留旧目录 =', JSON.stringify(remainOld));
  if (missNew.length > 0) throw new Error(`改名后这些目录/文件没跟过来：${missNew.join(', ')}`);
  if (remainOld.length > 0) throw new Error(`改名后仍有旧名字的目录残留：${remainOld.join(', ')}`);
  const oldJsonGone = !existsSync(join(info.dir, `${OLD}.json`));
  const newJsonThere = existsSync(join(info.dir, `${NEW}.json`));
  console.log('[9b] 定义文件跟着改名 =', oldJsonGone && newJsonThere);
  if (!oldJsonGone || !newJsonThere) throw new Error('改名后定义 json 不对');
}

// ===== [10] ★ 2026-10-19 用户拍板 A：改名撞名**绝不覆盖**（服务端硬拦） =====
//   旧行为：改名到已存在的名字 ⇒ 直接覆盖对方定义，且目录合并，两边数据混在一起。
{
  const A = '撞名前';
  const B = '撞名后';
  await storage.writeWorkflow(A, { name: A, version: 1, nodes: [] });
  await storage.writeWorkflow(B, { name: B, version: 7, nodes: [{ id: 'b-only', type: 'log' }] });

  let rejected = '';
  try {
    await storage.writeWorkflow(B, { name: B, version: 99, nodes: [] }, { renameFrom: A });
  } catch (e) { rejected = String(e && e.message ? e.message : e); }
  console.log('[10a] 改名撞名被拒 =', !!rejected, '|', rejected.slice(0, 40));
  if (!rejected.includes('已存在')) throw new Error('改名撞名应当被拒绝');

  // 对方那份**一个字都没被动**（version 仍是 7、节点仍是它自己的）
  const bNow = await storage.readWorkflow(B);
  const intact = bNow?.version === 7 && (bNow?.nodes ?? []).some((n) => n.id === 'b-only');
  console.log('[10b] 对方工作流未被覆盖 =', intact, `(version=${bNow?.version})`);
  if (!intact) throw new Error('撞名时对方工作流被覆盖了');
  // 改名方也还在（拒绝＝整次改名都没发生）
  const aStill = await storage.readWorkflow(A);
  console.log('[10c] 改名方仍在原位 =', !!aStill);
  if (!aStill) throw new Error('撞名被拒后改名方丢了');
}

console.log('\n✅ storage JSON 端到端全部通过');
