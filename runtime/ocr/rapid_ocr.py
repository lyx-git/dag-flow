#!/usr/bin/env python
# runtime/ocr/rapid_ocr.py — RapidOCR 调用壳（随插件分发，被 src/adapter/ocr.ts 用内置 Python 启动）
#
# 契约（与适配层一一对应，改动必须两边同步）：
#   入参：stdin 一行 JSON —— {"images": ["<图片绝对路径>", ...]}
#   出参：stdout 一行带标记的 JSON —— __OCR_JSON__ {"ok":true,"text":…,"lines":…,"confidence":…,"durationMs":…}
#                                  或 __OCR_JSON__ {"ok":false,"code":"OCR_*","message":"…"}
#   退出码：0 成功 / 2 入参问题 / 3 引擎导入或初始化失败 / 4 识别失败
# ★ 除了那行带标记的 JSON，**其它一切输出都走 stderr**（OCR 库自己会往 stdout 打日志，
#   适配层只认标记行，这样两边都不会被对方的输出干扰）。
# ★ 引擎不在这个文件里：它由适配层装到 <DSH_HOME>/runtime/rapidocr/<版本>/<平台>/，
#   启动时通过 PYTHONPATH 注入；本文件只负责"读图 → 调引擎 → 吐 JSON"。

import json
import sys
import time

MARK = '__OCR_JSON__'


def emit(obj):
    """回一条带标记的 JSON（唯一允许写 stdout 的地方）"""
    try:
        sys.stdout.write(MARK + ' ' + json.dumps(obj, ensure_ascii=False) + '\n')
        sys.stdout.flush()
    except Exception:
        # stdout 写不出去（极端情况）也不能让脚本栈崩，让上层按"无输出"处理
        pass


def read_result(result):
    """兼容 rapidocr 的两种返回形态：
       · 1.x：[[box, text, score], ...]
       · 2.x/3.x：对象形态（.txts / .scores）
    """
    pairs = []
    if result is None:
        return pairs
    txts = getattr(result, 'txts', None)
    if txts is not None:
        scores = getattr(result, 'scores', None) or []
        for i, t in enumerate(txts):
            try:
                pairs.append((str(t), float(scores[i]) if i < len(scores) else 0.0))
            except Exception:
                pairs.append((str(t), 0.0))
        return pairs
    try:
        items = list(result)
    except Exception:
        return pairs
    for item in items:
        try:
            text = item[1]
            score = float(item[2])
        except Exception:
            continue
        if text is None:
            continue
        pairs.append((str(text), score))
    return pairs


def main():
    # Windows 下控制台默认编码会把中文打坏；显式钉成 UTF-8
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except Exception:
            pass

    try:
        raw = sys.stdin.read() or '{}'
        req = json.loads(raw)
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_FAILED', 'message': '入参不是合法 JSON：%s' % e})
        return 2

    images = [str(p) for p in (req.get('images') or []) if str(p).strip()]
    if not images:
        emit({'ok': False, 'code': 'OCR_NO_IMAGE', 'message': '没有可识别的图片（images 为空）'})
        return 2

    started = time.time()
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_INIT_FAILED',
              'message': '无法导入 rapidocr_onnxruntime：%s（引擎没装好？可用 uv pip install --target 引擎目录 rapidocr-onnxruntime 重装）' % e})
        return 3

    try:
        engine = RapidOCR()
    except Exception as e:
        emit({'ok': False, 'code': 'OCR_INIT_FAILED', 'message': 'OCR 引擎初始化失败：%s' % e})
        return 3

    lines = []
    scores = []
    for image_path in images:
        try:
            out = engine(image_path)
        except Exception as e:
            emit({'ok': False, 'code': 'OCR_FAILED', 'message': '识别 %s 失败：%s' % (image_path, e)})
            return 4
        # 1.x 返回 (result, elapse)，2.x 直接返回 result
        result = out[0] if isinstance(out, tuple) and len(out) >= 1 else out
        for text, score in read_result(result):
            if text.strip():
                lines.append(text)
                scores.append(score)

    text = '\n'.join(lines)
    emit({
        'ok': True,
        'text': text,
        'lines': len(lines),
        'confidence': (sum(scores) / len(scores)) if scores else 0.0,
        'durationMs': int((time.time() - started) * 1000),
    })
    return 0


if __name__ == '__main__':
    sys.exit(main())
