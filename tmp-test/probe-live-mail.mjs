// tmp-test/probe-live-mail.mjs — 用「金融政策日报」里**原样**的 mail 节点代码真发一封，验证真实投递
//   前提：dsh 进程环境已配 DAGFLOW_SMTP_HOST/PORT/USER/PASS（qq/163 用授权码）
//   设计要点：
//     · 用工作流自己的代码与自己的收件邮箱（def.inputs.收件邮箱），不是另写一份 → 验的就是将来真跑的那段
//     · 报告文件：若当天报告已存在就用它（那正是工作流会发的东西）；不存在则写一份**明确标注是投递测试**的临时文件，发完删掉
//     · 只打印状态行（MAIL_SENT 含收件人与字数），绝不打印任何密钥
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { existsSync as ex, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const mailNode = def.nodes.find((n) => n.id === 'mail');
if (!mailNode) { console.error('✗ 工作流里没有 mail 节点'); process.exit(1); }

const KEYS = ['DAGFLOW_SMTP_HOST', 'DAGFLOW_SMTP_PORT', 'DAGFLOW_SMTP_USER', 'DAGFLOW_SMTP_PASS'];
console.log('== 当前进程环境（dsh 进程能否读到）==');
for (const k of KEYS) {
  const v = process.env[k];
  console.log(`  ${k}: ${v ? `已设置（${v.length} 字，${v.slice(0, 2)}***）` : '（未设置）'}`);
}
if (!process.env.DAGFLOW_SMTP_HOST || !process.env.DAGFLOW_SMTP_USER || !process.env.DAGFLOW_SMTP_PASS) {
  console.log('\n⚠ 当前进程读不到完整 SMTP 配置 → 不发信。');
  console.log('  说明：环境变量是进程级继承的。若你在 dsh web 启动**之后**才配的，正在跑的那个 dsh 进程里没有；');
  console.log('        工作流执行时同样读不到（会打印 MAIL_SKIPPED_NO_SMTP）——重启一次 dsh web 即可生效。');
  process.exit(2);
}

function findPython() {
  for (const root of [join(WORKSPACE, 'dag-flow', 'runtime'), join(homedir(), '.dsh', 'runtime')]) {
    if (!ex(root)) continue;
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
const reportsDir = join(WORKSPACE, '.dag-flow', 'reports');
const reportPath = join(reportsDir, `金融政策日报-${today}.md`);
const hadReal = existsSync(reportPath);
if (!hadReal) {
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(reportPath,
    `# 金融政策日报（投递连通性测试）\n\n` +
    `这封邮件是 **dag-flow 邮件节点的一次真实投递测试**，不是日报正文。\n\n` +
    `- 触发时间：${new Date().toISOString()}\n` +
    `- 用的代码：工作流「金融政策日报」mail 节点的**原样代码**（smtplib）\n` +
    `- 收到即说明：SMTP 授权码 / 端口 / 发件账号链路全通，工作流跑完会把真日报发到这里\n`,
    'utf8');
  console.log(`\n（当天报告不存在 → 临时写了一份标注为「投递测试」的文件，发完删除）`);
} else {
  console.log(`\n（当天报告已存在 → 直接发它：${reportPath}）`);
}

const code = String(mailNode.params.code)
  .replace(/\{\{inputs\.收件邮箱\}\}/g, String(def.inputs?.['收件邮箱'] ?? ''))
  .replace(/\{\{py_date\.out\}\}/g, today);
const dir = mkdtempSync(join(tmpdir(), 'live-mail-'));
const f = join(dir, 'mail.py');
writeFileSync(f, code, 'utf8');

let out = '', code0 = -1;
try {
  out = String(execFileSync(py, [f], {
    encoding: 'utf8', timeout: 90000, cwd: WORKSPACE,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })).trim();
  code0 = 0;
} catch (e) {
  out = String(e.stdout ?? '').trim();
  code0 = e.status ?? -1;
}

console.log(`\n== 实发结果（exit=${code0}）==`);
console.log('  ' + out.split('\n')[0]);
if (!hadReal) { try { unlinkSync(reportPath); } catch { /* 忽略 */ } }
const sent = code0 === 0 && out.includes('MAIL_SENT');
console.log(sent ? '\n✅ MAIL_SENT：真实投递链路通了' : '\n❌ 未发出（见上面的状态行）');
process.exit(sent ? 0 : 1);
