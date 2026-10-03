// tmp-test/probe-mail-foreign-cwd.mjs — 复刻真机条件验证 mail v3：**cwd ≠ 工作区**时还能不能找到凭据与日报
//   真机症状（2026-10-03 用户截图）：MAIL_SKIPPED_NO_SMTP —— python 节点 cwd 继承宿主进程（≠ 工作区），
//   旧代码按 ./.dag-flow/... 相对路径找文件必然失败。
//   v3 改为从 save_doc 的绝对路径反推 .dag-flow 目录。本探针把 cwd 换成一个**空临时目录**来复现真机，
//   注入的 save_doc.out.absolutePath 指向真实报告文件 → 应该照样 MAIL_SENT。
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const code = String(def.nodes.find((n) => n.id === 'mail')?.params?.code ?? '');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

function findPython() {
  for (const root of [join(WORKSPACE, 'dag-flow', 'runtime'), join(homedir(), '.dsh', 'runtime')]) {
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
if (!py) { console.log('⚠ 没找到 Python 运行时 → 跳过'); process.exit(0); }

const today = new Date().toISOString().slice(0, 10);
const reportPath = join(WORKSPACE, '.dag-flow', 'reports', `金融政策日报-${today}.md`);
const hadReport = existsSync(reportPath);
if (!hadReport) {
  mkdirSync(join(WORKSPACE, '.dag-flow', 'reports'), { recursive: true });
  writeFileSync(reportPath, `# 异地 cwd 取证用临时报告\n\n（probe 生成，用完即删）\n`, 'utf8');
}
const emptyCwd = mkdtempSync(join(tmpdir(), 'foreign-cwd-'));   // ★ 故意用空目录当 cwd（复刻真机）
const cleanEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
for (const k of ['DAGFLOW_SMTP_HOST', 'DAGFLOW_SMTP_PORT', 'DAGFLOW_SMTP_USER', 'DAGFLOW_SMTP_PASS', 'DAGFLOW_MAIL_CONFIG']) delete cleanEnv[k];

const dir = mkdtempSync(join(tmpdir(), 'mail-v3-'));
const run = (name, src, cwd) => {
  const f = join(dir, name + '.py');
  writeFileSync(f, src, 'utf8');
  try {
    return { code: 0, out: String(execFileSync(py, [f], { encoding: 'utf8', timeout: 90000, cwd, env: cleanEnv })).trim() };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').trim() };
  }
};
const withTpl = (docPath) => code
  .replace(/\{\{inputs\.收件邮箱\}\}/g, String(def.inputs?.['收件邮箱'] ?? ''))
  .replace(/\{\{py_date\.out\}\}/g, today)
  .replace(/\{\{save_doc\.out\.absolutePath\}\}/g, docPath);

console.log(`cwd = ${emptyCwd}（空目录，非工作区）`);
console.log('== ① 注入 save_doc 绝对路径（真实运行时的形态）→ 应照样发出 ==');
{
  const r = run('foreign_ok', withTpl(reportPath), emptyCwd);
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(/^MAIL_(SENT|FAILED)/.test(r.out), `走到了真实发信分支（${JSON.stringify(r.out.split('\n')[0].slice(0, 130))}）`);
  ok(!r.out.includes('MAIL_SKIPPED_NO_SMTP'), '凭据已从 .dag-flow/mail.json 读到（cwd 不是工作区也能找到）');
  ok(!r.out.includes('MAIL_SKIPPED_NO_DOC'), '日报文件已按绝对路径找到');
  if (r.out.includes('MAIL_SENT')) ok(r.out.includes('凭据'), `状态行标注了凭据来源（${JSON.stringify(r.out.split('\n')[0].slice(0, 150))}）`);
}

console.log('\n== ② 没有绝对路径（save_doc 失败/变量为空）+ 异地 cwd → 只报告 + 自带诊断，exit 0 ==');
{
  const r = run('foreign_nopath', withTpl('None'), emptyCwd);
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_SKIPPED_NO_SMTP') || r.out.includes('MAIL_SKIPPED_NO_DOC'), `给出明确跳过原因（${JSON.stringify(r.out.split('\n')[0].slice(0, 120))}）`);
  ok(r.out.includes('找过') && r.out.includes('cwd='), '失败信息自带"找过的路径 + cwd"（省得再截图）');
  ok(!/Traceback|ValueError/.test(r.out + (r.err ?? '')), '没有异常堆栈');
}

if (!hadReport) { try { unlinkSync(reportPath); } catch { /* 忽略 */ } }
console.log(`\n=== mail v3 异地 cwd 取证：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
