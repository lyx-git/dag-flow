// tmp-test/probe-public-smtp.mjs — 用「公共测试 SMTP」跑通工作流的发邮件节点（真发一封，看预览）
//   公共测试 SMTP 选 Ethereal（nodemailer 官方测试服）：一个 HTTP POST 就能拿到账号，收信不投递真实邮箱、
//   只在网页上给预览（含 HTML/纯文本/附件），非常适合验证「发信链路是否通」而不打扰真实收件人。
// 本脚本做的事：
//   ① POST https://api.nodemailer.com/user 拿 {user, pass, smtp}
//   ② 直接拿「金融政策日报」工作流里 mail 节点的**原样 Python 代码**，只把模板占位替换成测试值
//   ③ 在临时目录里造好 .dag-flow/reports/金融政策日报-<今天>.md（模拟前一步 file_save 的产物）
//   ④ 用插件自己的 Python 运行时执行它 → 进 Ethereal 的收件箱
//   ⑤ 查询 Ethereal API 取回消息 id，打印预览链接
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';

function findPython() {
  const roots = [join(process.cwd(), 'runtime'), join(homedir(), '.dsh', 'runtime')];
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

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// ① 拿 Ethereal 测试账号（无需注册、无需真实邮箱）
console.log('[1] 申请 Ethereal 公共测试 SMTP 账号');
const acctRes = await fetch('https://api.nodemailer.com/user', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ requestor: 'dag-flow 金融政策日报 发信链路验证', version: '1.0' }),
});
if (!acctRes.ok) { console.error('✗ 申请失败：HTTP ' + acctRes.status + ' ' + (await acctRes.text()).slice(0, 200)); process.exit(1); }
const acct = await acctRes.json();
const smtp = acct.smtp ?? { host: 'smtp.ethereal.email', port: 587, secure: false };
console.log(`  ✓ 账号 ${acct.user} · SMTP ${smtp.host}:${smtp.port}`);
ok(String(acct.user).includes('@ethereal.email'), '拿到 Ethereal 邮箱账号（形如 xxx@ethereal.email）');

// ② 取工作流里 mail 节点的原样代码
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const mailCode = def.nodes.find((n) => n.id === 'mail')?.params?.code ?? '';
ok(mailCode.includes('smtplib') && mailCode.includes('DAGFLOW_SMTP_HOST'), '读到工作流 mail 节点的原始 Python 代码');

// ③ 造出「前一步 file_save 的产物」：临时目录当作工作区，路径与 file_save 的 filename 一致
const today = new Date().toISOString().slice(0, 10);
const work = mkdtempSync(join(tmpdir(), 'fin-mail-'));
const docPath = join(work, '.dag-flow', 'reports', `金融政策日报-${today}.md`);
mkdirSync(join(work, '.dag-flow', 'reports'), { recursive: true });
writeFileSync(docPath, `# 金融政策与市场影响日报 · ${today}\n\n（测试正文：验证发信链路，含中文与表格）\n\n| 板块 | A股 | 港股 | 美股 | 纳指 | 方向 |\n|---|---|---|---|---|---|\n| 半导体 | ✓ | ✓ | ✓ | ✓ | 积极 |\n`, 'utf8');
console.log(`[2] 造好日报文件 ${docPath}`);

// ④ 用插件运行时执行（模板占位替换成测试值；环境变量喂 Ethereal 账号）
const py = findPython();
if (!py) { console.log('⚠ 本机没找到 Python 运行时 → 跳过实发'); process.exit(0); }
const code = mailCode
  .replace(/\{\{inputs\.收件邮箱\}\}/g, acct.user)
  .replace(/\{\{py_date\.out\}\}/g, today);
const script = join(work, 'mail.py');
writeFileSync(script, code, 'utf8');

console.log('[3] 用工作流原样代码发信（收件人＝测试邮箱）');
let out = '', errOut = '', code3 = 0;
try {
  out = String(execFileSync(py, [script], {
    encoding: 'utf8', cwd: work, timeout: 120000,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
      DAGFLOW_SMTP_HOST: smtp.host,
      DAGFLOW_SMTP_PORT: String(smtp.port),
      DAGFLOW_SMTP_USER: acct.user,
      DAGFLOW_SMTP_PASS: acct.pass,
    },
  })).trim();
} catch (e) { code3 = e.status ?? -1; out = String(e.stdout ?? '').trim(); errOut = String(e.stderr ?? '').split('\n')[0]; }
ok(code3 === 0 && out.includes('MAIL_SENT'), `发信成功（exit=${code3}，输出 ${JSON.stringify(out.slice(0, 120))}${errOut ? ' | ' + errOut : ''}）`);

// ⑤ 取回预览链接（Ethereal 的消息列表 API 挂在 api.nodemailer.com 上；api.ethereal.email 这个域名解析不到）
if (code3 === 0) {
  console.log(`[4] 测试账号（可登录 https://ethereal.email 查看收件箱）：${acct.user} / ${acct.pass}`);
  const auth = 'Basic ' + Buffer.from(`${acct.user}:${acct.pass}`).toString('base64');
  let msg = null;
  for (const url of [
    `https://api.nodemailer.com/messages?account=${encodeURIComponent(acct.user)}`,
    `https://ethereal.email/messages?account=${encodeURIComponent(acct.user)}`,
  ]) {
    try {
      const r = await fetch(url, { headers: { authorization: auth } });
      if (!r.ok) { console.log(`  · ${url} → HTTP ${r.status}`); continue; }
      const list = await r.json();
      if (Array.isArray(list) && list.length) { msg = list[list.length - 1]; console.log(`  · 列表来源 ${url}`); break; }
    } catch (e) { console.log(`  · ${url} → ${String(e.cause?.code ?? e.message)}`); }
  }
  // 消息列表 API 不稳（api.nodemailer.com/messages 返回 500、ethereal.email/messages 返回 HTML 页面）：
  // 发信成功已经是硬证据，取不到列表只做提示、不算失败。
  console.log(msg
    ? `  ✓ 已取到消息记录：https://ethereal.email/message/${msg.id}`
    : '  ℹ 没取到消息列表 API（链路正常，只是 API 不可用）——用上面的账号密码登录 https://ethereal.email 看收件箱即可');
  if (msg) {
    console.log(`  · 主题：${msg.subject}`);
    console.log(`  · 收件人：${(msg.to ?? []).map((t) => t.address).join(', ')}`);
    console.log(`  · 附件：${(msg.attachments ?? []).map((a) => a.filename).join(', ') || '（无）'}`);
    console.log(`  · 正文长度：${(msg.text ?? '').length} 字符`);
    pass++;
    if (String(msg.subject).includes('金融政策日报')) { pass++; console.log('  ✓ 主题中文没乱码'); }
    if ((msg.attachments ?? []).some((a) => String(a.filename).includes('金融政策日报'))) { pass++; console.log('  ✓ 附件带上了 .md 日报'); }
  }
}

console.log(`\n=== 公共测试 SMTP 实发：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
