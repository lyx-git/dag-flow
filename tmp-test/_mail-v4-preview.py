# -*- coding: utf-8 -*-
# 把日报发到邮箱（Python 标准库 smtplib，零额外依赖）。v4 · 2026-10-04
# ★ v4 变更（用户要求「不要落盘，直接发送邮件」）：日报正文不再写盘、也不再当附件——
#   由上游 ai_matrix 的输出经模板注入本文（REPORT），直接作为邮件正文发出，本节点不读任何文件。
#   邮件是 multipart/alternative：纯文本 + 极简渲染的 HTML（结论成段、详情成真正的表格）。
# ★ 凭据发现顺序：DAGFLOW_MAIL_CONFIG 环境变量 → 下方 WORKSPACE_HINT 指向的工作区 → cwd 及其祖先。
#   为什么需要 WORKSPACE_HINT：python 节点的 cwd 继承宿主进程（≠ 工作区）；旧版是靠上游 file_save
#   节点的绝对路径反推工作区的，v4 不落盘后该锚点消失，故把工作区路径写在这里作为提示。
#   换工作区/换机器时改这一行，或设环境变量 DAGFLOW_MAIL_CONFIG 指向配置文件（环境变量优先）。
#   环境变量永远优先覆盖文件内容：DAGFLOW_SMTP_HOST / PORT(465=SSL，否则 STARTTLS) / USER / PASS
#   本地文件格式：{"host":"smtp.163.com","port":465,"user":"you@163.com","pass":"授权码"}
#   ★ 约定（2026-10-03 用户指令）：配置文件放 .dag-flow/workflow/config/mail.json
#     （listJsonNames 会跳过目录与点号开头的文件，所以放子目录或用点号命名）。
# ★ 永不失败：任何问题都打印 MAIL_* 状态并 exit 0；main() 外面还有一层顶层兜底。
import json, os, smtplib, sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formatdate

# ★ 用原始字符串且让内容独占一行：正文可能以反斜杠结尾，紧贴引号会让原始字符串语法出错。
REPORT = r'''
# 金融政策日报 · 2026-10-07

结论（不超过 200 字）：央行 10-07 宣布降准 0.5 个百分点，释放长期资金约 1 万亿，方向偏积极；
同期美联储会议纪要偏鹰，海外利率上行对港股与成长板块形成压制。国内流动性宽松与外部紧缩并存，
银行、地产受益于宽松预期，券商与半导体短期承压。建议重点跟踪后续社融数据与外资流向。

详情

| # | 事件 / 政策 | 类别 | 影响方向 | 受影响板块 | 影响逻辑 | 来源 |
|---|---|---|---|---|---|---|
| 1 | 央行宣布降准 0.5 个百分点（10-07） | 国内 | 积极 | 银行、地产 | 释放长期流动性，降低负债成本 | 央行官网 |
| 2 | 美联储会议纪要偏鹰（10-06） | 国际 | 消极 | 券商、半导体 | 美债收益率上行压制成长股估值 | 路透 |
'''.strip()
DAY = '''2026-10-07'''.strip()
# 本机工作区路径提示（仅用于找凭据文件；环境变量 DAGFLOW_MAIL_CONFIG 优先）
WORKSPACE_HINT = r'''D:\workspace\pluginspace'''


def done(status, detail=''):
    print('%s%s' % (status, (': ' + detail) if detail else ''))
    sys.exit(0)


def _ok(p):
    return bool(p) and p.lower() not in ('none', 'null', '')


def dagflow_candidates():
    """按可靠性排序的 .dag-flow 候选目录：①WORKSPACE_HINT ②DAGFLOW_MAIL_CONFIG 所在目录 ③cwd 及其祖先"""
    out = []
    if _ok(WORKSPACE_HINT):
        out.append(os.path.join(os.path.abspath(WORKSPACE_HINT), '.dag-flow'))
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


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _is_table_sep(ln):
    s = ln.strip()
    if not s.startswith('|'):
        return False
    body = s.strip('|')
    if '-' not in body:
        return False
    for ch in body:
        if ch not in '-:| \t':
            return False
    return True


def _cells(ln):
    return [c.strip() for c in ln.strip().strip('|').split('|')]


def render_html(text):
    """极简 Markdown → HTML：标题行 / Markdown 表格 / 普通段落。
    只覆盖本工作流终稿的形态（# 标题、| 表格 |、段落），不做通用解析；失败由调用方兜底。"""
    lines = text.split('\n')
    out, i = [], 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if ln.strip().startswith('|') and i + 1 < len(lines) and _is_table_sep(lines[i + 1]):
            out.append('<table border="1" cellspacing="0" cellpadding="6" '
                       'style="border-collapse:collapse;font-size:13px">')
            out.append('<tr>' + ''.join('<th align="left">%s</th>' % _esc(c) for c in _cells(ln)) + '</tr>')
            i += 2
            while i < len(lines) and lines[i].strip().startswith('|'):
                out.append('<tr>' + ''.join('<td>%s</td>' % _esc(c) for c in _cells(lines[i])) + '</tr>')
                i += 1
            out.append('</table>')
            continue
        s = ln.strip()
        if s.startswith('#'):
            out.append('<h3>%s</h3>' % _esc(s.lstrip('#').strip()))
        elif s:
            out.append('<p>%s</p>' % _esc(s))
        i += 1
    return '\n'.join(out)


def main():
    MAIL_TO = """sample@example.com""".strip()
    if not MAIL_TO or '@' not in MAIL_TO:
        done('MAIL_SKIPPED_NO_TO', '工作流参数「收件邮箱」没填（或不是邮箱）——在头部「工作流参数」里填')
    if not _ok(REPORT):
        done('MAIL_SKIPPED_EMPTY', '上游没有产出日报正文（ai_matrix 输出为空）')

    cfg, cfg_path, tried_cfg = load_cfg()
    host = (cfg.get('host') or '').strip()
    user = (cfg.get('user') or '').strip()
    pwd = (cfg.get('pass') or '').strip()
    try:
        port = int((cfg.get('port') or '465').strip() or '465')
    except ValueError:
        done('MAIL_FAILED', 'SMTP 端口不是数字：%r（应为 465 或 587）' % cfg.get('port'))
    if not (host and user and pwd):
        done('MAIL_SKIPPED_NO_SMTP',
             '未配置 SMTP。找过：%s；cwd=%s。请设环境变量 DAGFLOW_SMTP_HOST/USER/PASS，'
             '或把凭据写进 <工作区>/.dag-flow/workflow/config/mail.json（本节点代码里的 WORKSPACE_HINT 指向它）'
             % (' | '.join(tried_cfg[:4]) or '(无候选)', os.getcwd()))

    msg = MIMEMultipart('alternative')
    msg['Subject'] = Header('金融政策日报 %s' % DAY, 'utf-8')
    msg['From'] = user
    msg['To'] = MAIL_TO
    msg['Date'] = formatdate(localtime=True)
    msg.attach(MIMEText(REPORT, 'plain', 'utf-8'))
    try:
        html = render_html(REPORT)
        if html:
            msg.attach(MIMEText(html, 'html', 'utf-8'))
    except Exception as e:   # HTML 渲染失败只影响观感，绝不影响发信
        sys.stderr.write('[mail] HTML 渲染失败（改用纯文本）：%s: %s\n' % (type(e).__name__, e))

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

    done('MAIL_SENT', '%s（结论+详情表格，正文 %d 字，已直接发送、未落盘；凭据 %s）'
         % (MAIL_TO, len(REPORT), cfg_path or '环境变量'))


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
