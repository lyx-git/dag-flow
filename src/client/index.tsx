// src/client/index.tsx
// DSH 客户端入口：暴露 apply(ctx)。
//
// bundle 协议：window.__ModuleLoader__.load({ id, factory: (require) => ... })
// factory 返回 module.exports，DSH loader 自动调 module.exports.apply(ctx)。
// （协议 banner/footer 在 scripts/build-client.mjs——客户端防腐点清单见 src/client/dsh-gate.ts）
//
// v20261013-hovertip：**所有悬浮提示换成可选中复制的主题化卡片**（2026-10-13 用户原话：
//   「所有的鼠标悬浮上去浮窗展示的内容，都要求能复制，不能无法选中浮窗内容，而且鼠标悬浮弹窗有点丑，
//   和插件风格不太匹配」）。原生 title 属性的系统悬浮框内容不可选中、外观不受主题控制 ⇒
//   **事件委托全局接管**（新增 `src/client/hover-tip.ts`，`FlowPanel.tsx` 模块副作用 `initHoverTips()`，
//   幂等；真机入口与 CDP 夹具都从 FlowPanel 进入 ⇒ 一处生效、零调用点改动）：
//   · 悬停任何 [title] 元素：把 title 摘到 `data-title` 并**移除属性**（浏览器就不画原生框；
//     React 重渲染会还回来，下次悬停再摘）→ 显示 `.dsh-wf-hover-tip` 卡片（--wf-* 主题、`pre-line`
//     保留换行、`user-select:text` 可选中复制、鼠标可移进卡片）。
//   · 移开锚点 160ms 后收（给"移进卡片选中"留时间）；移进卡片不收、移出才收；点击/滚轮/滚动/失焦立即收
//     （z-index 10006 高于弹窗遮罩 10000，必须防止盖住新弹窗）。
//
// v20261013-vargrouptitle：**上游变量分组标题统一为「显示名（节点id · 节点类型）」**（2026-10-13 用户原话：
//   「打开变量弹窗里面的上游变量和参数里面的变量抽屉页的上游变量都按照节点分组了，节点显示的名称改为：
//   显示名（节点id · 节点类型）」）。两处同步改（同一个上游数据源 `upstreamInfo` 的两个消费方）：
//   · `FlowPanel.varPickGroups`（参数弹窗变量抽屉）与变量弹窗的上游分组行——原来都是
//     「显示名 · 节点id · N 个字段」，现改为「显示名（节点id · 节点类型） · N 个字段」。
//   · 节点类型用 `node.type`（与右侧面板「节点类型」行的口径一致）；**节点 id 必须保留**（引用要靠它，
//     历史口径「id 不能丢」不变）；`upstreamInfo` 本来就返回 `un`，弹窗侧补进解构即可。
//   对照例子：`AI 子代理（ai_final · python） · 6 个字段 —— 字段取自上次运行的真实输出`。
//
// v20261013-varglobal：**修复变量抽屉「全局变量」分组的 chips 全是空壳**（2026-10-13 用户原话：
//   「变量数据过多，会导致挤压全局变量显示，变量按钮变得很小，看不到变量字段」+「全局变量的鼠标悬浮
//   上去的提示信息变成了点击填入：undefined」——两条是同一个 bug）。根因：`FlowPanel.varPickGroups` 的
//   全局分组直接 `chips: globalItems()`——那是**旧变量弹窗**的条目形状 `{path, desc, key, isOut}`，而抽屉
//   `VarChip` 要 `{text, desc, isOut}` ⇒ `text: undefined`：chip 渲染成只有内边距的**空壳小按钮**
//   （全局变量一多就是一排空壳，看起来像"被挤压"）、悬浮是「点击填入：undefined」、点了插入 undefined。
//   上游 / 本节点输出两个分组是显式写的 `{text:…}`，所以没这问题（现有用例也只覆盖了它们 ⇒ 补 ①b 断言）。
//   修法 = 映射成抽屉形状：`chips: globalItems().map((it) => ({ text: it.path, desc: it.desc, isOut: it.isOut }))`。
//
// v20261013-inboxbar：**复制 / 清除 / 提示 挪进富文本框内部右下角，且绝不遮挡输入**（2026-10-13 用户原话：
//   「富文本框的复制，清除，tips挪到富文本框里面右下角位置，并且不能遮挡输入操作」——上一版"绝对定位浮层"
//   会盖住代码、按钮也拦点击，被否）。本次方案＝**独占一条带**：
//   · `code-text.tsx`：文本区（行号槽 + 高亮层 + textarea）包进新层 `.dsh-wf-code-main`（flex:1 占满除工具条
//     以外的高度）；放大/缩小把手移进 `.dsh-wf-code-main`（定位基准=文本区，仍在右上角）；工具条
//     `.dsh-wf-code-toolbar` 成为 `.dsh-wf-code-ed` 的**最后一个子元素**＝编辑框内部最底部一条带。
//   · `styles.css`：`.dsh-wf-code-ed` 改 `flex-direction:column`；`.dsh-wf-code-toolbar` 改
//     `flex-shrink:0 + justify-content:flex-end + border-top`（内容靠右＝右下角；带顶一条分隔线）。
//   ⇒ 工具条**不覆盖任何代码文字、不拦截 textarea 点击**（CDP 用 elementFromPoint + 矩形零重叠来锁）；
//     代价＝文本区矮 ~28px。
//
// v20261013-broom：**参数弹窗里富文本框的「清除」按钮图标：垃圾桶 → 扫帚**（2026-10-13 用户原话：
//   「参数弹窗面板里面的富文本框的清除按钮的icon图标换成扫帚的图标，而不是现在删除的图标」；
//   追问用哪个形态时他明确「扫帚图标应该有通用的图标，使用通用图标就行」）。改动只在
//   `src/client/params-editor.tsx`：删掉手画的 `IconTrash`，换成**通用图标集 Phosphor Icons（MIT）的
//   `broom` 原始 path**（`BROOM_PATH`，256 网格、fill=currentColor、`IconBroom`），工具条里改用它。
//   选型依据＝四家通用图标集真机渲染对比（`tmp-test/build/broom-icons.html` + 截图 `broom-icons.png`）：
//   Phosphor broom 在 16px 下剪影最像扫帚；Tabler brush 描边太细、Material cleaning_services 没柄、
//   Bootstrap brush 更像毛笔。★ 只换图标，按钮类名 / title / 两击确认语义一律没动。
//
// v20261011-expandmodal：**放大按钮改成"富文本框内部右上角的斜双箭头 → 放大成弹窗"**（2026-10-11 用户
//   两次更正后的定稿：先「右下角」→ 再「右上角，放大和缩小」）。原话「富文本框放大的按钮不对，是在富文本框
//   里面的右上角，有个类似于/斜杠的双箭头放大，可以放大到弹窗，遮盖其他部分」。
//   · 行里的 `.dsh-wf-params-big` 按钮**删除**（不是行按钮）；改为 CodeText 的 `expand` prop 渲染的
//     **框内右上角把手**（`.dsh-wf-code-expand`，right:20px 让开 textarea 竖向滚动条）。
//   · 点把手 → 打开「🔍 放大编辑「<参数名>」」大窗（90vw/max1400，独立 Portal 到 body——不能嵌在参数弹窗里，
//     遮罩的 backdrop-filter 会给 fixed 造包含块）；大窗里读写的**是同一个参数值**（两处同步）。
//   · 大窗里同一个把手变成「缩小」态（斜双箭头朝内 + `.is-expanded`），点它（或 ✕ / 点遮罩）回到参数面板。
//   · 行内富文本框高度固定 150（放大不再改行内高度）；清空/复制图标工具条与「单行/富文本」按钮保持不变。
//
// v20261011-codeicons：**富文本框工具条的「复制 / 清空」换成纯图标**（2026-10-11 用户要求原话「复制和清空
//   按钮换成 icon 图标就行」）。两个按钮改 `.dsh-wf-code-ibtn`（28×26 方框 + 内联 SVG 复制/垃圾桶，
//   title 里保留说明）；清空的"点两次确认"照旧——第一下图标转红并在旁边补一句「再点一次清空」。
//
// v20261011-paramsbox：**参数弹窗里的富文本框统一 + 新增「放大」按钮**（2026-10-11 用户要求）——原话
//   「参数弹出面板里面，python和bash脚本的富文本框和其他节点都保持一致，清空和复制按钮都需要，
//     富文本框增加一个那种放大富文本框的按钮就行，方便切换」。
//   · **所有行一套控件**（不再对 code 行特判布局）：[T 类型] [单行/富文本] [放大/缩小（富文本时出现）] [✕]；
//     code 行也恢复「单行/富文本」按钮（上一版我按"代码天生多行"把它去掉了，用户要求保持一致）。
//   · **凡富文本框都带工具条**：📋 复制 / 🧹 清空（两击确认）/ Tab 提示——普通参数行切成富文本后同样有。
//   · **新增放大按钮**（`.dsh-wf-params-big`）：富文本框高度 150 ↔ 460 一键切换，放大态按钮高亮（.on）；
//     语言只影响着色（code 行按节点类型高亮 python/bash），不影响控件。
//
// v20261011-codeinparams：**python/bash 的「脚本」与「脚本路径」搬进「🧪 参数与试跑」弹窗**（2026-10-11
//   用户拍板方案 A：用户原话「python和bash节点的编辑脚本按钮和脚本地址输入框，本质上来说也是参数，
//   是否可以放进参数和试跑的弹窗里面，可以减少弹窗操作」）。改动：
//   · 面板删掉「📄 代码文件（二选一）」输入框与「📝 编辑代码」按钮 → 只留一行只读摘要（`codeSummary()`：
//     "用文件：xxx（优先于内联代码）" / "内联代码：N 行 · M 字符"）。
//   · 弹窗里 `code` 行升级为**语言感知的代码编辑器**（CodeText + python/bash 高亮 + 行号 + Tab + 状态栏
//     +「复制 / 清空（两击确认）」工具条；这行不再给单行/多行切换）——原「📝 编辑代码」弹窗**整体删除**
//     （含 codeEditorOpen/hlRef/gutterRef/clearArm/cursor/syncScroll/updateCursor 与 highlightCode 导入，-111 行）。
//   · `codePath` 行给专用说明（约定路径 scripts/<工作流名>/xxx.py；填了文件优先于内联代码）；该键原本不在
//     节点默认参数里 ⇒ 弹窗对 python/bash **自动补这一行**（auto 行：留空不写入 def，保持"清空=删键"语义）。
//
// v20261011-labelfirst：**「显示名 (label)」挪到右侧面板最上面**（2026-10-11 用户反馈：「画布右侧编辑框
//   里面的显示名应该放到面板的上面，放在中间有点奇怪」）。原来它夹在"模型 / 代码文件"等按节点类型渲染的
//   字段之后、「参数与试跑」之前；现在紧跟类型标题，排在「节点 ID / 节点类型」两个只读行之前。
//
// v20261011-noresult：**试跑结果只在弹窗里显示，面板不再重复弹一份**（2026-10-11 用户真机反馈：
//   「试跑输出的结果,在右侧面板里面也弹出来了，不应该弹」）。上一轮把试跑搬进弹窗时我保留了面板结果区
//   （想的是"不开弹窗也能看上次结果"），结果同一次试跑在两处各显示一份 ⇒ 现在删掉面板那一份，
//   结果只在「🧪 参数与试跑」弹窗底部就地展开；结果状态仍留在 NodeInspector（作为 prop 传给弹窗）。
//
// v20261011-testrun：**试跑本节点集成进「参数与试跑」弹窗**（2026-10-11 用户拍板方案 A）——用户原话
//   「参数编辑弹窗，能否改个名字，将试跑本节点也集成进去，这样可以复用参数的数据，试跑当前节点，
//     避免试跑本节点，又有一个输入框」。
//   · 改名：弹窗「🧪 参数与试跑（节点 · id）」、面板入口「🧪 参数与试跑（N 项）」。
//   · 弹窗底部**常驻试跑条**：▶ 试跑本节点 + 「试跑输入（N 项）」折叠区（按工作流参数 def.inputs
//     逐字段渲染、默认值预填、能按 JSON 解析的就解析）+ 结果**就地展开**。
//   · 面板删掉原来的「🧪 单节点试跑」JSON 输入框与试跑按钮（不再有"又一个输入框"），**结果区保留**。
//   · 结果块抽成 src/client/test-result.tsx（**只在弹窗里**渲染；面板不再显示一份——见 v20261011-noresult）。
//   · 参数数据仍取当前节点的 params（本来就复用）；输入解析失败按字符串，不静默改类型。
//
// v20261011-icons：**参数行的单行/多行图标换成内联 SVG**（2026-10-11 用户反馈「单行输入和多行编辑框的
//   icon 图标有点丑，优化下」）。原来是字体符号 ▭（U+25AD 空心方块）与 ⤢（冷僻箭头区字符）——非常用字形，
//   不同字体/字号下渲染差异极大。现为一对语义直白的输入框图标：单行＝扁框内一横线，多行＝高框内三横线
//   （描边 currentColor，任何字体与缩放下都清晰）。顺带把类型开关「文」统一成「T」（T / {} 都是常用字形）。
//
// v20261011-varpick：**变量引用搬进参数弹窗（右侧抽屉）+ 点变量插入到光标处**（2026-10-11 用户拍板方案 A）。
//   用户原话：「画布右侧编辑框里面的变量引用，能否放到参数的弹出框里面」。原来变量 chip 只能"点击复制"，
//   现在参数弹窗里有编辑目标 → 点 chip 直接把 {{节点.out.字段}} 插到当前值框的光标处（参数名框不算）。
//   分组数据与变量弹窗同源（upstreamAll / globalItems / selfFields，只是参数化搜索词后取全量）；
//   抽屉用新的 src/client/var-picker.tsx 渲染（复用既有 chip/分组样式与四路口语化检索）。
//   面板里那行「🔗 变量引用」保留不动（看变量、复制仍可用）。
//
// v20261011-params：**参数编辑区从右侧窄面板独立出来**（2026-10-11 用户拍板）——用户原话
//   「每个节点都有参数这个输入框，这个输入框能否独立出来，做成富文本框的形式，不管是新增或编辑，
//     都比较方便」，并明确「富文本编辑框是那种类似代码级的富文本编辑框，也不是 word 编辑框」。
//   面板里的「参数 (params, JSON)」小框 → 换成「✏️ 编辑参数（N 项）」按钮 + 只读摘要（同一件事只留一个入口）；
//   弹窗内两个页签：字段视图（每参数一行：名字可改 + 值直接写 + ✕ 删 + 底部 + 新增，长文本/对象值用代码级多行框）
//   与 JSON 视图（整份 params，行号 + 高亮）。写回沿用 handleNodeChange 的既有语义（浅合并 + null = 删键）。
//   代码级编辑框抽成 src/client/code-text.tsx（行号槽 + 高亮层 + 透明 textarea；python/bash 规则原样搬移）。
//
// v20261011-ocrhint：**doc_parse 面板底部 hint 与新增的 OCR 行对齐**（2026-10-11 审计 B）。
//   旧 hint 写着「扫描版 PDF 没有文本层会明确报错」——轮 3 起 OCR 开着就会自动转图片识别，同一面板两句话打架。
//   现文案：PDF / Office 零依赖；图片与扫描版 PDF 走 OCR；有文本层就直接读、没有才转图片；OCR 关时才报错。
//
// v20261011-ocrpdf：**扫描版 PDF 也能 OCR 了**（2026-10-11 轮 3）——逐页栅格化（pypdfium2，避开 AGPL 的 PyMuPDF）
//   + RapidOCR；`ocr` 语义：off 关 / **auto＝没有文本层才识别** / **force＝有文本层也重新识别**；ocrMaxPages 限页数。
//   客户端：三档下拉文案改为「图片 + 扫描版 PDF」，说明写清 auto 不做无用功。
//
// v20261011-ocr：**「文档解析」支持图片 OCR**（2026-10-11 轮 2）——图片（png/jpg/webp/bmp/tif）→ 纯文本，
//   引擎 RapidOCR（适配层 src/adapter/ocr.ts，引擎装在插件 runtime/rapidocr/ 与 python/bash 并列）。
//   客户端：doc_parse 参数面板新增「OCR（图片识别）」三档下拉 + 输出字段说明补 OCR 元信息。
//   关（默认）＝图片直接报 OCR_DISABLED；自动/强制＝图片走引擎。
//
// v20261011-docparse：**新节点「📑 文档解析」（`doc_parse`）**——PDF / Office / 文本 → 纯文本，零依赖
//   （解析内核 src/registry/doc-extract.ts，50 断言；节点在 builtin.ts，走纯加法）。
//   客户端：调色板 + FlowGram 注册表 + 输出字段表各加一项，参数面板新增 path / url / maxChars 三行。
//   扫描版 PDF（无文本层）明确报错、不做 OCR；旧版 .doc/.xls/.ppt 提示另存为 docx/xlsx/pptx。
//
// v20261011-auditfix：**2026-10-11 审计①②③ 三处一致性修复（对用户可见的两处）**。
//   ① JSON 视图的 schema 此前 `onError: {type:['string','object']}` 比宿主宽松（宿主是严格 oneOf：
//      goto 分支要求 `goto:string` 且不许有其它键）⇒ 右侧 ajv 报 ✅、一点运行才被拒。已与宿主逐字同形，
//      并加了可反复跑的一致性探针 tmp-test/verify-schema-parity.mjs（带阳性对照）。
//   ② 同上文件里 `name.pattern` 原是自己抄的硬编码副本 → 改引唯一源 src/name-rule.ts。
//   ③ 用户可见文案不再让人去改已被 dsh 0.2.0 移除的 settings.yaml，改指 profile 的 cordis.patch.yml。
//
// v20261011-testrunmsg：**单节点试跑失败时，面板要给出原因**（2026-10-11 用户要求修 ③）。
//   症状：参数里引用了上游节点（如 `over: '{{web_search1.out.items}}'`），而单节点试跑没有上游 →
//   执行器在**模板解析阶段**就拦下（整轮 error.code=DATAFLOW_UNKNOWN），`results.target` **根本不存在**；
//   旧代码只读 `target.*` ⇒ 面板只剩一句「✗ 节点状态: failed」，一个字的原因都没有。
//   现在把节点级错误、或整轮错误的原因带进试跑结果区（服务端同样给这类失败补了"单节点试跑"的说明）。
//
// v20261011-sfhint：**subflow 卡片加「双击卡片进入子工作流」提示行**（2026-10-11 用户原话：「子工作流节点上
//   加个提示信息，双击跳转子工作流，如果子工作流不存在的话，双击提示子工作流不存在」）。
//   · 卡片：副标题仍是「↳ 子工作流名」（实测内容宽 168px，提示拼在副标题里会把「双击进入」自己挤掉
//     → 另起一行 `.dsh-wf-fg-card-hint`，交互色 9.5px，卡片高约 +16px）；
//   · 双击：沿用 2026-10-03 就做好的 enterSubWorkflow（loop 循环体 / subflow 目标都能进，header 有返回胶囊+面包屑）；
//   · 目标不存在：navStack 现在按 HTTP 404 单独出文案「子工作流「X」不存在——双击没有跳转，检查名字或先新建它」
//     （与执行器 WORKFLOW_NOT_FOUND 同口径），不再只报 HTTP 码。
//
// v20261011-fitenter：**进画布改成「按整图适配显示」**（2026-10-11 用户原话：「现在点工作流进右侧画布的时候，
//   画布是按照75%展示，改成按照整理后的比例展示」→ 从 A（进画布按整图适配，不动节点位置）/ B（进画布先自动
//   「整理」再适配，会重排并持久化节点位置）里**选 A**）。
//   改动：`pickInitialZoom` 现在与「适应画布」**同一套夹取 [50%,100%]**（`fitZoomClamped`）；固定 75% 的
//   `READABLE_MIN_ZOOM` 常量删除（进画布不再硬抬到 75%，大图不再"右半边看不见"）。
//   ★ 副作用：进画布那一刻的缩放不再保证落在档位上（可能是 62% 这种连续值）——工具栏按实际值显示，
//     档位只用于 ＋/− 跳档。
//
// v20261011-runstop：**运行收尾后关掉光点动画**（2026-10-11 用户真机反馈原话：「运行中的工作流取消了，
//   能不能关闭这个光点动画」）。根因：「源节点成功、目标还没成功」这个条件在**取消/失败收尾之后依然成立**
//   ⇒ 光点会永远转下去。修法＝把"正在走"收进"运行仍在进行"这个前提里：
//   新增 `runActive`（`running && !cancelling`）由 FlowPanel 传入 → `runPathStore` 多存一个 running 标志 →
//   `stateFor` 在 !running 时把该边判成 **'stalled'（静态绿、无光点）**，已走通的边照旧常亮。
//   验证：CDP `run-path` 用夹具新控制口 `POST /__host-run {stage:3, terminal:'failed'}` 造"收尾但没走完"的
//   中间态 → 断言光点 0 个、该边是 `is-runpath-stalled`、已走通的仍是 `is-runpath-done`。
//
// v20261011-runcomet：**运行路径高亮改成方案 C ＋「正在走」的光点跑**（2026-10-11 用户拍板——
//   真机原话：「现在是节点运行结束，线变成绿色，而不是运行中的时候，变成绿色，这个效果是对的吗」
//   → 从 A 保持 / B 源成功即亮 / C B+流动动画 里**选 C**，动效三候选里**选 ② 光点跑**）。
//   ① **时机改 B**：`activeEdges` 现在是「源节点 status === 'success'」的边 ⇒ 绿线紧跟执行前沿，
//      不再等目标节点也跑完（原来落后一拍）。
//   ② **三态**：已走通（两端都成功）＝常亮绿 + 外发光；正在走（只源成功）＝绿 + 光点沿边跑；
//      还没到＝淡化 0.4。类名 `is-runpath-done` / `is-runpath-moving` / `is-runpath-dim`。
//   ③ **光点实现**：挂在 free-lines-plugin `renderInsideLine` 上的 `CometDots`——从同一条线的
//      `<svg><path>` 上读 `d`，用 CSS `offset-path: path(...)` + `offset-distance` 动画跑 3 个递减尾巴；
//      定位父级就是线的包装 div，与那条 path 同一坐标系。不支持 `offset-path` 的浏览器整块隐藏（@supports）。
//   诊断钩子 `window.__df_runPath` 增加 `done` 边数；回归锁 CDP 用例 `run-path`（已按新语义重写）。
//
// v20261011-runpath：**恢复「运行路径高亮」**（2026-10-11 用户拍板「实现这个功能」）。
//   reactflow 时代的能力：两端节点都成功的边标绿光、其余边淡化；FlowGram 化后 `activeEdges`
//   一直是**悬空 prop**（FlowPanel 算了并传，Canvas 只声明从不读取）→ 本轮补齐。
//   落点三条通路：① `customLineProps`（free-lines-plugin 的线样式扩展点，对颜色有最终裁决权，
//   还能覆写 `version` 强制失效它自己的渲染缓存——否则「只换颜色」可能被缓存命中不重渲染）；
//   ② 线实体 `highlightColor`（`getLineColor` 优先取它）+ `uiState.style`（外发光 / 淡化，落到线容器）；
//   ③ 类名（CSS 与 CDP 断言的稳定抓手）。配色 `#35d39a`（与 reactflow 时代同色）。
//   诊断钩子：`window.__df_runPath`。回归锁：CDP 用例 `run-path`。
//
// v20261011-cssclean：**第三轮样式清理**（只删样式 + 修注释，宿主与逻辑零改动）——收掉上一轮列出的收尾项：
//   ① 5 条零引用规则（旧 ghost 按钮变体 ×2、旧「打开下拉」选择器、ManageView 遗留类、定时弹窗被移除的
//      第二行 actions）——判定用的是**加严审计**（读 ts/tsx 前先剥注释，否则我自己在变更说明里写的类名
//      会把它们"救活"；这一坑本轮亲踩）；② 10 行零消费主题变量 `--wf-edge*`（深浅两套定义 + 别名，已无
//      任何规则消费）；③ **7 行**"双重编码乱码"注释（上一轮漏判：旧脚本用写死行号 + 窄字符类，自检又复用
//      同一窄正则 → 必然假阴性）。判定改成**生成式**（枚举 UTF-8 前导/续字节被 GBK 解码的映像集，
//      阈值 ≥90%），实际是 7 行而不是手挑的 5 行。styles.css **1234 → 1206 行**；
//   脚本 tmp-test/patch-css-round3.mjs + 审计 tmp-test/audit-css-strict.mjs（均含演练/自检）。
// v20261011-rfdead：**清掉 React Flow 时代的节点卡遗留类**（只删样式，宿主与逻辑零改动）。
//   FlowGram 化后节点卡是 `.dsh-wf-fg-card` 系列；这批 `rf-node` 类名在 src 全部 ts/tsx 里零引用，
//   且在文件里**重复定义两处**（节点卡状态色 + 运行徽标色）——"换了画布引擎没清干净"的指纹。
//   删 12 条规则 + 1 行前导注释 + 2 行空行 → styles.css **1266 → 1234 行**；
//   脚本 tmp-test/patch-dead-css-rfnode.mjs（演练/--write + 规则集合等价自检）。
//   ★同批但**不属于本族**、本轮刻意没动的：零消费主题变量 `--wf-edge*`（5 个 / 10 行，已无任何规则消费）
//   与 4 条零引用规则（`.dsh-wf-btn-ghost`×2 / `.dsh-wf-open-select` / `.dsh-wf-manage-item-action`）。
// v20261011-norfcss：**清掉 styles.css 里 React Flow 时代的死 CSS**（只删样式，宿主与逻辑零改动）。
//   画布引擎换成 FlowGram free-layout 后，DOM 里不再有 `.react-flow*` 元素 → 11 条以 `.react-flow` 起头的规则
//   （节点 hover / `.dsh-wf-root .react-flow*` 主题覆盖 / 运行路径高亮边）永远不可能命中；src 的 ts/tsx 与
//   tmp-test、test 的 .mjs 对它零引用。共删 11 条规则 + 2 行前导区块注释 + 2 行多余空行 → **1314 → 1266 行**；
//   脚本 tmp-test/patch-dead-css-reactflow.mjs（演练/--write 双模 + 结构等价自检）。
//   ★ 同族但选择器里**不含** react-flow 的遗留类（`.dsh-wf-rf-node*` / `.wf-edge--active` 等）本轮**未动**，留作下一轮。
// v20261004-sched-cleanup：**定时任务弹窗交互改造**（2026-10-04 用户原话：「定时任务弹窗里面，修改cron表达式
//   是自动生效的，增加一个保存，修改按钮，手动确认生效，启用按钮不要使用勾选的方式，一些我能筛选的方案，让我自己选」）。
//   ① **cron 改手动确认**：敲键只改**草稿**（输入框描黄边 + 行内「● cron 已修改，点「保存」才生效」+「保存」高亮），
//      点行内「保存」（或回车）才落盘；非法表达式时「保存」禁用并显示红字原因；预览按草稿算（所见即所存）。
//      原来的 1.2s 防抖自动保存**不再用于 cron**（patchScheduleLocal 的 debounce 能力保留备用）。
//   ② **启用/停用不再用勾选框**：改成单按钮切换（用户从两轮候选里选定图标 **● 启用中 / ○ 已停用**），
//      点一下即生效（用户同轮确认：它本身就是明确动作，不需要再点保存）。
//   ③ **未保存就关弹窗 → 直接放弃 + 浮层提示**（用户当天改口：「未保存关闭直接放弃，给个提示就行，不用弹窗处理，
//      上轮做的弹窗，是因为我点错了，删掉就行」）——关闭即丢弃草稿并关窗，只在底部浮层提示「未保存的 cron 改动已丢弃」；
//      ★当天早些时候那版「二次确认弹窗」已**整体删除**（不弹窗、也不用 window.confirm）。草稿不跨次保留。
//   ④ **清掉随之变成死代码的防抖保存**（用户 2026-10-04 拍板"删掉"）：`patchScheduleLocal` 的 `opts.debounce`
//      参数 + `if (!opts.debounce)` 分支 + `schedTimers` ref 一并删除，它现在只做"立即落盘"；
//      顺带把已不使用的 `schedItems` 从 useCallback 依赖里去掉（函数体只读 `schedItemsRef`）。
//      删它的理由：无调用方、无用例覆盖、且它正是那个"开关闪回"竞态的载体（快照在注册防抖时取、1.2s 后才发）。
//      将来若真要防抖，必须**在触发时**重读 `schedItemsRef.current`。
//
// v20261004-nosettings：**删掉设置页「工作流配置」分区**（2026-10-04 用户原话：「工作流配置设置页面，
//   直接删掉吧，已经没啥用了」）。该分区自 09-25 模型/密钥配置移除后只剩「🎨 画布主题」下拉 + 一行说明，
//   是旧功能的残壳。删除：registerSettingsSection 调用 + src/client/SettingsPage.tsx + 它的 re-export + 死 CSS。
//   ★副作用（已 ask_user_question 讲清并获确认后执行）：画布主题从此**没有界面入口**，固定在 localStorage
//   里已保存的值（默认 nodeflow 深空蓝）；theme.ts 与启动时的 applyTheme(getThemeMode()) 保留不动。
//   ★防腐层 dsh-gate.ts 的 registerSettingsSection 能力**保留**（不再被调用，作为 ACL 能力位备用）。
// v20261004-text-width：**纯文本星号 + 弹窗宽度规则失效**（2026-10-04，用户：「顺手发现、按红线没动手的
//   两件事，这两件事都统一修掉」）。
//   ① 用户可见文案里的 Markdown `**` 会被**原样渲染**（同一坑第三次复发）：FlowPanel 的 ⏰ 弹窗底部
//      「cron 为**本机时区**的」、loop 面板「**不会重复执行下游节点**」，以及 host 侧 selfcheck.ts 的
//      SOURCE_SKIP_SILENT 消息「整轮却仍显示**成功**」——全部去掉 `**`（强调改用「」）。
//      回归锁：selfcheck.test.mjs N6b（消息不含 `**`）+ CDP 三处（定时弹窗/版本弹窗/loop 面板的可见文案不含 `**`）。
//   ② 弹窗宽度规则**集体失效**：`.dag-flow-picker { width: 680px }` 由 workflow-picker.ts 的 PICKER_CSS
//      **运行时注入**（位置在 styles.css 之后），与 `.dsh-wf-sched` 这类规则**同权重（0,1,0）**→ 后到者胜
//      → 定时 720 / 确认 460 / 自检 620 / 日志 920 四条宽度全部被压成 680。修法=提权成
//      `.dag-flow-picker.dsh-wf-xxx`（0,2,0）。回归锁：CDP 四处实测宽度（720 / 460 / 620 / 920）
//      + 版本弹窗仍 680（确认没有外溢）。
//
// v20261004-verpos：🕘 历史版本弹窗落点与 ⏰ 定时任务弹窗对齐（2026-10-04 用户：「历史版本按钮的弹窗，
//   有点偏中下部了，最好弹窗和定时任务弹窗保持一致」）——删掉 overlay 上的内联底部锚定
//   （alignItems:'flex-end' + paddingBottom:'8vh'），改用 overlay 默认的顶部锚定 14vh；
//   「拖上边缘时顶边跟随光标」的手感由新增的 verOff 偏移保留（marginTop:-verOff，每次打开归零）。
//
// v20261004-selfcheck1：**运行前自检（轮 1）**（2026-10-04 用户拍板：「分多轮实现，每轮实现不同的自检，
//   不用输出报告，运行前自动检查，自检出问题，给出报错提示和解决办法并拦工作流做人工确认」）。
//   ① 判据唯一真源：新增 `src/executor/selfcheck.ts`（纯函数，永不抛）。轮 1 查四类：结构/引用
//      （复用 parseAndValidate 转成分级项）、**模板引用前缀指向不存在的节点**（REF_UNKNOWN）、
//      从 start 不可达（UNREACHABLE，warn 不拦）、环路（CYCLE，提示"要回跳重试用 loop 循环体"）。
//      每条都带 `fix`＝**解决办法**（用户明确要求）。
//   ② host `/run` 执行前自动跑：有 error → **409 { blocked:true, selfcheck }** 拦下（warn 不拦）；
//      带 `skipSelfcheck:true` 重发即放行（= 人工确认）。★契约变更：非法 def 以前 500，现在 409+问题清单。
//   ③ 客户端：「⚠ 运行前自检未通过（N 项）」弹窗，逐条 报错提示 +「👉 解决办法」、可点击定位节点，
//      底部**只有「✕ 去修改」**（★2026-10-08 用户收严：不提供"仍然运行"旁路，自检不通过就必须去改）。
//   后续轮次：轮 2 参数必填/分支键/switch 一致性/goto；轮 3 loop 边界/merge/subflow 依赖/模型存在性；轮 4 建议类。
// v20261004-failchip-drag：两项"可选增强"落地（2026-10-04 用户：「可选的增强（fail 边显形、拖拽 CDP 用例
//   做稳），处理下」）。
//   ① **fail 策略显形**：失败策略此前只在右侧面板的下拉里（goto 更是个"看不见的跳转"）。现在
//      FlowPanel 把 def 里的策略同步进 `flowgram/failPolicyStore`，画布卡片底部显示一枚小 chip：
//      ⏭ 跳过支路（青）/ 🛟 忽略失败（绿）/ ↪ 失败→<目标名>（紫）；**默认「停止这条支路」不显示**（不制造噪音）；
//      chip 的 title 写明确切语义。★没做"一条红色虚线 fail 边"：goto 是执行器的**失败边**、不在 def.edges 里，
//      真写进 edges 会被当普通边无条件激活（改变语义），自绘非文档边则要自己跟随缩放/平移，风险远大于收益。
//   ② **拖拽 CDP 用例做稳**：三个长期间歇失败的用例改用 **CDP 真实鼠标输入**（`Input.dispatchMouseEvent`，
//      driver 新增 mouseMove/mouseHover/mouseDown/mouseUp/dragMouse）——旧写法在页面里合成 MouseEvent，
//      与 playground 的 hover/拖拽状态机时序对不上（"hover 没起线"）；dragMouse 还**从旁边接近端口**再按下
//      （同坐标重复移动可能被合并成 no-op）。`branch-labels` 不是拖拽用例，它的抖动来自"点标签后编辑器没开
//      就抛错" → 改成容忍落空 + 整体重试一轮。实测三案各连续 3 次全过。
// v20261004-sched-inline：⏰ 定时任务弹窗两处交互修正（2026-10-04 用户原话：「定时任务的立即运行一次，
//   是 windows 弹窗，给出修改；另外立即运行一次按钮不要放在第二行，放在 corn 表达式右边」）。
//   ① 二次确认从 `window.confirm`（Windows 原生弹窗）改成**应用内确认弹窗**：与其它弹窗同一套约定
//      （右上 ✕、hint 小字浅色、底部左「✕ 取消」右「▶ 确认运行」），写明费用提醒 / 执行期间不等人确认 /
//      「不影响定时档期，下次仍按 <cron 中文预览> 触发」；**确认前不发请求**。
//   ②「▶ 立即运行一次」从独立的第二行（.dsh-wf-sched-actions）挪进 cron 那一行、紧贴输入框右侧
//      （紧凑次级按钮 .dsh-wf-sched-run）。
// v20261004-sweep：**轮 5 清尾**（2026-10-04）——四轮合并的收尾：性能 / 便利性 / 老数据适配。
//   ① 性能：DAG 跳过判定加"内容版本号"短路 + 预计算入/出边键 → 2000 节点链 772ms→24ms、
//      4002 节点菱形 4356ms→45ms、失败传播链 5003ms→48ms（基准脚本 tmp-test/bench-executor.mjs）。
//   ② 便利性：问题面板新增「失败后跳转的目标在本节点之前 → 不会生效」warn（goto 只对还没跑到的层生效）。
//   ③ 修 bug：画布 util/flowDef 的 fromRF 原来**按字段白名单**重建节点 → `tolerate`（面板「忽略失败」）
//      会在任何一次画布编辑后被静默丢掉；改成"以模板节点为基础覆盖"，未登记字段也保留。
//   ④ 老工作流适配：数字节点 id 规范化、回跳 goto/cfg:continue 等死配置清理、switch cases 与出边对齐
//      （数据修正，不涉及插件代码）。
// v20261004-goto-edge：**失败后跳转（onError.goto）进 DAG**（2026-10-04 轮 3）——失败策略四档补齐。
//   ① 引擎：节点失败且未容错、策略为 goto 时，跳过本节点的下游 → 跳到目标节点继续（**失败边**）。
//      ★ 目标**只执行一次**：目标若排在源节点之前（已执行/已过它那一层），跳转不生效、按「停止这条支路」
//      处理，并把原因写进该节点的错误消息（悬浮卡/失败详情能看到「未重复执行」，不静默）。
//      实现上把"跳过判定"改成**每层从零重算**（hardDead 是唯一事实来源），goto 只要把目标放进
//      gotoTargets 就能"复活"一个本来会被跳过的节点，级联自动重算干净（增量累加做不到这点）。
//   ② 面板：「🛟 本节点失败后」补第 4 项「↪ 失败后跳转到指定节点」（选中即出现「↪ 跳转目标」行）；
//      目标下拉里**排在本节点之前**的候选会标注「⚠ 在本节点之前执行，跳转不会生效」。
// v20261004-fail-policy：**失败策略合一 + 引擎侧真生效**（2026-10-04 轮 2，用户原话：「开始轮 2 实现，
//   画布右侧编辑页面的失败策略和失败后不影响流程，这两个配置要合并到一起，避免歧义」）。
//   ① 面板：两个入口（🛟 失败策略 select + 🛟 失败不影响流程 checkbox）合并成**唯一一个**「🛟 本节点失败后」下拉，
//      三项互斥、写入时清掉另一个字段（零数据迁移，底层仍是 onError / tolerate 两个旧字段）：
//        ⛔ 停止这条支路（默认，算运行失败）= onError:'stop'
//        ⏭ 跳过这条支路，不算运行失败       = onError:'continue'（下游不走 + 不计失败）
//        🛟 忽略失败，下游照常执行           = tolerate:true（下游照常 + 不计失败）
//      旧数据若已设 goto，显示为只读的当前项（引擎支持待轮 3）。
//   ② 引擎：DAG 执行器开始读失败策略，语义 = **只停该节点的下游，其它分支继续**（旧实现是全图停）。
// v20261003-autopass-visible：**非交互运行下 manual 节点被自动放行，这件事要显形**（用户真机反馈原话：
//   「定时任务自动触发的运行，手动确认节点自动跳过」）。核实结论：这是**设计如此**（非交互 = 没人能确认，
//   定时触发 / 「立即运行一次」/ CLI / 子工作流内部一律自动通过，out.autoPassed=true + 宿主 warning 日志），
//   但此前界面上完全看不出来——节点卡只看得出「成功」，用户会以为有人确认过。
//   用户拍板 **A 方案：保持自动通过，但把它「显形」**（否掉 B 挡住不跑 / C 改成真暂停等待）。
//   落地（纯客户端，宿主未改）：①节点悬浮卡徽标加青色「⏭ 自动通过」（.is-auto）；②悬浮卡加一行说明
//   「这次是非交互运行，没人能确认，manual 节点被直接放行——不是失败，也不代表有人确认过」；
//   ③⏰ 定时任务弹窗在「本工作流含 N 个手动确认节点」时加一行提示，说明定时跑时会自动通过。
// v20261003-sched-visible：定时运行的**界面可见性**（用户真机反馈原话：「定时任务执行，工作流的状态不会变化」）。
//   根因：逐节点状态轮询只挂在「手动点运行」那条路径上，而定时触发是宿主调度器直接调 runWorkflow ——
//   既没登记进 /run/status 的表，客户端也无从知道，于是画布不点亮、头部无运行态。
//   修法（两层）：①宿主把定时运行登记到与手动运行**同一张表**（src/adapter/runRegistry.ts，带 origin:'schedule'），
//   运行结束后按工作流名保留「最近一次完成」，让 /run/status?name= 能回退给客户端收敛终态；
//   ②客户端加**后台监视器**：面板挂载期间轮询 /run/status?name=<当前工作流>（空闲 2.5s / 检测到在跑切 600ms），
//   任何来源的运行都点亮画布与头部运行态，跑完自动收敛；手动运行期间让位（manualRunRef）避免两套轮询互抢；
//   ⏰ 弹窗开着时，跑完顺手刷新「上次/下次」。附带：定时运行现在也能被「⏹ 取消」（走同一张表）。
// v20261003-scheduler：定时任务弹窗（用户原话：「之前的定时任务方案，实行了」；方案见 docs/SCHEDULE-PLAN.md，
//   5 项决策此前已全部拍板）。客户端只做配置 UI + 状态显示：头部 ⏰ 按钮 → 「⏰ 定时任务」弹窗（黄色费用提示 /
//   调度器心跳 / 每条 cron 输入 + 中文预览 + 启用开关 + 行尾删除 + 上次·下次时间 + ▶ 立即运行一次 / 底部虚线 ＋ 添加）。
//   cron 校验与中文预览直接复用宿主同一个纯模块 src/adapter/cron.ts（面板预览与宿主执行同一套语义）；
//   改动即自动保存（cron 输入 1.2s 防抖；非法 cron 本地就不发请求、只显示红字）；「立即运行一次」二次确认。
// v20261003-copy-toast：变量复制反馈改浮窗（用户 2026-10-03 原话：「画布的右侧编辑画板里面，上游变量复制和输出变量复制，
//   提示信息，改为浮窗提示：已复制xxxx」）——原实现是在面板底部补一行行内小字（`.dsh-wf-panel-hint`「已复制：xxx」），
//   面板一长就得往下找、还占版面。现在：Portal 到 document.body 的 fixed 浮窗 `.dsh-wf-copy-toast`（底部居中、
//   入场轻微上浮、约 1.6s 自动消失、`pointer-events:none` 不挡操作），文案「📋 已复制 <复制到的变量引用>」。
//   状态用 `{text,n}` 记次数：连点同一个 chip 也能重新弹出（只存字符串时 React 不重渲染、计时器不重置）。
//   作用范围仅「上游变量 / 本节点输出 / 全局变量」三组 chip 的复制反馈；节点悬浮卡的复制按钮（nodes.tsx 的
//   「✓ 已复制」）与失败详情弹窗的复制提示不在本次范围内，未改。
// v20261003-view-zoom：画布视图控件（用户 2026-10-03 原话：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，
//   画布上的节点太小了，无法看清，最好可以一键放大缩小，方便修改」）——根因：onAllLayersRendered 里**每次渲染都
//   fitView**，大图被硬塞进视口（~30%），节点看不清；而且「适应画布」按钮与这个自动行为重复，所以"没啥用"。
//   ①进画布只设一次初始视图：自适应但夹在 [75%,100%]，**取景保持原样 = 整图内容居中**，此后不再自动改视图
//     （用户自己缩放/拖动后不会被抢回去）；
//   ②「⤢ 适应画布」只由点击触发，缩放下限 50%（大图仍能一键看全貌）；
//   ③「−/＋」按档位一键放大缩小（25/50/75/100/125/150/200%），百分比读数可点 = 「1:1」= 一键回 100%；
//     缩放围绕**当前视口中心**，视觉上不跳。
//   ★ 2026-10-03 用户指示「70%挡位改为75%」：可读下限与档位表一起改（否则进画布那一刻的缩放不在档位上）。
//   ★ 踩坑（真机回归）：初版把居中目标写成起始节点（nodeBounds(start)），等于把整张图往右推——右半边被插件
//     自己的右侧检查器面板（.dsh-wf-right，absolute 浮层）盖住，端口点 elementFromPoint 命中面板，连拖线都
//     起不来（CDP switch-chips 3/3 挂）。改为整图内容居中后恢复。
// v20261003-switch-chips：switch 分支键改「横排 chips」（用户 2026-10-03 反馈：截图里 quick/full/video/image/
//   其他 五个键在卡内**逐行竖着堆**，「很别扭，也会遮挡」→ 原型三选一后拍板 A）。三档策略（端口位置与连线
//   行为一律不变，全部出自同一个 `switchLayout()`）：
//     ≤3 个 case：`labels` 逐行标签（保持原行为，行数少不别扭）
//     4~6 个    ：`chips` 端口行只留极淡序号 ①②③…（右侧与端口同高），分支键**横排成一行 chips** 贴在
//                卡片底部做图例（`1·quick` `2·full` … `★其他`），悬停 chip → 对应行序号高亮放大，拖线不认错；
//                 行距 30→16px、端口起点仍是 22px，5 个 case 卡高 166→**136px**
//     ≥7 个     ：`tight` 行距 12px + 卡内不留字（20 个 case 时 chips 会换很多行，故不启用）
//   ★ 为什么 chips 在底部而不是标题下：实测卡片头部（图标+标题+类型+副标题）本身 ~80px，chips 若放标题下、
//     端口就得整体下移到 112px 起，卡片反而从 166px 涨到 192px（「优化」把节点撑更高，被否）。放底部做图例后
//     端口仍从 22px 起，卡片反而更矮。
// v20261003-loop-jump：子工作流跳转（用户 2026-10-03 原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点
//   可以直接跳到子工作流里面，子工作流也可以一键切回到父工作流的循环节点」）——用户拍板：返回入口用
//   **header 返回胶囊 + 面包屑**（变体 A），适用范围 **loop（循环体）+ subflow（引用的子工作流）**。
//   ① 双击节点 → FlowGramCanvas 的原生 dblclick（此前双击无绑定）→ FlowPanel 判定：
//      loop 取 `params.body.workflowName`、subflow 取 `params.workflowName`，为空则提示「还没选」；
//   ② 跳转前先把当前工作流 flush 一次（重挂载会清掉 2s 防抖计时器，不 flush 会丢盘上最新状态）；
//   ③ 导航栈/守卫/错误提示在 src/client/navStack.ts（**与 CDP 夹具共用同一份逻辑**，夹具只模拟「换 def」）；
//      栈里存**父 def 快照**（含未保存编辑）+ 来源节点 id，返回时原样恢复并**重新选中那个循环节点**；
//   ④ 守卫：未选子工作流 / 子工作流不存在（404）/ 自引用 / 会成环 → 只出提示不跳转。
// v20261003-model-label-top：模型下拉「重进就定位到已选模型」+「已选项带选中标记」（用户 2026-10-03 反馈：
//   重进下拉选没有自动定位到已选择的模型；补充口径：点开下拉时已选中的那条要有一个选中状态标记它，
//   没有已选模型时则任何项都不带标记）——①已选中的那条**挪到列表最前**（紧跟占位项），原生 select 展开即在
//   最上面，不用翻几十条；只调顺序、不复制、不改 value；②当前已选那条的文案前加 **`✓ `**（含「存值不在当前
//   列表」的 `✓ ⚠ …（当前值）` 那条）——原生 option 不能设背景/图标，只能用文案前缀，且它在展开列表与收起
//   显示里都会出现；未选任何模型时（selectedModel===''）任何一项都不带 ✓；③同一个节点被换掉 def 时（换工作流/
//   撤销/别处编辑）用一个 effect 把下拉 value 同步回 def（组件按 node.id 加了 key，切节点会重挂载，换 def 不会）。
// v20261003-model-label：AI 节点模型下拉显示**显示名**（用户 2026-10-03 原话：「ai子代理节点里面的选择模型，
//   最好是改成下拉选显示名称改成模型显示名称，不用模型id，不容易分辨，代码里面可以用模型id确定调用的模型」）。
//   option 文案 = 宿主 llm listModels 给的显示名（deepseek-flash → DeepSeek-V41-Flash），同名时补 provider
//   显示名消歧，宿主没给显示名时回退 model id；**option 的 value 仍是 id**（存值/执行不变），下拉下方细字
//   始终给出「执行 id」便于对照 JSON。旧工作流存了列表里没有的 id 时仍按原样显式列出（行为不变）。
// v20261003-loop-body：循环体 = 子工作流（用户拍板方案 A：能复用就复用，不自研）——loop 节点新增
//   `body:{workflowName, inputs}`，每轮按 `{{vars.loopItem}}`（当轮的项/轮次序号）与 `{{vars.loopIndex}}`
//   解析 inputs 后调用该子工作流，**子工作流 end 节点的输出依次收进 `loop.out.items`**——下游写法与无 body 时
//   完全一致（`{{loop1.out.items}}` / `{{loop1.out.items.0.field}}` / `{{loop1.out.count}}`）。
//   `onIterationError:'continue'` 时失败轮写占位继续跑，默认 stop 则整节点失败但已完成轮次保留在 items 便于排查。
//   引擎侧：run.ts 对 loop 的 body **延迟解析**（body.inputs 里引用了每轮才存在的 loopItem/loopIndex，
//   运行前解析必 DATAFLOW_REF）；面板侧：右侧「🔁 循环设置」新增循环体下拉 + 输入映射 + 失败策略。
//   实现只扩 loop 的 run、复用 subflow 调用机制，不动 topoSort/DAG、不需要画布回边。
// v20261003-switch-compact：switch 分支过多把节点撑大、把流程拉散（用户 2026-10-03 反馈）——自适应紧凑
//   （用户拍板 A+A+）：case ≥ 7 时端口行距 30→12px、**卡内标签隐藏**（每条连线中点本来就有分支键标签，
//   信息不丢）、副标题显示「N 个分支」。端口是连线锚点不能隐藏，所以只压行距与卡内标签。
//   实测 20 个 case：卡片 646px → 286px（-56%），8 case 夹具 286→142px；≤6 个 case 行为完全不变（行距 30）。
// v20261003-loop-visible：loop 循环可见化（用户拍板 P1+P2+P3）——loop 此前在画布上「存在感缺失」
//   （卡片副标题只认 count，配了 over/while 就显示错的 `count=?`；出边与普通线无差别；参数只能去 JSON 改）。
//   P1 卡片副标题按**实际生效边界**显示（引擎优先级 over > count > while）：`循环 3 次` / `遍历 5 项` /
//      `遍历 {{上游.out.数组}}` / `while: 表达式` / `⚠ 无循环边界`，并带上 `· 上限 N`；count/while/over 全缺
//      时问题面板同时报 error（运行必 LOOP_NO_BOUND）。
//   P2 右侧面板新增「🔁 循环设置」区（对齐 switch「🔀 分支设置」）：边界类型下拉 + 对应输入框 + 最大迭代
//      次数 + while 的 dangerouslyAllowInfinite 开关；切换类型时清掉其余两种边界（避免"以为生效其实没生效"）。
//   P3 画布循环标记：loop 出边中点挂紫色「循环」小标（明示下游只执行一次），运行后节点徽标追加
//      `· 循环 N 次`（取自 out.count，落 runStatusStore 的 count 字段）。
// v20261003-branch-fix：修「switch 在线上改分支键：切不回原 case、切换很慢」——根因是改键走
//   DefSync 整文档 fromJSON 重建，而 FlowGram 对被替换掉的线回收不完整：每次编辑都在画布上留一条
//   带旧分支键的幽灵线（实测 8→9→10），看着像"没切过去"，线越积越多还越来越慢。修法：
//   ①改键主路径改为**就地改线**（line.updateInfo → rebindLinePorts + fireChange，官方拖线重连内部走它），
//     并把新 sig 标记为「画布自己产生的变更」让 DefSync 跳过重建 → def 1-6ms、画布标签 3-60ms、无残留；
//   ②DefSync 重建前先 dispose「不在目标边集合里」的现存线——兜住新建 case 等仍走重建的路径，
//     也顺带修掉历史上任何结构变更残留的幽灵线。
// v20261003-branch-edit：分支键就地编辑（方案 C）+ 微调——连线中点的分支标签可点击，在锚点处
//   弹出小面板直接选/改/清空分支键（switch 输入新 case 名会同时写进节点 params.cases 并指向本线目标）；
//   if/switch 的出边若没有分支键 → 琥珀虚线「未设分支」告警 + 问题面板同时列出（执行器对这种线按恒激活，
//   即所有分支都会跑）；标签文案改口语「真/假/其他」（原始键名放 title）；switch 卡随分支数自动增高。
// v20261003-branch-labels：分支条件在画布上显形（用户需求 B）——连线中点显示分支键标签
//   （if: true/false，switch: case 名，'*' → 其他）+ true 绿 / false 红描边（走 free-lines-plugin
//   的 renderInsideLine / customLineProps，singleton 覆盖预设空实例）；节点卡右侧给每个输出
//   端口加同高标签（top = 22 + i*30，与 formMeta 的 locationConfig 对齐）。
// v20261003-picker-path：「打开/新建工作流」下拉里，每个工作流名称后置灰显示它的落盘路径
//   （GET /workflows 每项新增 path 字段；路径跟随目录分隔符、单行省略、完整值放 title；
//    复制出的新行也按 storage.dir 推算路径）。
// v20261003-manual-confirm：manual（手动确认）节点从 v0.1 空壳改为真暂停 + 恢复——
//   POST /run 撞上 manual → 202 { status:'awaiting', runId, awaiting }（不 hold 连接），
//   客户端头部 ⏸ 徽标 + 确认弹窗（底部左「✕ 取消本次运行」右「✓ 确认并继续」，右上 ✕ 只关弹窗），
//   备注经 POST /run/resume 进入 out.value 供下游 {{节点id.out.value}} 取用；
//   GET /run/status 支持刷新后恢复等待态；非交互路径（CLI 工具/subflow 内部）自动通过 + warning。
// v20261002-next-map：分支键 next（if 的 {true,false} / switch 的 { case值: 目标 }）收编为
//   WORKFLOW_SCHEMA.next.oneOf 的单个 object 分支——原来 host schema 只认 {true,false}，
//   画布 fromRF 每次保存都在产 case 映射 → 保存过的 switch 工作流全部报「结构校验未通过」。
//   客户端 JsonView 的精简 schema 同步对齐；校验报错折叠成一条并带「显示名_id(类型)」。
// v20261002-acl1：slots/layout 宿主形状假设收编 src/client/dsh-gate.ts（客户端防腐层）——
//   DSH 客户端升版改 slots/layout API 时只改那边；本文件只做业务编排。
//   之前版本在这里吃过的亏：inject 了宿主没有的服务 → 抛错被 mountContribution
//   路径 catch 不住 → 整个插件静默失败（v0.3→v0.4 教训，已固化为防腐层探测）。

