// tmp-test/patch-fin-daily-mail2.mjs — 邮件节点改造（用户拍板 a + b + c，2026-10-03）
//   a) 修 port：默认 465（旧写法 int((env or '') or '') 在未设环境变量时抛 ValueError → 退出码非 0 → DAG 中断）
//   b) 顶层兜底：整个 main() 包在 try/except 里，**任何未预期异常**都打印 MAIL_FAILED 并 exit 0
//   c) 凭据搬出工作流：环境变量优先 → 本地 .dag-flow/mail.json 兜底；工作流 JSON 里不再有授权码
//   就地打补丁、幂等；把现有凭据**原样迁移**到 mail.json（已存在则不覆盖已有键）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const MAILCFG = 'D:/workspace/pluginspace/.dag-flow/mail.json';

const newCode = `# -*- coding: utf-8 -*-
# 把日报发到邮箱（Python 标准库 smtplib，零额外依赖）。
# ★ 永不失败（2026-10-03 改造）：
#   ① port 有默认值 465 —— 旧写法 int((env or '') or '') 在环境变量未设时会抛 ValueError，
#      退出码非 0 → DAG 模式下节点失败**中断后续层**（真机实测过）。
#   ② **整脚本顶层兜底**：done() 只能覆盖"预料到的"失败路径，任何它之外的异常都会以非 0 退出码结束，
#      所以 main() 外面再包一层 try/except —— 未预期异常也只打印 MAIL_FAILED 并 exit 0。
#   ③ 凭据不再写在工作流里：**环境变量优先，本地 .dag-flow/mail.json 兜底**
#      DAGFLOW_SMTP_HOST / DAGFLOW_SMTP_PORT(465=SSL，否则 STARTTLS) / DAGFLOW_SMTP_USER / DAGFLOW_SMTP_PASS
#      本地文件格式：{"host":"smtp.163.com","port":465,"user":"you@163.com","pass":"授权码"}
#      （qq/163 用「授权码」或应用专用密码，不是登录密码）
import json, os, sys, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header
from email.utils import formatdate

MAIL_CFG_PATH = os.path.join('.dag-flow', 'mail.json')


def done(status, detail=''):
    # 统一出口：状态行 + 永远 exit 0
    print('%s%s' % (status, (': ' + detail) if detail else ''))
    sys.exit(0)


def load_smtp_config():
    """凭据来源：本地 .dag-flow/mail.json 兜底，**环境变量优先覆盖**（线上/CI 可用环境变量换掉本机文件）"""
    cfg = {}
    if os.path.exists(MAIL_CFG_PATH):
        try:
            with open(MAIL_CFG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg = {k: ('' if v is None else str(v)) for k, v in data.items()}
        except Exception as e:
            # 配置读不出来不该拖垮流程：stderr 记一笔，按"未配置"继续
            sys.stderr.write('[mail] 读取 %s 失败：%s: %s\\n' % (MAIL_CFG_PATH, type(e).__name__, e))
    for env_key, key in (('DAGFLOW_SMTP_HOST', 'host'), ('DAGFLOW_SMTP_PORT', 'port'),
                         ('DAGFLOW_SMTP_USER', 'user'), ('DAGFLOW_SMTP_PASS', 'pass')):
        v = (os.environ.get(env_key) or '').strip()
        if v:
            cfg[key] = v
    return cfg


def main():
    MAIL_TO = """{{inputs.收件邮箱}}""".strip()
    if not MAIL_TO or '@' not in MAIL_TO:
        done('MAIL_SKIPPED_NO_TO', '工作流参数「收件邮箱」没填（或不是邮箱）——在头部「工作流参数」里填')

    cfg = load_smtp_config()
    host = (cfg.get('host') or '').strip()
    user = (cfg.get('user') or '').strip()
    pwd = (cfg.get('pass') or '').strip()
    try:
        port = int((cfg.get('port') or '465').strip() or '465')   # ★ 默认 465：空串不再是崩溃点
    except ValueError:
        done('MAIL_FAILED', 'SMTP 端口不是数字：%r（应为 465 或 587）' % cfg.get('port'))
    if not (host and user and pwd):
        done('MAIL_SKIPPED_NO_SMTP',
             '未配置 SMTP：请设环境变量 DAGFLOW_SMTP_HOST/USER/PASS，或在本机建 .dag-flow/mail.json'
             '（{"host","port","user","pass"}；qq/163 用「授权码」而不是登录密码）')

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

    done('MAIL_SENT', '%s（正文 %d 字 + 附件 %s）' % (MAIL_TO, len(body), os.path.basename(md_path)))


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise                      # done() 的正常出口
    except Exception as e:         # ★ 顶层兜底：未预期异常也不中断工作流
        import traceback
        print('MAIL_FAILED: 未预期异常 %s: %s（已兜底，不影响后续节点）' % (type(e).__name__, e))
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)
`;

