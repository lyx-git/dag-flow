// tmp-test/probe-fin-daily-python.mjs — 实跑「金融政策日报」里的两段 Python（用插件自己的运行时）
//   ① py_date → 必须输出 YYYY-MM-DD（模板当纯字符串用，格式错了后面全歪）
//   ② mail    → ★ 契约已改：**永不失败**（DAG 模式下节点失败会中断后续层，所以邮件问题只报告不中断）
//                 每条失败路径都必须 exit 0 + 打印 MAIL_* 状态；成功路径 exit 0 + MAIL_SENT
//   ③ 额外：SMTP 连不上时也必须 exit 0 + MAIL_FAILED（"邮件炸了不影响工作流"的直接证据）
//   ④ 额外：用 Ethereal 公共测试 SMTP 真发一封（验证成功路径不是纸面推演）
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const WORKSPACE = 'D:/workspace/pluginspace';   // 插件跑工作流时的 cwd（.dag-flow/ 就在这里）
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const codeOf = (id) => def.nodes.find((n) => n.id === id)?.params?.code ?? '';

// 找 python：插件 runtime 目录 → ~/.dsh → PATH
function findPython() {
  const roots = [
    join(WORKSPACE, 'dag-flow', 'runtime'),
    join(WORKSPACE, 'dag-flow', 'node_modules', 'dag-flow', 'runtime'),
    join(homedir(), '.dsh', 'runtime'),
    join(WORKSPACE, 'node_modules', 'dag-flow', 'runtime'),
  ];
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
if (!py) { console.log('⚠ 本机没找到 Python 运行时（插件 runtime 未下载 / PATH 无 python）→ 跳过实跑'); process.exit(0); }
console.log('python =', py);

const dir = mkdtempSync(join(tmpdir(), 'fin-daily-py-'));
// ★ 镜像插件的执行环境：builtin.ts 跑 python 时强制 PYTHONIOENCODING=utf-8 + PYTHONUTF8=1
//   （不设的话中文 Windows 管道默认 GBK，脚本里的非 ASCII 输出会 UnicodeEncodeError 崩掉——本 probe 第一版就踩了）
const PYENV = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const run = (name, code, extraEnv = {}) => {
  const f = join(dir, name + '.py');
  writeFileSync(f, code, 'utf8');
  try {
    // cwd = 工作区：让脚本里的 .dag-flow/reports/... 相对路径与真实运行一致
    const out = execFileSync(py, [f], { encoding: 'utf8', timeout: 90000, cwd: WORKSPACE, env: { ...PYENV, ...extraEnv } });
    return { code: 0, out: String(out).trim() };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').split('\n')[0] };
  }
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const mail = codeOf('mail');
if (!mail) { console.error('✗ 工作流里没有 mail 节点（补丁没生效？）'); process.exit(1); }
console.log('mail 节点代码长度 =', mail.length, '字');

console.log('\n[1] py_date 取日期');
{
  const r = run('py_date', codeOf('py_date'));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.out), `输出是 YYYY-MM-DD（实际 ${JSON.stringify(r.out)}）`);
}

console.log('\n[2] mail：没填收件人 → 报告 MAIL_SKIPPED_NO_TO，且 exit 0（不中断）');
{
  const r = run('mail_no_to', mail.replace(/\{\{inputs\.收件邮箱\}\}/g, ''));
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_SKIPPED_NO_TO'), `输出含 MAIL_SKIPPED_NO_TO（实际 ${JSON.stringify(r.out.slice(0, 90))}）`);
}

console.log('\n[3] mail：填了收件人但没配 SMTP → 报告 MAIL_SKIPPED_NO_SMTP，且 exit 0');
{
  const r = run('mail_no_smtp', mail.replace(/\{\{inputs\.收件邮箱\}\}/g, 'me@example.com'),
    { DAGFLOW_SMTP_HOST: '', DAGFLOW_SMTP_USER: '', DAGFLOW_SMTP_PASS: '' });
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_SKIPPED_NO_SMTP') && r.out.includes('DAGFLOW_SMTP_HOST'),
    `输出含 MAIL_SKIPPED_NO_SMTP + 变量名（实际 ${JSON.stringify(r.out.slice(0, 130))}）`);
}

