# -*- coding: utf-8 -*-
# 示例：工作流参数面板「代码文件」填 scripts/hello.py 即可引用本文件执行
# 直接在本文件里写格式化的 Python 代码，保存后回到工作流点运行即可
import datetime

msg = '你好，dag-flow！这是来自 scripts/hello.py 的输出，当前时间：' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
print(msg)
