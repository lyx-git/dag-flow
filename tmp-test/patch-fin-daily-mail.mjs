// tmp-test/patch-fin-daily-mail.mjs — 把「发邮件」节点重新加回「金融政策日报」，并让它**永不失败**
//   背景：用户在画布上删掉了 mail 节点（因为一次没跑成功），要求「这个节点没跑成功要不影响工作流」。
//   ★ 关键约束（既有教训）：DAG 模式下节点失败只会停它自己的下游（2026-10-04 轮 2 前的旧语义是
//     "中断后续层"，当时节点级 onError 也还没进 DAG）→ 稳妥做法仍是容错做在节点自己身上：
//     邮件节点改成「任何问题都打印 MAIL_* 状态并 exit 0」，工作流照样跑完，状态进 log/汇总。
//   本脚本是**就地打补丁**（不重新生成）：保留用户所有编辑（例如已填的「收件邮箱」）与其它节点。
//   可重复执行（幂等）。
import { readFileSync, writeFileSync } from 'node:fs';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';

const mailCode = `# -*- coding: utf-8 -*-
# 把日报发到邮箱（Python 标准库 smtplib，零额外依赖）。
# ★ 这个节点**永不失败**：DAG 模式下节点失败会中断后续层，所以任何问题都只打印 MAIL_* 状态并 exit 0，
#   邮件状态会出现在本节点输出、日志节点和运行汇总里，工作流继续跑完（日报文件已经先落盘了）。
# 环境变量（dsh 进程环境，配好后重启 dsh web）：
#   DAGFLOW_SMTP_HOST=smtp.qq.com / smtp.163.com / smtp.exmail.qq.com ...
#   DAGFLOW_SMTP_PORT=465（SSL）或 587（STARTTLS）
#   DAGFLOW_SMTP_USER=发件账号
#   DAGFLOW_SMTP_PASS=授权码 / 应用专用密码（不是登录密码）
import os, sys, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header
from email.utils import formatdate

def done(status, detail=''):
    # 统一出口：打印状态 + 永远 exit 0
    print('%s%s' % (status, (': ' + detail) if detail else ''))
    sys.exit(0)

MAIL_TO = """{{inputs.收件邮箱}}""".strip()
if not MAIL_TO or '@' not in MAIL_TO:
    done('MAIL_SKIPPED_NO_TO', '工作流参数「收件邮箱」没填（或不是邮箱）——在头部「工作流参数」里填')

host = os.environ.get('DAGFLOW_SMTP_HOST', '').strip()
port = int((os.environ.get('DAGFLOW_SMTP_PORT') or '465').strip() or '465')
user = os.environ.get('DAGFLOW_SMTP_USER', '').strip()
pwd = os.environ.get('DAGFLOW_SMTP_PASS', '').strip()
if not (host and user and pwd):
    done('MAIL_SKIPPED_NO_SMTP', '未配置 DAGFLOW_SMTP_HOST / DAGFLOW_SMTP_USER / DAGFLOW_SMTP_PASS'
         '（qq/163 邮箱用「授权码」而不是登录密码）')

day = """{{py_date.out}}""".strip()
md_path = os.path.join('.dag-flow', 'reports', '金融政策日报-%s.md' % day)
if not os.path.exists(md_path):
    done('MAIL_SKIPPED_NO_DOC', '没找到日报文件 %s（前一步 file_save 可能失败了）' % md_path)
try:
    with open(md_path, 'r', encoding='utf-8') as f:
        body = f.read()
except Exception as e:
    done('MAIL_SKIPPED_READ', '%s: %s' % (type(e).__name__, e))

msg = MIMEMultipart()
msg['Subject'] = Header('金融政策日报 %s' % day, 'utf-8')
msg['From'] = user
msg['To'] = MAIL_TO
msg['Date'] = formatdate(localtime=True)
msg.attach(MIMEText(body, 'plain', 'utf-8'))
att = MIMEApplication(body.encode('utf-8'))
att.add_header('Content-Disposition', 'attachment', filename=('utf-8', '', '金融政策日报-%s.md' % day))
msg.attach(att)

try:
    if port == 465:
        s = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        s = smtplib.SMTP(host, port, timeout=30)
        s.starttls()
    s.login(user, pwd)
    s.sendmail(user, [MAIL_TO], msg.as_string())
    s.quit()
except Exception as e:
    done('MAIL_FAILED', '%s: %s（检查授权码/端口/邮箱是否开通 SMTP 服务）' % (type(e).__name__, e))

done('MAIL_SENT', '%s（正文 %d 字 + 附件 %s）' % (MAIL_TO, len(body), os.path.basename(md_path)))`;

const def = JSON.parse(readFileSync(DEF, 'utf8'));
const log = [];