import { applyTheme, getThemeMode } from './theme';
import { mountSidebarEntry } from './sidebar';
import {
  CLIENT_INJECT,
  registerMainPanel,
  dumpMainPanelKeys,
} from './dsh-gate';
import { mountWorkflowPanel, unmount } from './panel-mount';
import { DockedMainPanel, setDockHost, openDockedCanvas, wireDockOpenRequest } from './dock';
import './styles.css'; // ★ 注入插件独立主题样式（esbuild dsh-css-inject 转运行时 <style>）
import './styles-dialogs.css'; // ★ 第二段（弹窗/浮层群）：紧邻上一条 import，运行时 <style> 顺序 = 拆分前段落顺序

// inject 名单唯一来源 = 客户端防腐层（slots=设置页分区/主区面板；layout=面板切换）
export const inject: string[] = CLIENT_INJECT;

export function apply(ctx: any): void {
  // 初始化主题（从 localStorage 恢复 data-wf-theme，默认跟随 DSH）
  try { applyTheme(getThemeMode()); } catch { /* 忽略 */ }
  // 顶层 try/catch：任何 inject 失败不影响其它
  try {
    setDockHost(ctx ?? null);

    // 1. 侧栏入口（左上方"新会话"按钮下方）：点击 = 直接切到主区域停靠画布
    //    （与"新会话"切到会话面板同款交互，不弹窗）。宿主 DOM 锚点/样式拷贝在 sidebar.ts（专职 DOM 防腐点）。
    try {
      mountSidebarEntry(() => openDockedCanvas());
    } catch (e) {
      console.warn('[dag-flow] sidebar entry mount failed:', e);
    }

    // 2. 主区域停靠面板（keyed main，与 conversation/plugins 同机制）。
    //    ★ generator + yield 注册形态与 selectPanel 的 key 校验假设都在防腐层
    //      （注册未生效时切换会抛 "main panel ... not registered"，2026-10-01 真机踩坑）。
    //    ★ 不注册 sidebar.panellist 行：入口按钮即切换，无需额外面板按钮（用户反馈）。
    if (!ctx?.layout || typeof ctx.layout.selectPanel !== 'function') {
      console.warn('[dag-flow] ctx.layout.selectPanel missing; dock switch disabled');
    }
    registerMainPanel(ctx, { key: 'dag-flow' }, DockedMainPanel);
    dumpMainPanelKeys(ctx, 'apply');
    setTimeout(() => dumpMainPanelKeys(ctx, 't+1.5s'), 1500);
    setTimeout(() => dumpMainPanelKeys(ctx, 't+5s'), 5000);

    // 选择/新建工作流 → 换 def 并切到停靠画布（接线收进 dock 模块）
    wireDockOpenRequest();

    // ★ bundle 版本标记：真机 DevTools 控制台可确认加载的是新构建（旧缓存 bundle 无此行）
    console.log('[dag-flow] client v20261015-pickericon · apply OK');
  } catch (e) {
    console.error('[dag-flow] client apply failed:', e);
  }
}

// 也保留 mount/unmount 给外部用
export { mountWorkflowPanel as mount, unmount };

// 默认导出 = { apply, inject, mount, unmount } —— DSH loader 看 .apply 自动调
export default { apply, inject, mount: mountWorkflowPanel, unmount };

// 辅助 re-export
export { FlowPanel } from './FlowPanel';
export { NODE_PALETTE } from './types';
export type { WorkflowDef, MountContext } from './types';
