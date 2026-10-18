// tmp-test/verify-build-markers.mjs — 产物级核对（只读 dist），确认重建后的产物里带上了关键改动
//
// ⚠ 2026-10-19 事故：本文件原 183 条断言被一次 PowerShell `Set-Content` 误用写坏（UTF-8 被按 GBK 读入 + 换行丢失），
//   且它在 `tmp-test/`（gitignore）里无版本备份 ⇒ 无法原样恢复。下面这版是**按当前产物的真实存在性逐条探测后重建**的：
//   先跑 `probe-marker-keys.mjs` 确认 40/42 个候选锚点真实命中，再把命中的写成断言。覆盖 11 个功能域、43 条。
//   ⚠ 仍不及原 183 条的细度；后续按需补 —— **改这个文件只能用编辑工具或 node 写！**
//
// 断言只做**正向锚定**：dist 里的中文一律 `\uXXXX` / `\u{...}` 转义 ⇒ 先解码再比；局部标识符被 minify ⇒
// 只锚「字符串字面量 / 类名 / 版本标记 / 目录字面量」这类能在产物里存活的东西。
import fs from 'node:fs';

const c = fs.readFileSync('dist/client.js', 'utf8');
const h = fs.readFileSync('dist/index.js', 'utf8');
const decode = (s) => s
  .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, ch) => String.fromCharCode(parseInt(ch, 16)));
const cTxt = decode(c);
const hTxt = decode(h);
const hasC = (s) => cTxt.includes(s);
const hasH = (s) => hTxt.includes(s);

