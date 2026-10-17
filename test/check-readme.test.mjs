// README 自校验（纯读，免提权；★2026-10-11 从 tmp-test/ 搬进 test/ 并挂进 test:offline 链尾）
//   ① 代码围栏配平（``` 成对、info string 非空）
//   ② 标题 slug + 正文锚点链接（](#xxx)）全部可解析
//   ③ 相对链接 / 配图文件真实存在且非空（相对路径一律按仓库根解析）
//   ④ 表格：表头列数 == 每行列数，且第 2 行是分隔行
//   ⑤ 过时事实回归锁：禁止再出现「工作区 = 数据根」的旧表述；两半区都必须写明 <DSH_HOME>/.dag-flow
// 用法：node test/check-readme.test.mjs [其它.md]（argv[2] 可选，供 A/B 反证：拿坏文件跑必须 exit 1）
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const README = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'README.md');

const text = readFileSync(README, 'utf8');
const lines = text.split(/\r?\n/);

const errs = [];
const warns = [];
const ok = [];

// ---------- ① 代码围栏 ----------
let inFence = false;
let fenceStart = 0;
let fenceLang = '';
let fenceCount = 0;
const fenced = new Set(); // 围栏内的行号（0-based），后三项检查跳过
for (let i = 0; i < lines.length; i++) {
  const m = /^\s*(```+|~~~+)\s*(\S*)\s*$/.exec(lines[i]);
  if (!m) { if (inFence) fenced.add(i); continue; }
  if (!inFence) {
    inFence = true; fenceStart = i + 1; fenceLang = m[2] ?? ''; fenceCount++;
    if (!fenceLang) warns.push(`L${i + 1} 围栏没有语言标注（可接受，但最好标上）`);
  } else {
    inFence = false;
    if (lines[i].trim() !== m[1].slice(0, 3)) warns.push(`L${i + 1} 收尾围栏与 L${fenceStart} 不匹配`);
  }
}
if (inFence) errs.push(`代码围栏未配平：L${fenceStart} 开始的围栏没有收尾`);
// ★ 2026-10-18 修：原先这里按「围栏总数是奇数」报错，而 fenceCount 记的是**块数**（开围栏才 ++）
//   ⇒ 任何**只有奇数个代码块**的文档都被误判（README 恰好 16 块＝偶数才没暴露；拿本脚本校验
//   RUNTIME_SETUP.md（1 块）时假红）。配平已由上一行的 inFence 兜住，这里不再做多余判据。
ok.push(`代码围栏 ${fenceCount} 块、围栏内 ${fenced.size} 行`);

// ---------- ② 标题与锚点 ----------
const slugify = (s) =>
  s.replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 标题里的链接只留文字
    .trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');

const slugs = new Map();
lines.forEach((line, i) => {
  if (fenced.has(i)) return;
  const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
  if (!m) return;
  let s = slugify(m[2]);
  if (slugs.has(s)) {
    const n = slugs.get(s) + 1;
    slugs.set(s, n);
    s = `${s}-${n}`;
  } else slugs.set(s, 0);
  slugs.set(s, 0);
});

const anchors = [];
lines.forEach((line, i) => {
  if (fenced.has(i)) return;
  for (const m of line.matchAll(/\]\(#([^)\s]+)\)/g)) anchors.push({ a: decodeURIComponent(m[1]), i: i + 1 });
});
const badAnchors = anchors.filter(({ a }) => !slugs.has(a));
if (badAnchors.length) errs.push(`锚点解析不到标题：${badAnchors.map(({ a, i }) => `L${i} #${a}`).join('、')}`);
ok.push(`锚点 ${anchors.length} 个（命中 ${anchors.length - badAnchors.length}）`);

// ---------- ③ 相对链接 / 配图 ----------
const links = [];
lines.forEach((line, i) => {
  if (fenced.has(i)) return;
  for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/i.test(raw)) continue;
    links.push({ raw, img: m[0].startsWith('!'), i: i + 1 });
  }
});
const missing = [];
for (const l of links) {
  const p = resolve(ROOT, decodeURIComponent(l.raw.split('#')[0]));
  if (!existsSync(p) || statSync(p).size === 0) missing.push(`L${l.i} ${l.raw}${l.img ? '（配图）' : ''}`);
}
if (missing.length) errs.push(`相对链接/配图指向不存在的文件：${missing.join('、')}`);
const imgs = links.filter((l) => l.img);
ok.push(`相对链接 ${links.length} 个（配图 ${imgs.length}）`);

// ---------- ④ 表格 ----------
let blocks = 0, badTables = [];
for (let i = 0; i < lines.length; i++) {
  if (fenced.has(i) || !/^\s*\|/.test(lines[i])) continue;
  const start = i;
  const rows = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push({ n: i + 1, c: lines[i].trim().replace(/^\||\|$/g, '').split('|').length }), i++;
  blocks++;
  const head = rows[0].c;
  const sep = rows[1];
  if (!sep || !/^\|[\s:|-]+\|$/.test(lines[sep.n - 1].trim())) badTables.push(`L${start + 1} 表头下第 2 行不是分隔行`);
  for (const r of rows) if (r.c !== head) badTables.push(`L${r.n} 列数 ${r.c} ≠ 表头 ${head}`);
}
if (badTables.length) errs.push(`表格结构问题：${badTables.join('；')}`);
else ok.push(`表格 ${blocks} 个，列数全部对齐`);

// ---------- ⑤ 过时事实回归锁（**只对 README 生效**；传其它 .md 时只做结构校验） ----------
const isReadme = !process.argv[2];
if (isReadme) {
const stale = [
  [/<工作区>\/\.dag-flow/, '「<工作区>/.dag-flow」旧存储根'],
  [/<workspace>\/\.dag-flow/, '「<workspace>/.dag-flow」旧存储根'],
  [/所有数据都在\*\*当前工作区\*\*/, '「所有数据都在当前工作区下」旧表述'],
  [/Everything is under the \*\*current workspace\*\*/, '英文旧表述 current workspace'],
  [/存到工作区/, '「file_save 存到工作区」旧表述'],
  [/\bCHANGELOG\.md\b/, 'CHANGELOG.md 链接（该文件已由用户删除）'],
];
for (const [re, what] of stale) {
  const hit = lines.findIndex((l) => re.test(l));
  if (hit >= 0) errs.push(`L${hit + 1} 仍有过时内容：${what}`);
}
const need = [
  ['<DSH_HOME>/.dag-flow/', 3],   // 中文存储块 + 邮件配置 + 英文存储块
  ['# 中文文档', 1],
  ['# English Documentation', 1],
];
for (const [needle, min] of need) {
  const n = lines.filter((l) => l.includes(needle)).length;
  if (n < min) errs.push(`缺失/偏少：应至少出现 ${min} 次的「${needle}」实际 ${n} 次`);
}
ok.push('过时事实回归锁：无「工作区=数据根」旧表述、无 CHANGELOG 死链');

// ⑥ 离线链文件数自同步（2026-10-18：README 里写死的「N 个文件」曾漂到 46、实际 52）
//   规则：README 里若写了数字，就必须与 package.json#test:offline 的真实去重文件数一致；
//   没写数字则跳过（不给未来改措辞的人添麻烦）。
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const realCount = new Set(
  String(pkg.scripts?.['test:offline'] ?? '')
    .split('&&')
    .map((s) => /^\s*node\s+(\S+)/.exec(s)?.[1])
    .filter(Boolean),
).size;
const zhNum = /离线回归套件（(\d+) 个文件）/.exec(text)?.[1];
const enNum = /offline regression suite \((\d+) files?\)/.exec(text)?.[1];
if (zhNum || enNum) {
  if (zhNum && Number(zhNum) !== realCount) errs.push(`离线链文件数漂了：README 中文写 ${zhNum}、实际 ${realCount}`);
  if (enNum && Number(enNum) !== realCount) errs.push(`离线链文件数漂了：README 英文写 ${enNum}、实际 ${realCount}`);
  if (Number(zhNum) === realCount && Number(enNum) === realCount) ok.push(`离线链文件数与 package.json 一致（${realCount} 个）`);
} else {
  ok.push('（README 未写离线链文件数：跳过该项比对）');
}
} else {
  ok.push('（非 README：跳过"过时事实 / 必备串"检查，只校验围栏·锚点·链接·表格）');
}

// ---------- 输出 ----------
console.log(`${relative(ROOT, README) || README}: ${lines.length} 行 / ${text.length} 字符`);
for (const s of ok) console.log(`  ✅ ${s}`);
for (const w of warns) console.log(`  ⚠️  ${w}`);
for (const e of errs) console.log(`  ❌ ${e}`);
console.log(errs.length ? `\n结果：${errs.length} 个错误、${warns.length} 个提示` : `\n结果：全部通过（${warns.length} 个提示）`);
process.exit(errs.length ? 1 : 0);
