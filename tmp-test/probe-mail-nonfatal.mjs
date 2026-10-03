// tmp-test/probe-mail-nonfatal.mjs — 邮件节点改造后的**非致命性**取证（a/b/c 三项逐条验）
//   ① 没有 mail.json、也没环境变量 → MAIL_SKIPPED_NO_SMTP + **exit 0**（旧版这里会 ValueError 崩）
//   ② 有 mail.json（凭据在本地文件）但 163 认证被拒 → MAIL_FAILED + **exit 0**（不中断工作流）
//   ③ 人为制造未预期异常 → 顶层兜底捕获 → MAIL_FAILED: 未预期异常 + **exit 0**
//   ④ 工作流 JSON 里是否还残留凭据字符串（b/c 的安全目标）
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
// 凭据落点（2026-10-03 用户约定）：<工作区>/.dag-flow/workflow/config/ 下
const MAILCFG = 'D:/workspace/pluginspace/.dag-flow/workflow/config/mail.json';
const WORKSPACE = 'D:/workspace/pluginspace';
const def = JSON.parse(readFileSync(DEF, 'utf8'));
const raw = readFileSync(DEF, 'utf8');
const code = String(def.nodes.find((n) => n.id === 'mail')?.params?.code ?? '');
const cfg = existsSync(MAILCFG) ? JSON.parse(readFileSync(MAILCFG, 'utf8')) : {};

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
// 报告文件（投递测试用，跑完删）
const reportPath = join(WORKSPACE, '.dag-flow', 'reports', `金融政策日报-${today}.md`);
const hadReport = existsSync(reportPath);
if (!hadReport) {
  mkdirSync(join(WORKSPACE, '.dag-flow', 'reports'), { recursive: true });
  writeFileSync(reportPath, `# 邮件节点非致命性取证用临时文件\n\n（probe 生成，用完即删）\n`, 'utf8');
}
const src = code
  .replace(/\{\{inputs\.收件邮箱\}\}/g, String(def.inputs?.['收件邮箱'] ?? ''))
  .replace(/\{\{py_date\.out\}\}/g, today);

const dir = mkdtempSync(join(tmpdir(), 'mail-nonfatal-'));
const cleanEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
for (const k of ['DAGFLOW_SMTP_HOST', 'DAGFLOW_SMTP_PORT', 'DAGFLOW_SMTP_USER', 'DAGFLOW_SMTP_PASS']) delete cleanEnv[k];

const run = (name, source, cwd) => {
  const f = join(dir, name + '.py');
  writeFileSync(f, source, 'utf8');
  try {
    return { code: 0, out: String(execFileSync(py, [f], { encoding: 'utf8', timeout: 90000, cwd, env: cleanEnv })).trim() };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim(), err: String(e.stderr ?? '').trim() };
  }
};

console.log('== ① 无 mail.json + 无环境变量（旧版在这里 ValueError 崩）==');
{
  const emptyCwd = mkdtempSync(join(tmpdir(), 'no-mailcfg-'));   // 空目录：没有 .dag-flow/mail.json
  const r = run('noconfig', src, emptyCwd);
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_SKIPPED_NO_SMTP'), `状态行 MAIL_SKIPPED_NO_SMTP（${JSON.stringify(r.out.split('\n')[0].slice(0, 90))}）`);
  ok(!/ValueError|Traceback/.test(r.out + (r.err ?? '')), '没有 ValueError/Traceback');
}

console.log('\n== ② 有 mail.json（凭据在本地文件）→ 走真实 SMTP，认证被拒也只报告 ==');
{
  const r = run('withcfg', src, WORKSPACE);
  ok(r.code === 0, `退出码 0（实际 ${r.code}）★ 关键：邮件失败不中断工作流`);
  ok(/^MAIL_(FAILED|SENT)/.test(r.out), `走到了真实发信分支（${JSON.stringify(r.out.split('\n')[0].slice(0, 110))}）`);
  ok(!r.out.includes('MAIL_SKIPPED_NO_SMTP'), '凭据已从本地 mail.json 读到（不再报"未配置"）');
}

console.log('\n== ③ 人为制造未预期异常 → 顶层兜底必须接住 ==');
{
  // 在 main() 里塞一个必抛的语句（模拟"以后又手改坏了某一行"）
  const broken = src.replace('def main():\n', 'def main():\n    raise RuntimeError("probe: 模拟未预期异常")\n');
  ok(broken !== src, '注入点匹配成功（若失败说明 main() 结构变了，需更新本探针）');
  const r = run('broken', broken, WORKSPACE);
  ok(r.code === 0, `退出码 0（实际 ${r.code}）`);
  ok(r.out.includes('MAIL_FAILED') && r.out.includes('未预期异常'), `顶层兜底给出 MAIL_FAILED: 未预期异常（${JSON.stringify(r.out.split('\n')[0].slice(0, 100))}）`);
}

console.log('\n== ④ 工作流 JSON 里不再有凭据（c 的安全目标）==');
{
  // ★ 只有**授权码**是"任何地方都不该出现"的；发件账号在本工作流里同时是收件人
  //   （自发自收），合法地存在于工作流参数「收件邮箱」中，不能作为泄漏判据（本探针第一版即误报）。
  ok(cfg.pass && !raw.includes(String(cfg.pass)), `JSON 里不含授权码（${String(cfg.pass ?? '').length} 字）`);
  ok(!code.includes(String(cfg.user)), 'mail 代码里不含发件账号（账号只出现在工作流参数里）');
  ok(def.inputs?.['收件邮箱'] === cfg.user, `工作流参数「收件邮箱」= 发件账号（自发自收，合法保留）：${def.inputs?.['收件邮箱']}`);
  ok(!/os\.environ\.get\(\s*'DAGFLOW_SMTP_(HOST|USER|PASS)'\s*,\s*'[^']+'/.test(code), 'mail 代码里没有"凭据作为默认值"的写法');
  ok(code.includes('.dag-flow') && code.includes('mail.json'), '代码改为读本地 .dag-flow/mail.json');
  ok(/or '465'/.test(code), 'port 默认值 465（a 项）');
  ok(code.includes('if __name__') && /except Exception as e:/.test(code), '顶层兜底存在（b 项）');
}

if (!hadReport) { try { execFileSync(py, ['-c', `import os;os.remove(r"${reportPath}")`]); } catch { /* 忽略 */ } }
console.log(`\n=== 邮件节点非致命性取证：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
