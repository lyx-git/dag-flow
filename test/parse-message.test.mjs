// test/parse-message.test.mjs — 校验错误消息的中文映射（2026-10-16）
//   为什么需要它：ajv 的消息里 `required` 用**单引号**、`pattern` 用**双引号**，
//   而两份映射表（host `executor/parse.ts` + client `JsonView.tsx`）最初只写了单引号正则
//   ⇒ `pattern` 那句一直漏译。真机实证（2026-10-16 日志）：
//     `节点 Python_q8do_153823(python) 的 id must match pattern "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"`
//   —— 前半中文、后半英文原文，用户看不出「id 该长什么样」。
//   本文件走**端到端**（真 ajv + 真 parseAndValidate），不测内部函数，锁的是用户能看到的字符串。
//   手段：esbuild 即时打包 src/executor/parse.ts（ajv 走 external，运行时从 node_modules 解析）。
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };

const ROOT = join(import.meta.dirname, '..');
/** ★ 产物必须落在**项目内**（不能用系统 TEMP）：本测试把 ajv 标成 external，
 *  从 TEMP 解析 `import 'ajv'` 会 ERR_MODULE_NOT_FOUND（本轮第一版就这么翻的车）。
 *  路径基于本文件位置而非 cwd ⇒ 从任何目录跑结果一致。 */
const dir = join(ROOT, 'tmp-test', 'build', 'parsemsg');
mkdirSync(dir, { recursive: true });
const OUT = join(dir, 'parse.mjs');
await build({
  entryPoints: ['src/executor/parse.ts'], bundle: true, format: 'esm', platform: 'node',
  outfile: OUT, logLevel: 'silent', external: ['ajv'],
});
const { parseAndValidate } = await import(pathToFileURL(OUT).href);

const base = (nodes, edges = []) => ({ name: 'w', version: 1, nodes, edges });

/** 跑一次校验，返回错误消息（不抛时返回 null） */
const messageOf = (def) => {
  try { parseAndValidate(def); return null; } catch (e) { return String(e?.message ?? e); }
};

console.log('== A. `pattern` 违规必须译成中文（本次修的漏译）==');
{
  // ajv 对 pattern 的消息是**双引号**包裹：must match pattern "<re>"
  const msg = messageOf(base([
    { id: '123abc', type: 'start', params: {} },
    { id: 'end', type: 'end', params: {} },
  ], [{ from: '123abc', to: 'end' }]));
  ok(!!msg, 'A1. 数字开头的节点 id 被拦下（阳性对照）');
  ok(!!msg && msg.includes('必须匹配格式'), `A2. ★消息含中文「必须匹配格式」（实测：${msg}）`);
  ok(!!msg && !msg.includes('must match pattern'), 'A3. ★不再残留英文原文 `must match pattern`（修之前这里会残留）');
  ok(!!msg && msg.includes('[a-zA-Z]'), 'A4. 仍然回显 schema 里的正则（用户要知道该长什么样）');
}

console.log('== B. `required` 映射不能被改坏（单引号形态回归锁）==');
{
  const msg = messageOf(base([
    { type: 'start', params: {} },              // 缺 id
    { id: 'end', type: 'end', params: {} },
  ]));
  ok(!!msg && msg.includes('缺少必填字段'), `B1. 仍译成「缺少必填字段」（实测：${msg}）`);
  ok(!!msg && !msg.includes('must have required property'), 'B2. 不残留英文 required 原文');
}

console.log('== C. 合法工作流不误报（修映射不能把校验本身弄坏）==');
{
  const msg = messageOf(base([
    { id: 'start', type: 'start', params: {} },
    { id: 'end', type: 'end', params: {} },
  ], [{ from: 'start', to: 'end' }]));
  ok(msg === null, `C1. ★最小合法工作流（start→end）通过（实测：${msg ?? '未抛'}）`);

  const msg2 = messageOf(base([
    { id: 'start', type: 'start', params: {} },
    { id: 'py_1', type: 'python', params: { code: '' } },
    { id: 'end', type: 'end', params: {} },
  ], [{ from: 'start', to: 'py_1' }, { from: 'py_1', to: 'end' }]));
  ok(msg2 === null, `C2. 新建节点风格的 id（py_1，字母开头）通过（实测：${msg2 ?? '未抛'}）`);
}

console.log('== D. 映射只有唯一源（2026-10-16 规范整改：两份副本 → 共用 src/ajv-zh.ts）==');
{
  const hostSrc = readFileSync(join(ROOT, 'src/executor/parse.ts'), 'utf8');
  const clientSrc = readFileSync(join(ROOT, 'src/client/JsonView.tsx'), 'utf8');
  const sharedSrc = readFileSync(join(ROOT, 'src/ajv-zh.ts'), 'utf8');
  ok(hostSrc.includes("from '../ajv-zh.js'"), 'D1. host parse.ts 从唯一源 import');
  ok(clientSrc.includes("from '../ajv-zh'"), 'D2. client JsonView.tsx 从唯一源 import');
  ok(!hostSrc.includes('must match pattern'), 'D3. host 不再自带映射表副本（回退到两份 = 本闸门变红）');
  ok(!clientSrc.includes('must match pattern'), 'D4. client 不再自带映射表副本');
  ok(sharedSrc.includes('must match pattern'), 'D5. 唯一源里确实有 pattern 映射（阳性对照：D3/D4 不是因为谁都没有）');
  ok(sharedSrc.split('[/must').length - 1 >= 13, `D6. 唯一源条目数 ≥13（当前 ${sharedSrc.split('[/must').length - 1} 条，别悄悄删条目）`);
}

console.log(`\n=== 校验消息中文映射：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
