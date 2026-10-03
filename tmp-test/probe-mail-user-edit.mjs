// tmp-test/probe-mail-user-edit.mjs — 用「用户改后的原样 mail 代码」实跑，验证在当前环境（无 SMTP 环境变量）下会发生什么
//   取证点：用户把 host/user/pwd 写成 os.environ.get('X', '默认值')，但 port 那行写成了
//           int((os.environ.get('DAGFLOW_SMTP_PORT') or '').strip() or '')
//           → 环境变量未设时 int('') 抛 ValueError → 脚本在 try 之外崩溃 → **节点退出码非 0**
//           → DAG 模式下一个节点失败即中断后续层（正是用户最怕的「邮件没跑成功带崩工作流」）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const code = String(def.nodes.find((n) => n.id === 'mail')?.params?.code ?? '');

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
if (!py) { console.log('⚠ 没找到 Python'); process.exit(0); }

const today = new Date().toISOString().slice(0, 10);
const reportPath = join(WORKSPACE, '.dag-flow', 'reports', `金融政策日报-${today}.md`);
const had = existsSync(reportPath);
if (!had) {
  mkdirSync(join(WORKSPACE, '.dag-flow', 'reports'), { recursive: true });
  writeFileSync(reportPath, `# 邮件节点取证用临时文件\n\n（probe 生成，用完即删）\n`, 'utf8');
}

// 沿用工作流自身的参数替换；**不放任何 DAGFLOW_SMTP_* 环境变量**（复刻用户当前机器的真实状态）
const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
for (const k of ['DAGFLOW_SMTP_HOST', 'DAGFLOW_SMTP_PORT', 'DAGFLOW_SMTP_USER', 'DAGFLOW_SMTP_PASS']) delete env[k];

const src = code
  .replace(/\{\{inputs\.收件邮箱\}\}/g, String(def.inputs?.['收件邮箱'] ?? ''))
  .replace(/\{\{py_date\.out\}\}/g, today);
const dir = mkdtempSync(join(tmpdir(), 'mail-user-edit-'));
const f = join(dir, 'mail.py');
writeFileSync(f, src, 'utf8');

let out = '', err = '', code0 = -1;
try {
  out = String(execFileSync(py, [f], { encoding: 'utf8', timeout: 60000, cwd: WORKSPACE, env })).trim();
  code0 = 0;
} catch (e) {
  out = String(e.stdout ?? '').trim();
  err = String(e.stderr ?? '').trim();
  code0 = e.status ?? -1;
}
if (!had) { try { unlinkSync(reportPath); } catch { /* 忽略 */ } }

console.log('== 用户改后的 mail 代码 · 在「未设 DAGFLOW_SMTP_* 环境变量」下的实测 ==');
console.log('退出码：' + code0 + (code0 === 0 ? '（节点会记 success）' : '（★ 节点会记 failed → DAG 模式下中断后续层）'));
console.log('stdout：' + (out ? JSON.stringify(out.slice(0, 200)) : '（空）'));
console.log('stderr 末几行：');
for (const l of err.split('\n').slice(-6)) console.log('  ' + l);
process.exit(code0 === 0 ? 0 : 1);