// ---------- 1. 补回 mail 节点（已存在则更新代码，保留其它字段）----------
const MAIL = {
  id: 'mail',
  type: 'python',
  label: '发邮件（smtplib · 失败不影响流程）',
  params: { code: mailCode, timeoutMs: 60000 },
};
let mailNode = def.nodes.find((n) => n.id === 'mail');
if (!mailNode) {
  const saveIdx = def.nodes.findIndex((n) => n.id === 'save_doc');
  def.nodes.splice(saveIdx >= 0 ? saveIdx + 1 : def.nodes.length, 0, MAIL);
  mailNode = MAIL;
  log.push('＋ 新增 mail 节点（发邮件 · 永不失败）');
} else {
  mailNode.type = 'python';
  mailNode.label = MAIL.label;
  mailNode.params = { ...(mailNode.params ?? {}), ...MAIL.params };
  log.push('↻ mail 节点已存在 → 更新为「永不失败」版本');
}

// ---------- 2. 重连边：save_doc → mail → log_done（去掉任何残留的旧连线）----------
def.edges = (def.edges ?? []).filter((e) => e.from !== 'mail' && e.to !== 'mail');
const before = def.edges.length;
def.edges = def.edges.filter((e) => !(e.from === 'save_doc' && e.to === 'log_done'));
const insertAt = def.edges.findIndex((e) => e.from === 'log_done') >= 0
  ? def.edges.findIndex((e) => e.from === 'log_done')
  : def.edges.length;
def.edges.splice(insertAt, 0, { from: 'mail', to: 'log_done' });
def.edges.splice(insertAt, 0, { from: 'save_doc', to: 'mail' });
log.push(`↻ 重连边：save_doc → mail → log_done（边数 ${before} → ${def.edges.length}）`);

// ---------- 3. 同步 next（画布语义：next 与 edges 必须一致）----------
const setNext = (id, next) => {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) return;
  n.next = next;
};
for (const n of def.nodes) if (n.id === 'mail') delete n.next;
setNext('save_doc', 'mail');
setNext('mail', 'log_done');
setNext('log_done', 'end');

// ---------- 4. 画布布局：给 mail 一个位置（在 save_doc 与 log_done 之间）----------
def.layout = def.layout ?? {};
if (!def.layout.mail) {
  const a = def.layout.save_doc ?? { x: 1520, y: 360 };
  const b = def.layout.log_done ?? { x: 1520, y: 660 };
  def.layout.mail = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) - 60 };
  log.push('＋ 布局：给 mail 补了画布坐标');
}

// ---------- 5. 自检（写盘前）：引用 / next↔edges 一致 / 必填 / 无环 ----------
const errs = [];
const ids = new Set(def.nodes.map((n) => n.id));
const refs = new Set();
const scan = (v) => {
  if (typeof v === 'string') { for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\./g)) refs.add(m[1]); }
  else if (v && typeof v === 'object') { for (const x of Object.values(v)) scan(x); }
};
for (const n of def.nodes) scan(n.params);
for (const r of refs) if (!['inputs', 'vars', 'results'].includes(r) && !ids.has(r)) errs.push(`模板引用不存在的节点：${r}`);
for (const e of def.edges) if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`边指向不存在的节点：${e.from}→${e.to}`);
for (const n of def.nodes) {
  const fromEdges = def.edges.filter((e) => e.from === n.id).map((e) => e.to);
  const nextList = n.next === undefined ? [] : (Array.isArray(n.next) ? n.next : [n.next]);
  if (fromEdges.length !== nextList.length || !fromEdges.every((t) => nextList.includes(t))) {
    // start/end 等允许 next 省略时跳过 start 的旧写法检查
    errs.push(`next 与 edges 不一致：${n.id} edges=[${fromEdges}] next=[${nextList}]`);
  }
}
{
  const adj = new Map(def.nodes.map((n) => [n.id, def.edges.filter((e) => e.from === n.id).map((e) => e.to)]));
  const st = new Map();
  const dfs = (id) => {
    if (st.get(id) === 1) { errs.push('存在环：经过 ' + id); return; }
    if (st.get(id) === 2) return;
    st.set(id, 1);
    for (const t of adj.get(id) ?? []) dfs(t);
    st.set(id, 2);
  };
  for (const n of def.nodes) dfs(n.id);
}
const REQUIRED = { web_search: ['query'], web_fetch: ['url'], subagent: ['prompt', 'model'], file_save: ['filename'], log: ['message'], set_var: ['vars'], python: [] };
for (const n of def.nodes) for (const k of REQUIRED[n.type] ?? []) {
  if (n.params?.[k] === undefined || n.params[k] === '') errs.push(`${n.id} 缺必填参数 ${k}`);
}
if (errs.length) {
  console.error('✗ 自检未通过，未写盘：');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

writeFileSync(DEF, JSON.stringify(def, null, 2) + '\n', 'utf8');
for (const l of log) console.log(l);
console.log(`✓ 已写盘 ${DEF}（节点 ${def.nodes.length} / 边 ${def.edges.length}）`);
console.log('  邮件节点语义：任何问题都 exit 0 + 打印 MAIL_* 状态 → **不会中断工作流**');
console.log('  收件邮箱（保留你的设置）：' + JSON.stringify(def.inputs?.['收件邮箱'] ?? ''));