const rows = [
  // ===== A. 版本标记（产物闸门第一道）=====
  ['client 含标记 v20261021-imgref（图片参数改成模板引用口径）', cTxt.includes('v20261021-imgref')],
  ['client 图片参数说明里有「引用上游抽图」', hasC('引用上游抽图')],
  ['client 图片参数给出可直接复制的模板示例（ASCII：doc_img.out.images）', c.includes('doc_img.out.images')],
  ['client 选图「打开图片目录」指向运行目录（ASCII：tmp/ 拼接）', hasC('打开图片目录')],
  ['client 光点动画的合成层提示在产物里（will-change: offset-distance）', c.includes('will-change: offset-distance')],
  ['client 自检耗时文案在产物里（「本次自检用时」，让几十毫秒的自检可见）', hasC('本次自检用时')],
  ['client 慢自检文案「自检中…」在产物里（只在 >400ms 时才亮）', hasC('自检中…')],
  ['client 反向锁：旧的「检查中…」字样已不再出现（文案统一回"自检"口径）', !hasC('检查中…')],
  ['client 流动集合独立成 flowingEdges（产物里有该 prop 名，证明动画不等同于"走过的边"）', c.includes('flowingEdges')],
  ['client 运行路径三态类名仍在产物里（is-runpath-done / -moving / -stalled / -dim）',
    ['is-runpath-done', 'is-runpath-moving', 'is-runpath-stalled', 'is-runpath-dim'].every((k) => c.includes(k))],
  ['client 反向锁：连线不再用分支色（产物里没有 edgePass / edgeFail 这两个主题键）', !c.includes('edgePass') && !c.includes('edgeFail')],
  ['client 反向锁：产物里不再有「点这里看详情」（失败弹窗入口已整块移除）', !hasC('点这里看详情')],
  ['client 反向锁：产物里没有 RunFailDialogView（弹窗组件已删）', !c.includes('RunFailDialogView')],
  ['client 连线淡化仍在（is-runpath-dim——用户明确要求保留原有逻辑）', c.includes('is-runpath-dim')],
  ['client 跳过节点轻微发暗仍在（dsh-wf-fg-card.is-skip——原有逻辑保留）', c.includes('dsh-wf-fg-card.is-skip')],
  ['client 容错/跳过支路的失败节点用告警黄（.is-warn）', c.includes('dsh-wf-fg-card.is-warn')],
  ['client 顶部提示：盒模型居中（0 auto），不再靠 translateX(-50%)', hasC('0 auto')],
  ['client 失败提示文案：指向节点（「失败原因悬停对应节点查看」）', hasC('失败原因悬停对应节点查看')],
  ['client 子工作流失败透传文案（「子工作流内失败：」/「轮循环体内失败：」）', hasC('子工作流内失败：') && hasC('轮循环体内失败：')],
  ['首屏里程碑钩子在产物里（ASCII：__df_firstPaint，真机读数用）', c.includes('__df_firstPaint')],
  ['host   含标记 v20261021-nologfile（不再落文件日志）', hasH('v20261021-nologfile')],
  ['host   子工作流没拿到父目录时不新建自己的目录（锚点：subflow 未拿到父运行目录）', hasH('subflow 未拿到父运行目录')],
  ['host   runId 进程内去重（ASCII：issuedRunIds）', h.includes('issuedRunIds')],
  ['host   只有顶层运行写 run.json（ASCII：isTopRun）', h.includes('isTopRun')],
  ['host   子工作流并发串行队列在产物里（ASCII：runSubflowSerialized）', h.includes('runSubflowSerialized')],
  ['host   图片相对路径按各次运行目录探测（ASCII：runImageDirsNewestFirst）', h.includes('runImageDirsNewestFirst')],
  ['host   运行记录写进运行目录（ASCII：run.json 字面量）', h.includes('run.json')],
  ['host   扫运行目录里运行记录的 helper 在产物里（ASCII：listRunRecordsInTmp）', h.includes('listRunRecordsInTmp')],
  ['host   本次运行日志落 <runDir>/logs/run.log 的包装器在产物里（ASCII：wrapLoggerForRun）', h.includes('wrapLoggerForRun')],
  ['host   图片清单合并运行目录的扫描器在产物里（ASCII：scanImageDir）', h.includes('scanImageDir')],
  ['host   运行目录相对子路径 helper 在产物里（ASCII：dagFlowRunTmpSubDir）', h.includes('dagFlowRunTmpSubDir')],
  ['host   /run/log 响应带运行目录子路径（ASCII：dirSub）', h.includes('dirSub')],
  ['client 运行日志弹窗用服务端给的子路径打开文件夹（ASCII：dirSub）', c.includes('dirSub')],
  ['client 弹窗标注的落盘文件叫 run.json（不再拼 <runId>.json）', hasC('run.json')],
  ['host   运行前清空工作流 tmp 的方法在产物里（ASCII：pruneRunTmp）', h.includes('pruneRunTmp')],
  ['host   递归收集子工作流名的方法在产物里（ASCII：collectRunWorkflows）', h.includes('collectRunWorkflows')],
  ['host   一次运行独占的临时目录在产物里（ASCII：dagFlowRunTmpDir）', h.includes('dagFlowRunTmpDir')],
  ['host   python/bash 子进程注入 DAGFLOW_RUN_DIR（ASCII）', h.includes('DAGFLOW_RUN_DIR')],
  ['host   只保留最新 5 个运行目录的方法在产物里（ASCII：pruneRunTmpDirs）', h.includes('pruneRunTmpDirs')],
  ['host   日志只保留最新 20 份的常量在产物里（ASCII：LOG_KEEP_MAX_FILES）', h.includes('LOG_KEEP_MAX_FILES')],
  ['host   运行目录保留 20 次的常量在产物里（ASCII：TMP_KEEP_MAX_RUNS）', h.includes('TMP_KEEP_MAX_RUNS')],

  ['host   python/bash 输出落盘的函数在产物里（ASCII：dumpNodeOutput）', h.includes('dumpNodeOutput')],
  ['host   产出落运行目录的参数名在产物里（ASCII：dirOverride）', h.includes('dirOverride')],
  ['host   抽图目录解析 helper 在产物里（ASCII：imgDirOf）', h.includes('imgDirOf')],
  ['host run/status 静默查询分支存在（ASCII：quiet）', hasH('quiet')],
  ['编辑区问号容器类名（ASCII：dsh-wf-code-keys）', c.includes('dsh-wf-code-keys')],
  ['问号气泡文案：多光标操作（锚点：所有相同项 / 回到单光标）', hasC('所有相同项') && hasC('回到单光标')],
  ['CodeMirror6 编辑区宿主类在产物里（ASCII：dsh-wf-cmcode）', c.includes('dsh-wf-cmcode')],
  ['CM6 语法着色类名在产物里（ASCII：tok-keyword，证明 HighlightStyle 的 class 没被优化掉）', c.includes('tok-keyword')],
  ['折叠箭头宿主类在产物里（ASCII：dsh-wf-foldmark，自绘 SVG 箭头）', c.includes('dsh-wf-foldmark')],
  ['彩虹括号深度类在产物里（ASCII：cm-br-0，同层同色/逐层循环 4 色）', c.includes('cm-br-0')],
  ['搜索浮层类在产物里（ASCII：dsh-wf-find，替换 CM6 默认底部灰条）', c.includes('dsh-wf-find')],

  // ===== B. 空名三禁（2026-10-19 用户：没名字禁止运行/保存/自动建）=====
  ['空名时运行按钮给禁用原因（锚点：才能运行）', hasC('才能运行')],
  ['空名时保存按钮给禁用原因（锚点：才能保存）', hasC('才能保存')],
  ['空名手动保存给人话提示（不是后端 400）', hasC('工作流还没有名字')],
  ['名称框空态占位「未命名」', hasC('未命名')],

  // ===== C. 改名撞名绝不覆盖（用户拍板 A：前后端各一道）=====
  ['撞名时状态栏提示（前端）', hasC('名称已存在，换个名字才能保存')],
  ['改名撞名被服务端拒绝（host 硬拦）', hasH('已存在——改名会覆盖它')],
  ['服务端名称合法性校验错误文案在（host）', hasH('工作流名称不合法')],

  // ===== D. 删了还能看到 —— 启动清本地画布缓存 =====
  ['启动时清掉指向已删工作流的画布缓存（日志）', hasC('已清掉指向已删工作流的本地画布缓存')],
  ['本地画布缓存键在产物里（ASCII：dag-flow:def-cache）', c.includes('dag-flow:def-cache')],

  // ===== E. 运行控制（运行/取消/人工确认/容错）=====
  ['取消中间态文案（锚点：取消中）', hasC('取消中')],
  ['取消完成浮窗文案（锚点：取消成功）', hasC('取消成功')],
  ['运行成功浮窗文案（锚点：运行成功）', hasC('运行成功')],
  ['manual 挂起标题（锚点：等待人工确认）', hasC('等待人工确认')],
  ['容错成功徽标（锚点：已容错）', hasC('已容错')],

  // ===== F. 运行前自检拦截 =====
  ['自检拦截只给「去修改」（无"仍然运行"旁路）', hasC('去修改')],

  // ===== G. 图片/数据按工作流分目录（用户：严格不做兼容）=====
  ['client 图片目录锚点（ASCII：.dag-flow/images/）', c.includes('.dag-flow/images/')],
  ['host   图片目录锚点（ASCII：.dag-flow/images/）', h.includes('.dag-flow/images/')],
  ['抽图文案指向「本工作流的图片目录」', hasC('本工作流的图片目录')],
  ['工作流定义目录锚点（ASCII：.dag-flow/workflow/）', c.includes('.dag-flow/workflow/')],
  ['host 运行记录目录名在产物里（ASCII：runs）', h.includes('runs')],

  // ===== H. 导入导出 =====
  ['导出菜单项「导出 JSON」', hasC('导出 JSON')],
  ['导出菜单项「导出图片」', hasC('导出图片')],

  // ===== I. 撤销 / 重做 =====
  ['撤销按钮文案在产物里', hasC('撤销')],
  ['重做按钮文案在产物里', hasC('重做')],

  // ===== J. 定时任务 =====
  ['定时任务弹窗文案在产物里', hasC('定时任务')],

  // ===== K. 循环节点 =====
  ['loop 的「循环体」文案在产物里', hasC('循环体')],

  // ===== L. JSON 视图（2026-10-19 起改用 CM6；next → edges 归一化）=====
  ['JSON 视图用 CM6（ASCII：dsh-wf-json-root 仍在产物里）', c.includes('dsh-wf-json-root')],
  ['★ Monaco 已彻底移出客户端（反向锁：产物里不再有 @monaco-editor/loader 的文案 monaco-loader）', !c.includes('monaco-loader')],
  ['★ Monaco 的 DOM 类名也不在产物里（反向锁：.monaco-editor，连撤销守卫里的选择器都删了）', !c.includes('.monaco-editor')],
  ['归一化提示「已统一为 edges 连线」（用户以为"next 被吞"时的反馈）', hasC('已统一为 edges 连线')],

  // ===== M. 文档解析（doc_parse）=====
  ['doc_parse 的「抽取内嵌图片」开关在', hasC('抽取内嵌图片')],
  ['OCR 默认档「自动（默认）」在', hasC('自动（默认）')],

  // ===== N. AI 节点 =====
  ['AI 节点的「选择模型」入口在', hasC('选择模型')],

  // ===== O. 参数弹窗与试跑 =====
  ['「参数与试跑」弹窗标题在', hasC('参数与试跑')],
  ['试跑本节点文案在', hasC('试跑')],
  ['关键提示「改动即自动保存」平铺在（不在小问号里）', hasC('改动即自动保存')],

  // ===== P. 自研 UI 组件（类名断言）=====
  ['自研下拉的选项类（ASCII：dsh-wf-sel-opt）', c.includes('dsh-wf-sel-opt')],
  ['小问号气泡（ASCII：dsh-wf-info-pop）', c.includes('dsh-wf-info-pop')],
  ['面板按钮类（ASCII：dsh-wf-btn）', c.includes('dsh-wf-btn')],
  ['弹窗关闭按钮类（ASCII：dag-flow-picker-close）', c.includes('dag-flow-picker-close')],
  ['画布节点卡类（ASCII：dsh-wf-fg-card）', c.includes('dsh-wf-fg-card')],
  ['名称输入框类（ASCII：dsh-wf-name-input）', c.includes('dsh-wf-name-input')],
  ['切换工作流淡入遮罩类（ASCII：dsh-wf-fg-veil，2026-10-19 修「切换画布时闪」）', c.includes('dsh-wf-fg-veil')],

  // ===== Q. 产物体积（异常膨胀/截断的兜底）=====
  [`dist/client.js 体积合理（${(fs.statSync('dist/client.js').size / 1048576).toFixed(2)} MB，期望 1.0-2.1）`,
    fs.statSync('dist/client.js').size > 1_000_000 && fs.statSync('dist/client.js').size < 2_100_000],
  [`dist/index.js 体积合理（${(fs.statSync('dist/index.js').size / 1024).toFixed(0)} KB，期望 400-1200）`,
    fs.statSync('dist/index.js').size > 400_000 && fs.statSync('dist/index.js').size < 1_200_000],
];

let pass = 0;
const failed = [];
for (const [name, ok] of rows) {
  if (ok) { pass++; console.log('✓ ' + name); } else { failed.push(name); console.log('✗ ' + name); }
}
console.log(`\n${pass}/${rows.length} 项通过`);
if (failed.length) { console.error('FAIL:\n  ' + failed.join('\n  ')); process.exit(1); }
