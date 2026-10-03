// tmp-test/probe-mail-deliver.mjs — 验「真实投递链路本身通不通」：用工作流里原样的 mail 代码 + 你填的默认账号/授权码
//   与 probe-mail-user-edit.mjs 的区别：这里**只看发信是否成功**，因此补上 DAGFLOW_SMTP_PORT=465
//   绕过用户 port 那行的 ValueError（那个 bug 单独取证，见 probe-mail-user-edit.mjs）。
//   报告文件：临时写一份明确标注「投递测试」的，发完删除（若当天真报告已存在则发真的）。
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const code = String(def.nodes.find((n) => n.id === 'mail')?.params?.code ?? '');
const to = String(def.inputs?.['收件邮箱'] ?? '');

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
  writeFileSync(reportPath,
    `# 金融政策日报（投递连通性测试）\n\n` +
    `这封邮件是 **dag-flow 邮件节点的一次真实投递测试**，不是日报正文。\n\n` +
    `- 触发时间：${new Date().toISOString()}\n` +
    `- 用的代码：工作流「金融政策日报」mail 节点的原样代码（smtplib）\n` +
    `- 收到即说明：163 授权码 / 465 SSL / 发件账号 全通；工作流跑完会把真日报发到这里\n`,
    'utf8');
}
const src = code
  .replace(/\{\{inputs\.收件邮箱\}\}/g, to)
  .replace(/\{\{py_date\.out\}\}/g, today);
const dir = mkdtempSync(join(tmpdir(), 'mail-deliver-'));
const f = join(dir, 'mail.py');
writeFileSync(f, src, 'utf8');

const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
// ★ 只补端口（绕过 port 那行的 ValueError），host/user/pass 一律走代码里的默认值
env.DAGFLOW_SMTP_PORT = env.DAGFLOW_SMTP_PORT || '465';

let out = '', err = '', code0 = -1;
try {
  out = String(execFileSync(py, [f], { encoding: 'utf8', timeout: 90000, cwd: WORKSPACE, env })).trim();
  code0 = 0;
} catch (e) {
  out = String(e.stdout ?? '').trim();
  err = String(e.stderr ?? '').trim();
  code0 = e.status ?? -1;
}
if (!had) { try { unlinkSync(reportPath); } catch { /* 忽略 */ } }

console.log('收件人：' + to);
console.log('退出码：' + code0);
console.log('状态行：' + (out.split('\n')[0] || '（空）'));
if (err) console.log('stderr：' + err.split('\n').slice(-3).join(' | '));
const sent = code0 === 0 && out.includes('MAIL_SENT');
console.log(sent ? '\n✅ MAIL_SENT：163 授权码 + 465 SSL + 发件账号 全通，真实投递可行' : '\n❌ 没发出去（见上面状态行/错误）');
process.exit(sent ? 0 : 1);
