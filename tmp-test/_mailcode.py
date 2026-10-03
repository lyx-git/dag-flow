# -*- coding: utf-8 -*-
# 把日报发到邮箱（Python 标准库 smtplib，零额外依赖）。v3 · 2026-10-03
# ★ 路径不再依赖"当前工作目录"！python 节点的 cwd 默认继承**宿主进程**（≠ 工作区），
#   旧版按 ./.dag-flow/mail.json、./.dag-flow/reports/... 找文件，真机上必然找不到
#   → 表现为 MAIL_SKIPPED_NO_SMTP（2026-10-03 用户截图就是这个）。现在改为从 save_doc 的
#   **绝对路径**反推：DOC = <工作区>/.dag-flow/reports/金融政策日报-<日期>.md → .dag-flow = 上两级。
# 凭据来源（优先级）：DAGFLOW_MAIL_CONFIG 指定文件 → 约定位置 <工作区>/.dag-flow/workflow/config/mail.json
#   → .dag-flow/workflow/.mail.json（点号开头，不进工作流列表）→ .dag-flow/mail.json（旧位置兼容）
#   环境变量永远优先覆盖文件内容：DAGFLOW_SMTP_HOST / PORT(465=SSL，否则 STARTTLS) / USER / PASS
#   本地文件格式：{"host":"smtp.163.com","port":465,"user":"you@163.com","pass":"授权码"}
#   ★ 约定（2026-10-03 用户指令「和工作流相关的配置文件，都放到 .dag-flow/workflow/ 下面」）：
#     配置文件放 .dag-flow/workflow/ 下；为免被工作流列表当成工作流，放进子目录 config/ 或用 . 开头命名
#     （listJsonNames 会跳过目录与点号开头的文件）。
# ★ 永不失败：任何问题都打印 MAIL_* 状态并 exit 0；main() 外面还有一层顶层兜底。
import glob, json, os, smtplib, sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header
from email.utils import formatdate

# 由 file_save 节点注入的绝对路径（模板在运行期替换）。
# ★ 必须用**原始字符串** r"""..."""：Windows 路径里的 （eports）、w（workspace）等都是 Python 转义序列，
#   普通三引号里  会变成回车 → 路径被改写、反推 .dag-flow 失败（本版第一稿实测就是这个坑）。
DOC_PATH = r"""{{save_doc.out.absolutePath}}""".strip()
DAY = """{{py_date.out}}""".strip()


def done(status, detail=''):
    print('%s%s' % (status, (': ' + detail) if detail else ''))
    sys.exit(0)


def _ok(p):
    return bool(p) and p.lower() not in ('none', 'null', '')


def dagflow_candidates():
    """按可靠性排序的 .dag-flow 候选目录：①DOC 反推 ②DAGFLOW_MAIL_CONFIG 所在目录 ③cwd 及其祖先"""
    out = []
    if _ok(DOC_PATH):
        d = os.path.dirname(os.path.abspath(DOC_PATH))
        for _ in range(4):
            if os.path.basename(d) == '.dag-flow':
                out.append(d)
                break
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
        out.append(os.path.dirname(os.path.abspath(DOC_PATH)))
    envcfg = (os.environ.get('DAGFLOW_MAIL_CONFIG') or '').strip()
    if envcfg:
        out.append(os.path.dirname(os.path.abspath(envcfg)))
    d = os.getcwd()
    for _ in range(6):
        out.append(d)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    seen, uniq = set(), []
    for p in out:
        k = os.path.normcase(os.path.abspath(p))
        if k not in seen:
            seen.add(k)
            uniq.append(os.path.abspath(p))
    return uniq


def cfg_paths(base):
    """一个候选根目录下的所有配置文件位置（按优先级）。带 .dag-flow 前缀的形态用于 base=工作区根的情况。"""
    return [
        os.path.join(base, 'workflow', 'config', 'mail.json'),   # ★ 约定位置
        os.path.join(base, 'workflow', '.mail.json'),             # 同目录但点号开头
        os.path.join(base, 'mail.json'),                          # .dag-flow 根
        os.path.join(base, '.dag-flow', 'workflow', 'config', 'mail.json'),
        os.path.join(base, '.dag-flow', 'mail.json'),             # 旧位置（兼容）
    ]


def find_mail_json():
    envcfg = (os.environ.get('DAGFLOW_MAIL_CONFIG') or '').strip()
    if envcfg and os.path.exists(envcfg):
        return envcfg, [envcfg]
    tried = []
    for base in dagflow_candidates():
        for p in cfg_paths(base):
            if p not in tried:
                tried.append(p)
                if os.path.exists(p):
                    return p, tried
    return None, tried