const def = JSON.parse(readFileSync(DEF, 'utf8'));
const mail = def.nodes.find((n) => n.id === 'mail');
if (!mail) { console.error('✗ 找不到 mail 节点'); process.exit(1); }
const oldCode = String(mail.params?.code ?? '');
const nodesBefore = def.nodes.length, edgesBefore = def.edges.length;

// ---- 1. 从旧代码里把现有凭据抽出来（用户之前写成了 os.environ.get 的默认值）----
const grab = (key) => {
  const m = oldCode.match(new RegExp(`DAGFLOW_SMTP_${key}'\\s*,\\s*'([^']*)'`));
  return m ? m[1] : '';
};
const oldHost = grab('HOST'), oldUser = grab('USER'), oldPass = grab('PASS');
const oldPortM = oldCode.match(/DAGFLOW_SMTP_PORT'\)\s*or\s*'(\d+)'/);

// ---- 2. 写/补 .dag-flow/mail.json（已存在则保留已有键，只补缺）----
let cfg = {};
if (existsSync(MAILCFG)) {
  try { cfg = JSON.parse(readFileSync(MAILCFG, 'utf8')) ?? {}; } catch { cfg = {}; }
}
const before = { ...cfg };
if (!cfg.host && oldHost) cfg.host = oldHost;
if (!cfg.port) cfg.port = Number(oldPortM?.[1] ?? 465);
if (!cfg.user && oldUser) cfg.user = oldUser;
if (!cfg.pass && oldPass) cfg.pass = oldPass;
writeFileSync(MAILCFG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

// ---- 3. 换代码 ----
mail.params = { ...(mail.params ?? {}), code: newCode };

// ---- 4. 自检（写盘前）----
const errs = [];
if (!newCode.includes('{{inputs.收件邮箱}}') || !newCode.includes('{{py_date.out}}')) errs.push('新代码丢了模板占位符');
if (newCode.includes('{{py_date.out}}') === false) errs.push('新代码丢了 {{py_date.out}}');
if (/os\.environ\.get\(\s*'DAGFLOW_SMTP_(HOST|USER|PASS)'\s*,\s*'[^']+'/.test(newCode)) errs.push('新代码里仍有凭据默认值');
// ★ 注意：不能拿 /DAGFLOW_SMTP_(HOST|USER|PASS)', '[^']+'/ 这种宽判据——代码里本来就有
//   ('DAGFLOW_SMTP_HOST', 'host') 这种"环境变量名 → 配置键"的映射元组，会被误报（本脚本第一版即踩）。
for (const s of [oldPass, oldUser].filter((x) => x && x.length > 3)) {
  if (newCode.includes(s)) errs.push('新代码里仍残留旧凭据字符串');
}
if (def.nodes.length !== nodesBefore || def.edges.length !== edgesBefore) errs.push('节点/边数量被改动');
if (mail.next !== 'log_done') errs.push(`mail.next 被改动：${mail.next}`);
if (errs.length) { console.error('✗ 自检未通过：'); for (const e of errs) console.error('  - ' + e); process.exit(1); }

writeFileSync(DEF, JSON.stringify(def, null, 2) + '\n', 'utf8');

const mask = (s) => s ? `${s.length} 字（${s.slice(0, 2)}***）` : '（无）';
console.log('✓ 已写盘');
console.log('  a) port 默认 465：' + (newCode.includes("or '465'"), '已改（空串不再 ValueError）'));
console.log('  b) 顶层兜底：' + (newCode.includes('if __name__ ==') && newCode.includes('except Exception as e:') ? '已加（未预期异常 → MAIL_FAILED + exit 0）' : '缺失'));
console.log('  c) 凭据搬出工作流 → ' + MAILCFG);
console.log(`     host=${mask(cfg.host)} user=${mask(cfg.user)} pass=${mask(cfg.pass)} port=${cfg.port}`);
console.log(`     迁移前 mail.json 已有键：${Object.keys(before).join(',') || '（文件不存在）'}`);
console.log(`  工作流 JSON 里是否还残留旧授权码：${newCode.includes(oldPass) || JSON.stringify(def).includes(oldPass) ? '★ 是（异常）' : '否'}`);
console.log(`  节点 ${def.nodes.length} / 边 ${def.edges.length}（结构未动）`);
