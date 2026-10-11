#!/usr/bin/env python
# runtime/ocr/pdf_ocr.py — 扫描版 PDF 的「栅格化 + OCR」壳（轮 3；被 src/adapter/ocr.ts 用内置 Python 启动）
#
# 契约（与适配层 ocrPdf() 一一对应，改动必须两边同步）：
#   入参：stdin 一行 JSON —— {"pdf": "<PDF 绝对路径>", "maxPages": 20, "scale": 2}
#   出参：stdout 一行带标记的 JSON —— __OCR_JSON__ {"ok":true,"text":…,"pages":总页数,"ocrPages":实际识别页数,
#          "truncated":bool,"confidence":…,"durationMs":…,"perPage":[{"page":1,"lines":3,"chars":74}, …]}
#                                  或 __OCR_JSON__ {"ok":false,"code":"OCR_*","message":"…"}
#   退出码：0 成功 / 2 入参问题 / 3 引擎或 pdfium 导入/初始化失败 / 4 打开或渲染 PDF 失败
# ★ 除标记行外一切输出走 stderr（与 rapid_ocr.py 同一约定）。
# ★ pypdfium2 = Apache-2.0 + PDFium BSD 系，**刻意避开 AGPL 的 PyMuPDF**。
# ★ 渲染用 scale=2（约 150dpi）；大页面可调大，但内存与耗时同步上升。

import json
import sys
import time

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from rapid_ocr import emit, read_result  # noqa: E402  （与 rapid_ocr.py 共用一个出口/解析）

DEFAULT_SCALE = 2
MAX_PAGES_HARD = 200


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except Exception:
            pass

    try:
        req = json.loads(sys.stdin.read() or '{}')
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_FAILED', 'message': '入参不是合法 JSON：%s' % e})
        return 2

    pdf_path = str(req.get('pdf') or '').strip()
    if not pdf_path:
        emit({'ok': False, 'code': 'OCR_PDF_FAILED', 'message': '没给 PDF 路径'})
        return 2

    try:
        max_pages = int(req.get('maxPages') or 20)
    except Exception:
        max_pages = 20
    max_pages = max(1, min(max_pages, MAX_PAGES_HARD))
    try:
        scale = float(req.get('scale') or DEFAULT_SCALE)
    except Exception:
        scale = DEFAULT_SCALE
    scale = max(1.0, min(scale, 5.0))

    started = time.time()
    try:
        import pypdfium2 as pdfium  # type: ignore
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_INIT_FAILED',
              'message': '无法导入 pypdfium2（扫描版 PDF 需要它来把页面渲染成图片）：%s' % e})
        return 3
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_INIT_FAILED', 'message': '无法导入 rapidocr_onnxruntime：%s' % e})
        return 3

    try:
        engine = RapidOCR()
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_INIT_FAILED', 'message': 'OCR 引擎初始化失败：%s' % e})
        return 3

    try:
        doc = pdfium.PdfDocument(pdf_path)
        total_pages = len(doc)
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_PDF_FAILED', 'message': '打不开这个 PDF：%s' % e})
        return 4

    if total_pages == 0:
        emit({'ok': False, 'code': 'OCR_PDF_FAILED', 'message': '这个 PDF 没有任何页面'})
        return 4

    limit = min(total_pages, max_pages)
    lines = []
    scores = []
    per_page = []
    for i in range(limit):
        try:
            page = doc[i]
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
        except Exception as e:
            emit({'ok': False, 'code': 'OCR_PDF_FAILED', 'message': '第 %d 页渲染失败：%s' % (i + 1, e)})
            return 4
        try:
            out = engine(image)
        except Exception as e:
            emit({'ok': False, 'code': 'OCR_FAILED', 'message': '第 %d 页识别失败：%s' % (i + 1, e)})
            return 4
        result = out[0] if isinstance(out, tuple) and len(out) >= 1 else out
        page_lines = 0
        page_chars = 0
        for text, score in read_result(result):
            if text.strip():
                lines.append(text)
                scores.append(score)
                page_lines += 1
                page_chars += len(text)
        per_page.append({'page': i + 1, 'lines': page_lines, 'chars': page_chars})

    text = '\n'.join(lines)
    emit({
        'ok': True,
        'text': text,
        'pages': total_pages,
        'ocrPages': limit,
        'truncated': total_pages > limit,
        'confidence': (sum(scores) / len(scores)) if scores else 0.0,
        'durationMs': int((time.time() - started) * 1000),
        'perPage': per_page,
    })
    return 0


if __name__ == '__main__':
    sys.exit(main())
