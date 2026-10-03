// tmp-test/probe-fin-daily-cctv.mjs — 实跑改后的 fetch_cctv（python）：
//   ① 真实网络：央视网按日页 → CCTV_OK + 当日联播条目（含 [视频] 或 联播）
//   ② 全失败路径：日期改成 1900-01-01 + 搜索结果只给百度百科 → CCTV_FETCH_SKIPPED 且 **exit 0**（不中断工作流）
//   ③ 反证：百度百科候选必须被跳过，不能拖满 12s 超时才发现失败
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const node = def.nodes.find((n) => n.id === 'fetch_cctv');
if (!node || node.type !== 'python') { console.error('✗ fetch_cctv 不是 python 节点（补丁没生效？）'); process.exit(1); }
const code = node.params.code;

function findPython() {
  const roots = [join(WORKSPACE, 'dag-flow', 'runtime'), join(homedir(), '.dsh', 'runtime')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const hit = walk(root, 0);
    if (hit) return hit;
  }
  for (const cmd of ['python', 'python3', 'py']) {
    try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return cmd; } catch { /* next */ }
  }
  return null;
}
function walk(dir, depth) {
  if (depth > 4) return null;
  let items = [];
  try { items = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const it of items) {
    const full = join(dir, it.name);
    if (it.isFile() && (it.name === 'python.exe' || it.name === 'python3')) return full;
    if (it.isDirectory()) { const hit = walk(full, depth + 1); if (hit) return hit; }
  }
  return null;
}

const py = findPython();
if (!py) { console.log('⚠ 本机没找到 Python 运行时 → 跳过实跑'); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), 'fin-cctv-'));
const PYENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const run = (name, src) => {
  const f = join(dir, name + '.py');
  writeFileSync(f, src, 'utf8');
  try {
    return { code: 0, out: String(execFileSync(py, [f], { encoding: 'utf8', timeout: 180000, cwd: WORKSPACE, env: PYENV })).trim() };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').split('\n').slice(-3).join(' | ') };
  }
};

const today = new Date().toISOString().slice(0, 10);
const withInputs = (day, resultsJson) => code
  .replace(/\{\{py_date\.out\}\}/g, day)
  .replace(/\{\{srch_cctv\.out\.results\}\}/g, resultsJson.replace(/'''/g, ''));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

console.log('\n[1] 真实网络：央视网按日页（今天 ' + today + '）');
{
  const r = run('cctv_live', withInputs(today, JSON.stringify([
    { title: '百度百科-2026年', url: 'https://baike.baidu.com/item/2026%E5%B9%B4' },
  ])));
  const head = r.out.split('\n')[0];
  const body = r.out.slice(head.length);
  ok(r.code === 0, `退出码 0（实际 ${r.code}${r.err ? ' · stderr ' + r.err : ''}）`);
  ok(/^CCTV_OK /.test(head), `状态行是 CCTV_OK（实际 ${JSON.stringify(head.slice(0, 120))}）`);
  ok(body.length > 150, `正文有内容（${body.length} 字）`);
  ok(/视频|联播|完整版/.test(body), `正文是联播条目（含「[视频]/联播/完整版」关键词）`);
}

console.log('\n[2] 全失败路径：1900-01-01 + 只有百度百科候选 → 只报告不中断（exit 0）');
{
  const r = run('cctv_dead', withInputs('1900-01-01', JSON.stringify([
    { title: '百度百科', url: 'https://baike.baidu.com/item/1900%E5%B9%B4' },
  ])));
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.startsWith('CCTV_FETCH_SKIPPED'), `状态行是 CCTV_FETCH_SKIPPED（实际 ${JSON.stringify(r.out.slice(0, 130))}）`);
}

console.log('\n[3] 反证：百度百科候选被跳过（不发起请求，所以不该出现 HTTP 403 记录）');
{
  const t0 = Date.now();
  const r = run('cctv_skip', withInputs('1900-01-01', JSON.stringify([
    { title: '百度百科', url: 'https://baike.baidu.com/item/1900%E5%B9%B4' },
    { title: '知乎', url: 'https://zhuanlan.zhihu.com/p/12345' },
  ])));
  const ms = Date.now() - t0;
  ok(/跳过：已知反爬站/.test(r.out), `状态里写明跳过反爬站（实际 ${JSON.stringify(r.out.split('（')[1]?.slice(0, 90))}）`);
  ok(!/403/.test(r.out), '没有为反爬站白跑一次请求（无 403 记录）');
  console.log(`  （本次耗时 ${(ms / 1000).toFixed(1)}s，含两条按日页真实请求）`);
}

console.log(`\n=== fetch_cctv 实跑：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
