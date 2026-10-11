# runtime/ocr/ocr_client.py — python 侧的 OCR 客户端（给 python 节点 / 子工作流复用，零第三方依赖）
#
# 为什么需要它：OCR 引擎与两个脚本随插件分发，而工作流里的 python 代码是**内嵌字符串**（没有自己的目录），
#   所以它需要一小段"怎么找到引擎和脚本、怎么起、怎么读结果"的公共逻辑 —— 就是本文件。
#   ★ 引擎定位与 src/adapter/ocr.ts 同一套规矩：插件自带 runtime/ 优先，<DSH_HOME>/runtime/ 兜底。
#
# 对外 API：
#   available() -> (bool, str)                引擎在不在（reason 为空表示可用）
#   ocr_image(path) -> dict                   单图识别，返回脚本回传的 JSON（ok/text/lines/confidence…）
#   ocr_pdf(path, max_pages=20) -> dict       PDF 栅格化 + 识别
#   OcrClientError(code, message)             失败时抛这个（code 与插件侧错误码同名）
#
# 用法（工作流 python 节点里）：
#   sys.path.insert(0, <plugin>/runtime/ocr)   # 或用本文件的 locate_plugin_root()
#   import ocr_client
#   data = ocr_client.ocr_pdf(path, max_pages=10)

import json
import os
import subprocess
import sys

MARK = '__OCR_JSON__'
RAPIDOCR_VERSION = '1.4.4'
DEFAULT_MAX_PAGES = 20


class OcrClientError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def platform_tag():
    """<平台> 目录名，与插件 runtime/ 的分层一致"""
    if sys.platform.startswith('win'):
        return 'win-x64' if (sys.maxsize > 2 ** 32) else 'win-x86'
    if sys.platform == 'darwin':
        return 'mac-arm64' if os.uname().machine == 'arm64' else 'mac-x64'
    machine = ''
    try:
        machine = os.uname().machine
    except Exception:
        machine = ''
    if machine in ('aarch64', 'arm64'):
        return 'linux-arm64'
    return 'linux-x64'


def locate_plugin_root():
    """从 sys.executable 反推插件根：<plugin>/runtime/python/<版本>/<平台>/python.exe → 上四级"""
    p = os.path.dirname(os.path.abspath(sys.executable))
    for _ in range(4):
        p = os.path.dirname(p)
    return p


def ocr_dirs():
    """返回 (插件自带的引擎目录, <DSH_HOME> 兜底的引擎目录, 脚本目录)"""
    root = locate_plugin_root()
    plat = platform_tag()
    bundled = os.path.join(root, 'runtime', 'rapidocr', RAPIDOCR_VERSION, plat)
    home = os.environ.get('DSH_HOME') or os.path.join(os.path.expanduser('~'), '.dsh')
    cached = os.path.join(home, 'runtime', 'rapidocr', RAPIDOCR_VERSION, plat)
    scripts = os.path.join(root, 'runtime', 'ocr')
    return bundled, cached, scripts


def engine_dir():
    bundled, cached, _ = ocr_dirs()
    for d in (bundled, cached):
        if os.path.isfile(os.path.join(d, 'rapidocr_onnxruntime', '__init__.py')):
            return d
    return bundled


def available():
    bundled, cached, scripts = ocr_dirs()
    d = engine_dir()
    if not os.path.isfile(os.path.join(d, 'rapidocr_onnxruntime', '__init__.py')):
        return False, '找不到 OCR 引擎（找过 %s 和 %s）' % (bundled, cached)
    for f in ('rapid_ocr.py', 'pdf_ocr.py'):
        if not os.path.isfile(os.path.join(scripts, f)):
            return False, '缺少 OCR 脚本 %s' % os.path.join(scripts, f)
    return True, ''


def run_script(script_name, payload, timeout=600):
    """起内置 Python 跑 OCR 脚本，读回标记行 JSON"""
    ok, reason = available()
    if not ok:
        raise OcrClientError('OCR_ENGINE_MISSING', reason)
    _, _, scripts = ocr_dirs()
    script = os.path.join(scripts, script_name)
    if not os.path.isfile(script):
        raise OcrClientError('OCR_ENGINE_MISSING', '缺少 OCR 脚本：%s' % script)
    env = dict(os.environ)
    engine = engine_dir()
    env['PYTHONPATH'] = engine + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    try:
        proc = subprocess.run(
            [sys.executable, script],
            input=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, env=env,
        )
    except subprocess.TimeoutExpired:
        raise OcrClientError('OCR_TIMEOUT', 'OCR 超时（%ss）' % timeout)
    out = (proc.stdout or b'').decode('utf-8', 'replace')
    err = (proc.stderr or b'').decode('utf-8', 'replace')
    payload_obj = None
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith(MARK):
            try:
                payload_obj = json.loads(line[len(MARK):].strip())
            except Exception:
                payload_obj = None
            break
    if payload_obj is None:
        tail = (err or out).strip().replace('\n', ' ')[-300:]
        raise OcrClientError('OCR_FAILED', 'OCR 脚本没有返回可解析结果（退出码 %s）：%s' % (proc.returncode, tail))
    if payload_obj.get('ok') is False:
        raise OcrClientError(str(payload_obj.get('code') or 'OCR_FAILED'), str(payload_obj.get('message') or 'OCR 失败'))
    return payload_obj


def ocr_image(path, timeout=180):
    """单张图片 → {text, lines, confidence, durationMs}"""
    return run_script('rapid_ocr.py', {'images': [path]}, timeout=timeout)


def ocr_pdf(path, max_pages=DEFAULT_MAX_PAGES, timeout=600):
    """扫描版 PDF → {text, pages, ocrPages, truncated, confidence, perPage}"""
    return run_script('pdf_ocr.py', {'pdf': path, 'maxPages': int(max_pages or DEFAULT_MAX_PAGES), 'scale': 2}, timeout=timeout)


if __name__ == '__main__':
    # 自带自测：python ocr_client.py <图片或PDF路径>
    ok, why = available()
    print('available=%s %s' % (ok, why))
    print('plugin_root=%s' % locate_plugin_root())
    print('engine=%s' % engine_dir())
    if ok and len(sys.argv) > 1:
        target = sys.argv[1]
        data = ocr_pdf(target) if target.lower().endswith('.pdf') else ocr_image(target)
        print('chars=%s confidence=%s' % (len(data.get('text') or ''), data.get('confidence')))
        print((data.get('text') or '')[:400])
