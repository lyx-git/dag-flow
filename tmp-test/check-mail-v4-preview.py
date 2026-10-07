# tmp-test/check-mail-v4-preview.py — 用本机内置 Python 校验新 mail 代码：①语法 ②HTML 渲染效果
# 用法：<内置python> tmp-test/check-mail-v4-preview.py
import ast
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '_mail-v4-preview.py')

text = open(SRC, 'r', encoding='utf-8').read()

# ① 语法检查
try:
    ast.parse(text)
    print('① 语法检查：通过（ast.parse OK）')
except SyntaxError as e:
    print('① 语法检查：失败 -> line %s: %s' % (e.lineno, e.msg))
    sys.exit(1)

# ② 导入并跑渲染（模块有 __main__ 守卫，import 不会发信）
spec = importlib.util.spec_from_file_location('mail_v4', SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

print('② 常量：DAY=%r WORKSPACE_HINT=%r REPORT 前 40 字=%r'
      % (mod.DAY, mod.WORKSPACE_HINT, mod.REPORT[:40]))

# ③ 表格分隔行判定
cases = ['|---|---|', '| --- | --- |', '|:--|--:|', '| 事件 |', 'no-pipe', '| 1 | 2 |']
for c in cases:
    print('③ _is_table_sep(%r) = %s' % (c, mod._is_table_sep(c)))

# ④ HTML 渲染
html = mod.render_html(mod.REPORT)
print('\n④ render_html 输出（前 900 字）：')
print(html[:900])
print('...\n   HTML 总长 %d 字；含 <table> = %s；含 <h3> = %s；含未转义 & = %s'
      % (len(html), '<table>' in html, '<h3>' in html, '&' in html.replace('&amp;', '').replace('&lt;', '').replace('&gt;', '')))

# ⑤ 转义安全性
print('\n⑤ 转义检查：render_html("<script>x</script>") = %r' % mod.render_html('<script>x</script>'))