def find_doc():
    if _ok(DOC_PATH) and os.path.exists(DOC_PATH):
        return DOC_PATH, [DOC_PATH]
    tried = []
    names = ['金融政策日报-%s.md' % DAY, '金融政策日报.md']
    for base in dagflow_candidates():
        for sub in (os.path.join(base, 'reports'), os.path.join(base, '.dag-flow', 'reports')):
            for n in names:
                p = os.path.join(sub, n)
                if p not in tried:
                    tried.append(p)
                    if os.path.exists(p):
                        return p, tried
    for base in dagflow_candidates():   # 兜底：目录里翻名字匹配的最新一份
        for pat in ('reports/金融政策日报*.md', '.dag-flow/reports/金融政策日报*.md'):
            hits = sorted(glob.glob(os.path.join(base, pat)))
            if hits:
                return hits[-1], tried
    return None, tried


def load_cfg():
    path, tried = find_mail_json()
    cfg = {}
    if path:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg = {k: ('' if v is None else str(v)) for k, v in data.items()}
        except Exception as e:
            sys.stderr.write('[mail] 读取 %s 失败：%s: %s\n' % (path, type(e).__name__, e))
    for env_key, key in (('DAGFLOW_SMTP_HOST', 'host'), ('DAGFLOW_SMTP_PORT', 'port'),
                         ('DAGFLOW_SMTP_USER', 'user'), ('DAGFLOW_SMTP_PASS', 'pass')):
        v = (os.environ.get(env_key) or '').strip()
        if v:
            cfg[key] = v
    return cfg, path, tried


def main():
    MAIL_TO = """{{inputs.收件邮箱}}""".strip()
    if not MAIL_TO or '@' not in MAIL_TO:
        done('MAIL_SKIPPED_NO_TO', '工作流参数「收件邮箱」没填（或不是邮箱）——在头部「工作流参数」里填')

    cfg, cfg_path, tried_cfg = load_cfg()
    host = (cfg.get('host') or '').strip()
    user = (cfg.get('user') or '').strip()
    pwd = (cfg.get('pass') or '').strip()
    try:
        port = int((cfg.get('port') or '465').strip() or '465')
    except ValueError:
        done('MAIL_FAILED', 'SMTP 端口不是数字：%r（应为 465 或 587）' % cfg.get('port'))
    if not (host and user and pwd):
        # ★ 失败信息自带诊断：找过哪些路径、cwd 是什么（省得再截图问）
        done('MAIL_SKIPPED_NO_SMTP',
             '未配置 SMTP。找过：%s；cwd=%s。请设环境变量 DAGFLOW_SMTP_HOST/USER/PASS，'
             '或按约定把凭据写进 <工作区>/.dag-flow/workflow/config/mail.json（推荐第一个候选）'
             % (' | '.join(tried_cfg[:4]) or '(无候选)', os.getcwd()))

    doc, tried_doc = find_doc()
    if not doc:
        done('MAIL_SKIPPED_NO_DOC', '没找到日报文件。找过：%s' % (' | '.join(tried_doc[:4]) or '(无候选)'))
    try:
        with open(doc, 'r', encoding='utf-8') as f:
            body = f.read()
    except Exception as e:
        done('MAIL_SKIPPED_READ', '%s: %s（%s）' % (type(e).__name__, e, doc))

    msg = MIMEMultipart()
    msg['Subject'] = Header('金融政策日报 %s' % DAY, 'utf-8')
    msg['From'] = user
    msg['To'] = MAIL_TO
    msg['Date'] = formatdate(localtime=True)
    msg.attach(MIMEText(body, 'plain', 'utf-8'))
    att = MIMEApplication(body.encode('utf-8'))
    att.add_header('Content-Disposition', 'attachment', filename=('utf-8', '', os.path.basename(doc)))
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
        done('MAIL_FAILED', '%s: %s（检查授权码/端口/邮箱是否开通 SMTP 服务；凭据来自 %s）'
             % (type(e).__name__, e, cfg_path or '环境变量'))

    done('MAIL_SENT', '%s（正文 %d 字 + 附件 %s；凭据 %s）'
         % (MAIL_TO, len(body), os.path.basename(doc), cfg_path or '环境变量'))


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        import traceback
        print('MAIL_FAILED: 未预期异常 %s: %s（已兜底，不影响后续节点）' % (type(e).__name__, e))
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)
