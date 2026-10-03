// tmp-test/inspect-mail-config.mjs — 只读体检：工作流里的邮件配置到底是怎么配的（**自动打码，绝不打印密钥**）
import { readFileSync, statSync, existsSync } from 'node:fs';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const raw = readFileSync(DEF, 'utf8');
const def = JSON.parse(raw);
const st = statSync(DEF);

console.log('文件修改时间：' + st.mtime.toISOString() + `（${Math.round((Date.now() - st.mtimeMs) / 1000)} 秒前）`);
console.log('节点数：' + def.nodes.length + ' / 边：' + def.edges.length);
console.log('工作流参数：' + JSON.stringify(def.inputs));

const mail = def.nodes.find((n) => n.id === 'mail');
if (!mail) { console.log('\n✗ 当前文件里没有 mail 节点（可能被画布旧副本覆盖了）'); process.exit(0); }
const code = String(mail.params?.code ?? '');
console.log('\nmail 节点：type=' + mail.type + ' 代码 ' + code.length + ' 字');

// —— 打码工具：任何看起来像密码/授权码的赋值、login 实参、os.environ.get 的默认值一律替换 ——
const redact = (s) => s
  .replace(/(pass(?:word)?|passwd|pwd|token|secret|authcode|authorization_code)\s*[:=]\s*(['"])[^'"]*\2/gi, '$1 = "***"')
  .replace(/(login\s*\(\s*[^,)]+,\s*)(['"])[^'"]*\2/g, '$1"***"')
  // ★ 2026-10-03 补：os.environ.get('ANY', '默认值') —— 用户把授权码写成了环境变量默认值，
  //   旧规则没覆盖这种写法，把授权码原样打了出来（教训：打码要在"我没想到的写法"上也生效）
  .replace(/((?:PASS|PASSWORD|PWD|TOKEN|SECRET|KEY|AUTH)[A-Z_]*['"]\s*,\s*)(['"])[^'"]*\2/gi, '$1"***"')
  .replace(/(os\.environ(?:\.get)?\([^)]*['"]\s*,\s*)(['"])[^'"]*\2/g, '$1"***"')
  .replace(/(MAIL_PASS|SMTP_PASS)\s*=\s*(['"])[^'"]*\2/gi, '$1 = "***"');

const facts = [];
facts.push('引用 DAGFLOW_SMTP_* 环境变量：' + (/DAGFLOW_SMTP/.test(code) ? '是' : '否'));
const hosts = [...code.matchAll(/smtp[.\-\w]*\.(?:163|qq|exmail|gmail|126|aliyun|outlook|ethereal)[.\w]*/gi)].map((m) => m[0]);
facts.push('代码里出现的 SMTP 主机：' + (hosts.length ? [...new Set(hosts)].join(', ') : '（无）'));
const emails = [...code.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]);
facts.push('代码里出现的邮箱：' + (emails.length ? [...new Set(emails)].join(', ') : '（无）'));
facts.push('用 smtplib：' + (/smtplib/.test(code) ? '是' : '否'));
facts.push('用 HTTP API 发信（requests/urllib+api）：' + (/requests\.|api\.resend|sendgrid|brevo|mailgun/i.test(code) ? '是' : '否'));
facts.push('端口写法：' + (/SMTP_SSL|465/.test(code) ? '465/SSL' : (/starttls|587/.test(code) ? '587/STARTTLS' : '未识别')));
console.log('\n== 体检结论 ==');
for (const f of facts) console.log('  · ' + f);

// —— 本地凭据文件（2026-10-03 用户约定：工作流相关配置文件统一放 .dag-flow/workflow/config/）：只报告存在性与长度 ——
const CFG = 'D:/workspace/pluginspace/.dag-flow/workflow/config/mail.json';
if (existsSync(CFG)) {
  const c = JSON.parse(readFileSync(CFG, 'utf8'));
  const m = (s) => (s ? `${String(s).length} 字（${String(s).slice(0, 2)}***）` : '（无）');
  console.log('\n== .dag-flow/workflow/config/mail.json（凭据落点·打码）==');
  console.log(`  host=${m(c.host)} user=${m(c.user)} pass=${m(c.pass)} port=${c.port}`);
  // ★ 只对**授权码**做"整文件不得出现"的判据；发件账号在本工作流里同时是收件人（自发自收），
  //   合法地存在于工作流参数「收件邮箱」中，拿它当泄漏判据会误报（本脚本第一版即误报）。
  if (c.pass && raw.includes(String(c.pass))) console.log('  ⚠ 工作流 JSON 里仍残留授权码！（应只在 mail.json 里）');
  if (c.user && code.includes(String(c.user))) console.log('  ⚠ mail 代码里残留发件账号（账号只应出现在「收件邮箱」参数里）');
  if (c.user) console.log(`  说明：发件账号 = 工作流参数「收件邮箱」${def.inputs?.['收件邮箱'] === c.user ? '（一致，自发自收）' : '（与参数不一致，请核对）'}`);
} else {
  console.log('\n== .dag-flow/mail.json：不存在（凭据只能来自环境变量）==');
}

console.log('\n== 相关代码行（已打码）==');
code.split('\n').forEach((line, i) => {
  if (/(MAIL_TO|smtp|SMTP|login|sendmail|DAGFLOW|收件|邮箱|host|port|user|pass|from_addr|credentials)/i.test(line)) {
    console.log(`  ${String(i + 1).padStart(3)}| ${redact(line).slice(0, 150)}`);
  }
});