console.log('\n[4] mail：配置齐了但日报文件不存在 → 报告 MAIL_SKIPPED_NO_DOC，且 exit 0');
{
  const code = mail
    .replace(/\{\{inputs\.收件邮箱\}\}/g, 'me@example.com')
    .replace(/\{\{py_date\.out\}\}/g, '1900-01-01');
  const r = run('mail_no_doc', code, { DAGFLOW_SMTP_HOST: 'smtp.example.com', DAGFLOW_SMTP_USER: 'u@example.com', DAGFLOW_SMTP_PASS: 'x' });
  ok(r.code === 0 && r.out.includes('MAIL_SKIPPED_NO_DOC'),
    `缺日报文件时只报告不中断（exit=${r.code}，输出 ${JSON.stringify(r.out.slice(0, 100))}）`);
}

console.log('\n[5] mail：SMTP 连不上（本机 465 必然拒绝）→ 报告 MAIL_FAILED，且 exit 0 ★ 关键：邮件炸了不拖垮工作流');
{
  const day = '1900-01-03';
  const rep = join(WORKSPACE, '.dag-flow', 'reports', `金融政策日报-${day}.md`);
  mkdirSync(join(WORKSPACE, '.dag-flow', 'reports'), { recursive: true });
  writeFileSync(rep, '# 探针用临时日报\n\nSMTP 连不上时邮件节点必须 exit 0。\n', 'utf8');
  const code = mail
    .replace(/\{\{inputs\.收件邮箱\}\}/g, 'me@example.com')
    .replace(/\{\{py_date\.out\}\}/g, day);
  const r = run('mail_bad_host', code, {
    DAGFLOW_SMTP_HOST: '127.0.0.1', DAGFLOW_SMTP_PORT: '465',
    DAGFLOW_SMTP_USER: 'u@example.com', DAGFLOW_SMTP_PASS: 'x',
  });
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_FAILED'), `输出含 MAIL_FAILED（实际 ${JSON.stringify(r.out.slice(0, 130))}）`);
  try { rmSync(rep); } catch { /* ignore */ }
}

console.log('\n[6] mail：Ethereal 公共测试 SMTP 真发一封 → MAIL_SENT（成功路径实证）');
{
  let acct = null;
  try {
    const res = await fetch('https://api.nodemailer.com/user', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestor: 'dag-flow-probe', version: '1.0' }),
    });
    acct = await res.json();
  } catch (e) {
    console.log('  ⚠ 无法创建 Ethereal 测试账号（' + e.message + '）→ 跳过真发');
  }
  if (acct?.user && acct?.pass) {
    const day = '1900-01-04';
    const rep = join(WORKSPACE, '.dag-flow', 'reports', `金融政策日报-${day}.md`);
    mkdirSync(join(WORKSPACE, '.dag-flow', 'reports'), { recursive: true });
    writeFileSync(rep, '# 金融政策日报（探针）\n\n本文件由 probe 生成，用于验证邮件节点成功路径。\n', 'utf8');
    const code = mail
      .replace(/\{\{inputs\.收件邮箱\}\}/g, acct.user)
      .replace(/\{\{py_date\.out\}\}/g, day);
    const r = run('mail_live', code, {
      DAGFLOW_SMTP_HOST: 'smtp.ethereal.email', DAGFLOW_SMTP_PORT: '587',
      DAGFLOW_SMTP_USER: acct.user, DAGFLOW_SMTP_PASS: acct.pass,
    });
    ok(r.code === 0 && r.out.includes('MAIL_SENT'), `真发成功：${JSON.stringify(r.out.slice(0, 160))}`);
    try { rmSync(rep); } catch { /* ignore */ }
  }
}

console.log(`\n=== 日报 Python 实跑：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
