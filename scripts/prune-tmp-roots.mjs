// scripts/prune-tmp-roots.mjs — 清理「测试历史残留在系统 TEMP 里的临时数据根」
//
// 背景（2026-10-16）：各测试用 mkdtemp 造隔离数据根防污染真机（对），但**以前从不回收** ⇒
//   本机 TEMP 累积了 8600+ 个 `dag-*` / `df-*` / `dsh-*` 目录。新写法（test/_tmp-root.mjs）
//   已做到"进程退出即回收"，**本脚本负责清历史存量**。
//
// 用法：
//   node scripts/prune-tmp-roots.mjs                  # dry-run（默认）：只扫只报，不删任何东西
//   node scripts/prune-tmp-roots.mjs --apply          # 真删
//   node scripts/prune-tmp-roots.mjs --min-age-min=0  # 连刚建的也删（默认只删 ≥10 分钟未改动的，
//                                                     # 避免打断正在跑的测试/另一个实例）
//
// 安全边界：①只认下面的**白名单前缀**（DSH 自己的 dsh-subprocess-* / dsh-spill-* 绝不碰）；
//   ②只处理目录；③必须直接位于 os.tmpdir() 下（用 resolve 比较父目录）。
import { readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const PREFIXES = ['dag-', 'df-', 'dsh-home-', 'dsh-ws-', 'dsh-cwd-', 'dsh-wf-test-'];
const APPLY = process.argv.includes('--apply');
const ageArg = process.argv.find((a) => a.startsWith('--min-age-min='));
// ★ 参数校验（2026-10-16）：Number('abc') = NaN ⇒ 下面的 `now - mtime < NaN*60000` 恒为 false
//   ⇒ 门槛静默失效、等同 0（会连刚建的目录一起删）。必须显式拒绝，不能"容错继续"。
const rawAge = ageArg ? Number(ageArg.split('=')[1]) : 10;
if (!Number.isFinite(rawAge) || rawAge < 0) {
  console.error(`[tmp:prune] --min-age-min 需要一个 ≥ 0 的数字，收到：${ageArg ?? '(未给)'}`);
  process.exit(2);
}
const MIN_AGE_MIN = rawAge;

const ROOT = tmpdir();
const now = Date.now();

function dirStats(d) {
  let files = 0;
  let bytes = 0;
  try {
    for (const e of readdirSync(d, { withFileTypes: true, recursive: true })) {
      if (!e.isFile()) continue;
      files++;
      try { bytes += statSync(join(e.parentPath ?? e.path, e.name)).size; } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { files, bytes };
}

const found = [];
for (const name of readdirSync(ROOT)) {
  if (!PREFIXES.some((p) => name.startsWith(p))) continue;
  const full = join(ROOT, name);
  let st;
  try { st = statSync(full); } catch { continue; }
  if (!st.isDirectory()) continue;
  if (resolve(dirname(full)) !== resolve(ROOT)) continue;              // 双保险：必须在 TEMP 直属
  if (now - st.mtimeMs < MIN_AGE_MIN * 60_000) continue;               // 太新 ⇒ 可能正被使用
  found.push({ full, name, mtime: st.mtimeMs });
}

let files = 0;
let bytes = 0;
const byPrefix = {};
for (const it of found) {
  const pre = PREFIXES.find((p) => it.name.startsWith(p)) ?? '?';
  byPrefix[pre] = (byPrefix[pre] ?? 0) + 1;
  const s = dirStats(it.full);
  files += s.files;
  bytes += s.bytes;
}

console.log(`扫描目录：${ROOT}`);
console.log(`白名单前缀：${PREFIXES.join(' / ')}`);
console.log(`年龄门槛：≥ ${MIN_AGE_MIN} 分钟未修改`);
console.log(`命中：${found.length} 个目录 · ${files} 个文件 · ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`按前缀：${Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

if (found.length) {
  const byTime = [...found].sort((a, b) => a.mtime - b.mtime);
  const sample = [...byTime.slice(0, 3), ...byTime.slice(-3)];
  console.log('抽样（最早 3 / 最新 3）：');
  for (const it of sample) console.log(`  ${new Date(it.mtime).toISOString().slice(0, 19).replace('T', ' ')}  ${it.name}`);
}

if (!APPLY) {
  console.log('\n[dry-run] 未删除任何东西。确认无误后加 --apply 真删。');
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const it of found) {
  try { rmSync(it.full, { recursive: true, force: true }); ok++; }
  catch { fail++; console.log(`  删除失败：${it.name}`); }
}
console.log(`\n[apply] 删除成功 ${ok} / 失败 ${fail}`);
