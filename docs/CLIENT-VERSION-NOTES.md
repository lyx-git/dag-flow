# dag-flow 客户端 index.tsx 版本变更注记（归档）

> 2026-10-16 从 `src/client/index.tsx` 头部**原样迁出**（未改一字）。
> 迁出原因：源码头堆了 445 行变更历史，把文件撑到 508 行、触发 500 行软上限的**假信号**，
> 而新加的版本标记反倒没登记在头部。源码头部现在只留「职责 + 关联文件 + 当前标记」。
> **新变更写在本文件顶部**（并在源码头部更新"当前版本标记"那一行），不要再往源码头追加。

---

// v20261019-selbright2（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「选区同词的底色应该也要提一档」。
//   · `.cm-selectionMatch`（同一词的其它出现）：底色 0.26 → **0.34**，内描边 0.30 → 0.38。
//     仍明显淡于主选区（0.72 失焦 / 0.90 聚焦）⇒ "我选的"与"同词其它处"一眼可分。
//   · 回归锁：`editor-ui` 新增 ⑦d（同词高亮 alpha ≥ 0.30；原来是 0.34 之前的 0.26）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-selbright（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「选区底色可以在高一档试下」。
//   · 主选区底色再提一档：失焦 **0.62 → 0.72**、聚焦 **0.82 → 0.90**（`inset` 内描边与 5px 圆角不变）。
//   · 0.90 已接近实色：选区内文字仍是亮色、可读，但语法色的层次会被压住 ——
//     若真机觉得"盖字/看不清代码颜色"，把聚焦态退回 0.82 即可（一处常量）。
//   · 「同一词的其它出现」仍保持 0.26（更淡 ⇒ 与主选区一眼可分）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63（`editor-ui` ⑦ 断言 alpha ≥ 0.55 仍满足）。
//

// v20261019-selround2（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「编辑区的选区改成圆角，圆还不明显，
//   而且选中选区，会带出其他相同文本的选区，也统一改」。
//   · 圆角 3px → **5px**。实测 CM6 的 `drawSelection` 跨 3 行会切成 3 块，但**块间有重叠** ⇒ 5px 不会在接缝露出缺口。
//   · 「其他相同文本的选区」＝ `highlightSelectionMatches()` 画的 `.cm-selectionMatch`，CM6 默认是**浅绿色方块**
//     （实测 `rgba(153,255,119,0.5)`、`border-radius: 0`），和蓝色主选区完全两个风格 ⇒
//     统一成同色系淡蓝 `rgba(110,165,255,0.26)`（比主选区淡 ⇒ 一眼区分"主选区"与"同一词的其它出现"）
//     + 5px 圆角 + 内描边。
//   · `.cm-searchMatch` / `-selected`（搜索面板的匹配高亮）圆角也一并 2px → 5px。
//   · 回归锁：`editor-ui` ⑦b（选区圆角 ≥ 4px）、⑦c（选中重复词后 `.cm-selectionMatch` ≥ 1 个、圆角 ≥ 4px、
//     颜色属 110,165,255 系而不是默认绿）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-selround（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「编辑器选区现在是方形，改成圆角」。
//   · CM6 的 `drawSelection` 把选区画成 `.cm-selectionBackground` 的绝对定位块（单行一块、多行按行切块），
//     所以 `border-radius` 直接生效。取 **3px** 这个偏小值：单行圆角明显，多行每块各自圆角时接缝处的凹陷不明显。
//   · 与 `inset` 内描边共存正常（描边跟着圆角走），光标（border-left 画的竖线）不受影响。
//   · 回归锁：`editor-ui` ⑦b —— 选区 `borderTopLeftRadius` ≥ 2px（原来是直角 0）。
//   · 出图复核：多行选区的截图见 `tmp-test/build/shot-selcolor.png`（脚本已改成跨 3 行选区，专门看接缝）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-caret（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「编辑区的光标不明显」。
//   · 实测：CM6 baseTheme 给 `.cm-cursor` 的是 `border-left: 1px solid rgb(221,221,221)`，
//     而 `.cm-content` 的原生 caret 是 `rgba(0,0,0,0)`（透明，光标靠 `drawSelection` 自绘）
//     ⇒ 全靠这 1px 灰线，在深空蓝底上又细又灰。
//   · 改成 `border-left: 2px solid #eaf2ff !important` + `box-shadow: 0 0 3px rgba(120,170,255,.85)`
//     （外发光让线在深底上「立起来」，不是单纯提亮）；焦点态 `#ffffff`；`.cm-dropCursor` 一并加粗。
//   · 回归锁：CDP `editor-ui` ⑧ —— 用 `Emulation.setFocusEmulationEnabled` **强制页面焦点**
//     （否则无头环境光标层根本不渲染、量不到），断 `.cm-cursor` 的 borderLeftWidth ≥ 2 且颜色亮度 > 200，测完关闭。
//   · 探针：`tmp-test/cdp/probe-caret.mjs`（打印 cursor 的 borderLeft / 宽高 / 动画 + 原生 caretColor）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-selcolor（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户「编辑器里面，选中的颜色感觉不明显，调整一下」。
//   · 原来统一 `rgba(79,140,255,0.32)`，在深空蓝底（#0b1120~#101a2b）上几乎看不出选区边界。
//   · 现在：基础态 **0.62**、焦点态 **0.82**，各加一层**内描边**（`inset box-shadow`）让边界一眼可见
//     （只靠半透明底色，在深底上边界仍发虚）。
//   · ★ 为什么改在 CSS 而不是 `EditorView.theme`：CM6 内置 baseTheme 对 `.cm-selectionBackground`
//     用了更深的选择器，写在 theme 里会被它盖掉（实测焦点态只生效到基础值 0.42）⇒ 只能在
//     `styles-dialogs.css` 用 `.dsh-wf-cmcode .cm-selectionBackground { … !important }` 压住。
//   · 回归锁：CDP `editor-ui` ⑦ —— 量**计算后**的 alpha ≥ 0.55、选区宽度 > 0（原来 0.32）。
//   · 出图复核：`tmp-test/cdp/shot-selcolor.mjs` → `tmp-test/build/shot-selcolor.png`（肉眼看边界）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-jsonscroll（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：修「JSON 页签改造完没有滚动了」。
//   用户原话：「JSON 页签改造完出问题了，没有滚动了」。
//   · 真因（**我上一版引入的**）：`JsonView` 换成 CM6 的 `CodeText` 后，`.dsh-wf-codetext` **没有高度样式**——
//     它是通用外壳，在参数弹窗里靠 `.dsh-wf-code-ed` 的**像素高度**定高，从来没需要过 `height:100%`。
//     放进 JSON 视图后，`height:'100%'` 这条链在它这里断掉 ⇒ `.dsh-wf-code-ed` / `.cm-editor` 的计算高度
//     变成 auto ⇒ CM6 按内容撑成**整篇 JSON 的高度** ⇒ 再被 `.dsh-wf-json-editor { overflow:hidden }` 裁掉
//     ⇒ 超出部分既看不见、也滚不动。
//   · 修法：`.dsh-wf-json-editor .dsh-wf-codetext { height:100%; display:flex; flex-direction:column }`，
//     高度链一路通到 `.cm-scroller { overflow:auto }`。实测：scroller clientH 864 / scrollH 1987、
//     scrollTop 0 → 200 可滚（maxScroll 1123）。
//   · 回归锁：`json-view` 新增 D10（编辑器可视高度＝容器高度，**与文档长度无关**；塌陷时它会等于内容高度）
//     与 D11（临时灌 200 节点长文档实测真能滚 —— 短夹具本来就没得滚，不能拿它判 bug）。
//     探针：`tmp-test/cdp/probe-json-scroll.mjs`（逐层打印 clientHeight/scrollHeight，一眼定位是哪层塌的）。
//   · 验证：typecheck 0 / 闸门 54/54 / 全量 CDP 63/63。
//

// v20261019-jsoncm6（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户选方案 A ⇒
//   **JSON 页签保留、Monaco 换成 CM6**。这是 Monaco 在客户端的最后一处残留，现已彻底移出。
//   · 做法：`JsonView.tsx` 左栏由 `@monaco-editor/react`（unpkg CDN + 8s 超时回退 textarea）
//     换成 `CodeText({ lang: 'json', height: '100%', status: false })`。校验/提交语义**一个没动**：
//     可见时才与 def 对齐（隐藏期零开销）、校验防抖 400ms、ajv 单例、非法只报错不写回、校验失败禁用「应用 JSON」。
//   · 收益：①首开不再等网络（原来首次 1–5s，且存在"编辑器加载中…"这个第三态）；②删掉 `MONACO_VS_BASE` /
//     `MONACO_LOAD_TIMEOUT_MS` / `MONACO_OPTIONS` / `withTimeout` / textarea 回退分支；
//     ③`@monaco-editor/react` 已卸载，产物里连 `@monaco-editor/loader` 的文案都不再出现（包体 1.80 → **1.79MB**）；
//     ④快捷键与观感统一（Ctrl+F 浮层 / 折叠箭头 / 彩虹括号 / 多光标）。
//   · 回归锁：`json-view` 的 D8/D9（就绪形态＝CM6、无 Monaco 实例）、E6（宿主未重建）、
//     F1（未提交编辑切走再回，改成直接读 CM6 doc）；产物闸门加反向锁「不含 monaco-loader」。
//   · 验证：typecheck 0 / 闸门 53/53 / 全量 CDP 63/63。
//
// v20261019-selall（**纯客户端**，硬刷新）：用户报「编辑区 ctrl+D，同一行有多个相同的文本只能选中一个」。
//   · 实测结论：**Ctrl+D 没坏** —— 同行连续 / 分散 / 跨行三种布局，第 1/2/3 次分别得到 1/2/3 个选区
//     （探针 `tmp-test/cdp/probe-ctrl-d.mjs`）。
//   · 真坑在另一条命令：`selectSelectionMatches`（Ctrl+Shift+L「全选所有相同项」）在**空选区**下直接 `continue`
//     （源码 `if (from == to) continue`）⇒ 光标停在词上按它毫无反应，看起来就像"只能选一个"。
//   · 修法：`cm-code.tsx` 新增 `selectAllMatches` —— 选区为空时先 `state.wordAt(head)` 把词选上，再调
//     `selectSelectionMatches`；并在 keymap 里排在 `searchKeymap` **之前**覆盖原绑定。
//   · 回归锁：CDP `editor-ui` ⑥ 两条（Ctrl+D 三连＝1/2/3 个选区；Ctrl+Shift+L 光标停词上直接全选 3 处）。
//   · 注：本改动先于 jsoncm6 落地、标记被后者覆盖，两处改动都在最终产物里。
//

// v20261019-keys2（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：快捷键说明**改形态**。
//   用户原话：「编辑区提示信息可以改成放到编辑区内右上角的小问号图标，点击查看，放在放大按钮左边」
//   ⇒ 撤掉上一版头部提示带（`.dsh-wf-code-head`，占 24px 高），改成右上角 `InfoTip` 小问号：
//   位置 `right: 50px`（放大把手 `right: 20px` + 宽 24px 的左边）、浮在编辑区内容上**不占高度**；
//   点击弹气泡，内容是四条多光标操作（Alt+拖动 / Ctrl+D / Ctrl+Shift+L / 单击取消）。
//   · 上一版整块删干净：CSS 的 `.dsh-wf-code-head*` 全删、`code-text.tsx` 不再渲染该条带。
//   · 回归锁：CDP `editor-ui` ⓪ 改成 5 条 —— 问号存在、**在放大按钮左边**（几何判据）、在编辑区右上角
//     且不占高度、**不残留上一版头部条带**（反向锁）、点开气泡文案含四种操作；闸门锚点改成 `dsh-wf-code-keys`。
//   · 验证：typecheck 0 / 闸门 52/52 / 全量 CDP 63/63。
//

// v20261019-keys（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：用户原话「多光标快捷键操作写成提示
//   放到富文本框头部」。
//   · 做法：`CodeText` 编辑框顶部加**独占一条带**的提示（`.dsh-wf-code-head`，与底部工具条对称），
//     不是浮层、不遮挡任何输入；内容是 `<kbd>` 键帽 + 一行说明，只讲多光标四件事：
//     `Alt` + 拖动 = 列选 ｜ `Ctrl+D` 选下一个相同词 ｜ `Ctrl+Shift+L` 全选全部相同项 ｜ 单击空白 = 回到单光标。
//   · 取舍：不把查找/折叠/撤销塞进来（否则提示变说明书）；也不做成小问号（用户明确要"提示"＝直接可见）。
//   · 键位逐个核对过实际绑定：`selectNextOccurrence`(Mod-d)、`selectSelectionMatches`(Mod-Shift-l)、
//     `rectangularSelection` 默认 Alt+左键拖动 —— 都来自当前注册的 searchKeymap / 视口插件，不是凭印象写的。
//   · 回归锁：CDP `editor-ui` 新增 ⓪ 三条（提示条存在且三个键位都在、文案含「列选」「回到单光标」、
//     位置在文本区上方且不超出编辑框 = 不遮挡输入）；产物闸门新增 2 条锚点。
//   · 验证：typecheck 0 / 闸门 52/52 / 全量 CDP 63/63。
//

// v20261019-cmui（**纯客户端**，硬刷新；宿主仍 `v20261019-runsperf`）：富文本框（CM6）的视觉与搜索体验一波。
//   用户四条原话：「代码折叠块样式有点丑，折叠箭头有些丑」「括号匹配标注不同颜色，一对一种颜色」
//   「选中括号颜色现在很浅，几乎看不到」「ctrl+F 搜索框出现在底部，颜色，设计样式，都很丑，没有现代化的设计方案」。
//   · 折叠：**不再用 `basicSetup`**（它的 foldGutter 写死文本箭头 ⌄/›，没法只换箭头）⇒ 自己组装扩展，
//     `foldGutter({ markerDOM })` 换成自绘 SVG chevron（展开朝下 / 折叠朝右，两态几何不同），
//     折叠占位改成圆角胶囊，悬停有底色反馈，行号槽那一列也钉了尺寸不再抖。
//   · 括号：新增 `src/client/cm-rainbow.ts` —— 栈式判定嵌套深度，**同层同色、逐层 4 色循环**（`cm-br-0..3`）；
//     只为**视口内**的括号建装饰；文档 > 50 万字符自动跳过（不拿极端文本的性能换彩色）。
//     同时加强 `.cm-matchingBracket`（实底色 + 1.5px 描边 + 白字）与 `.cm-nonmatchingBracket`（红底提示）。
//   · 搜索：新增 `src/client/cm-search.ts` —— 用 CM6 官方 `search({ top, createPanel })` 换成**自绘右上角浮层**
//     （放大镜 + 输入框 + 「N 处」计数 + 上一处/下一处/关闭三个图标按钮），中文文案、圆角深空蓝；
//     输入防抖 150ms 才扫全文算计数（单字符最多数到 1000、零宽匹配防死循环）、Enter/Shift+Enter 跳转、Esc 关闭；
//     `.cm-searchMatch` 换成暖黄高亮。默认那条"底部灰条 + next/previous 英文按钮"不再出现。
//   · 回归锁：新增 CDP `editor-ui` —— 折叠箭头是 SVG 且两态几何不同、点击后出现胶囊占位、括号 ≥3 种颜色且分层、
//     匹配括号 alpha ≥ 0.25 且有描边、搜索面板在编辑区**右上角**、计数 4 处、正文高亮、Esc 关闭，
//     另加两条反向锁（没回退成底部条 / 没漏出英文按钮）。
//   · 性能（30 万字符 3000 行，同口径）：按键 dispatch p50 **10.6ms**（加彩虹前 5.7ms，多的 ~5ms 是每键一次
//     全文深度扫描，仍在 16.7ms 帧预算内）、灌入 68.6ms、滚动 p50 17ms、DOM 363 节点。
//   · 验证：typecheck 0 / 闸门 50/50 / 全量 CDP 63/63。
//

// v20261019-cm6（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：代码级富文本框**整体换成
//   CodeMirror 6**，替掉原来的三层叠加（行号槽 + 高亮层 <pre> + **透明 textarea** + 自研高亮/滚动同步/
//   光标计算/Tab 缩进）。用户 2026-10-19 拍板「采用 codemirror6」，且是在工作区回退后的干净基线上重做。
//   · 为什么换：30 万字符时打一个字符 p50 **1103ms**（textarea 自身排版 ≈420ms 是硬成本，高亮层再排 ≈486ms），
//     任何 CSS/React 微调都动不了；CM6 只渲染视口行，同规模实测按键 ≈1ms、滚动 17ms。
//   · 为什么是 CM6 不是 Monaco：两者性能实测打平（灌入 66–79ms / 按键 33ms≈两帧等待 / 滚动 16.8–22.4ms），
//     体积差 7.9 倍 —— CM6 最小集 **465KB（gzip 156KB）** vs Monaco 3672KB（无 worker）/ 4077KB（内联 worker）。
//     CM6 还**不需要 worker**、同步可用（无 CDN 拉取、无 8s 超时回退、无"编辑器加载中"）。
//   · 落位：新增 `src/client/cm-code.tsx`（basicSetup + 深空蓝主题 + `tok-*` 语义类名 + Compartment 切语言
//     + updateListener 上报光标 + `__cmView` 句柄）；`code-text.tsx` 只剩外壳（高度/放大把手/工具条/状态栏）。
//   · ★ 两类必须补回的"原功能"（CM6 默认不含）：
//     ①**Tab 缩进** —— `basicSetup` 没有 Tab 绑定，不补则按 Tab 会去移动焦点；用
//       `keymap.of([indentWithTab])` + `indentUnit.of('    ')` 恢复「Tab = 4 空格」；
//     ②**插入到光标处** —— 参数弹窗的变量 chip 原本读 `textarea.selectionStart`，现在走
//       `cmViewOf / cmSelection / cmText / cmFocusAt`（`params-editor.tsx` 的 lastEdit 改记编辑器宿主
//       `.dsh-wf-cmcode`，插入后 rAF 里 `cmFocusAt` 复位光标）。
//   · 回归锁：CDP `code-file` 新增 ③b（按 Tab → `    x`）；既有断言全部改成 CM6 的 DOM
//     （`.dsh-wf-cmcode` / `.cm-gutters` / `.cm-content .tok-keyword`）；`params-editor` / `json-handled` /
//     `params-varpick` / `params-images` 的读值·设值改走视图（`__cmView` + dispatch / doc 读值）。
//   · 验证：typecheck 0 / 闸门 47/47 / **全量 CDP 62/62**。
//

// v20261019-tippos（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：修节点结果浮窗「显示到
//   离鼠标很远的上面」。用户原话：「画布里面的节点，鼠标悬浮上去的浮窗，明明底部还有空间，
//   为啥不跟随鼠标显示，反而显示到了离鼠标比较远的上面去了」。
//   · 定性：**不是"跟随不跟随鼠标"的问题，是定位判据用错了高度**。`nodes.tsx` 的 showTip 里写
//     `const W = 420, H = 320`，其中 320 其实是 CSS 的 `max-height`，却被当成"浮窗实际高度"来判断
//     下方放不放得下 ⇒ 节点离窗口底不足 330px 就翻到上方；翻上去时又按 320 让位
//     （`top = cardTop - 10 - 320`），而浮窗真实高度通常只有 100~150px
//     ⇒ 它落在节点上方两三百像素处，看起来"飘到很远的上方"。
//   · 修法：showTip 不再判断，只交出两个锚点（节点下沿 / 上沿）；`ResultTipBox` 里
//     `useLayoutEffect` 量**真实高度**后决定 —— 下方放得下就贴下方（gap 10），放不下才翻到上方
//     并按真实高度让位；连上方都放不下则夹进视口。useLayoutEffect 在浏览器绘制**之前**跑完，
//     没有"先错后对"的闪烁。同时 CSS `max-height` 改成 `min(320px, calc(100vh - 16px))`，
//     小窗口下浮窗不会比可视区还高。
//   · 交互模型**没改**：浮窗仍锚定**节点**、不跟鼠标（鼠标在节点内移动时浮窗乱跳反而难用）。
//   · 回归锁：CDP `node-result-tip` 新增 ⑦b–⑦e —— 断言「无论落上方还是下方，与节点的间距都 ≈ 设计值 10px」
//     （旧实现误翻分支会变成 330-浮窗高≈200+）、不出视口底、且实测高度明显小于 max-height。
//     ★诚实标注：夹具里节点居中，旧实现不一定走到误翻分支，所以这几条对旧代码**未必变红**；
//       修复正确性由"按真实高度定位"的逻辑本身 + 真机观感保证。
//   · 验证：typecheck 0 / 闸门 45/45 / CDP `node-result-tip`+`live-status`+`sched-run` 绿。
//
// v20261019-noflicker（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：修「切换画布时闪一下」。
//   用户原话：「画布切换的时候，为啥画布会闪啊，流程就像闪进来的」。用户从三个方案里选了 **B+C**。
//   · 定性（代码层）→ 三层叠加：①切换工作流＝整个停靠面板重挂（dock.tsx 的 `dockVersion` →
//     `unmount()` + `mountWorkflowPanel()`），FlowGram 编辑器从零初始化，旧 root 拆到新画布首帧之间有空窗；
//     ②初始视图**两次落定**（先 `centerOn` 整图、再 `scrollToView` 平移把入口节点带进来）⇒ 肉眼"跳到位置"；
//     ③首帧要等视口尺寸就绪（`apply()` 最多重试 8×40ms）。
//   · **C｜一步落位**：`ensureVisibleShift` 返回的 `target` 本就是那块安全视口矩形，直接居中它一次到位；
//     需要平移时**跳过 centerOn**。最终结果与"先居中再平移"完全一致（原第二步就是把 target 居中），
//     只是少一次中间落位。不需要平移时仍走 centerOn（一次），异常时仍兜 centerOn。
//     `__df_initialView.applied/ensure` 诊断字段语义不变（applied 仍为"是否成功落过视图"）。
//   · **B｜淡入遮罩**：`.dsh-wf-fg-veil`（画布同底色 + 同点阵，z-index 30，pointer-events:none）盖住空窗，
//     `onAllLayersRendered` 里初始视图落定后（`finally` 保险）调 `revealVeil()` 淡出 120ms；
//     另设 **500ms 兜底定时器**强制揭开 —— 遮罩绝不能永久盖住画布（这条是红线）。
//   · 为什么不选 A（不重挂、复用编辑器）：重挂是有意设计，FlowPanel 内部大量状态跟工作流绑定
//     （选中节点/撤销栈/运行结果/renameFromRef/dirty 等），复用要逐个重置，漏一个就串味 ⇒ 另立项。
//   · 验证：typecheck 0 / 闸门 45/45（新增遮罩类名断言）/ CDP view-controls + button-fit 绿。
//
// v20261019-jsonquiet（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：JSON 视图消掉
//   Monaco 的「易混字符」提示。用户原话：「查看/编辑工作流json的编辑框里面报错：The character U+ff08
//   "（" could be confused with the ASCII character U+0028 "(", which is more common in source code.
//   Adjust settings」。
//   · 定性：**不是 JSON 语法错**、不影响保存与运行——那是 Monaco 的 `unicodeHighlight`，把中文全角标点
//     （（） ，：）当成"可能与 ASCII 混淆的字符"标出来。本视图展示的是用户自己的工作流数据，
//     中文全角标点是正常内容 ⇒ `MONACO_OPTIONS.unicodeHighlight` 三项（ambiguousCharacters /
//     invisibleCharacters / nonBasicASCII）全关，从源头不再弹这类提示。
//   · 合法性判据不变：仍由 ajv 校验（400ms 防抖）+ 顶部 ✅/❌ 条负责，与 unicodeHighlight 无关。
//   · 验证：typecheck 0 / 闸门 43/43 / CDP json-view + json-handled 绿。
//
// v20261019-split3（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：FlowPanel 拆分**完成**
//   —— 1655 → **921 行**（低于 1000 硬顶），共拆出 `src/client/panels/` 四个模块：
//   `run-control.ts`(287) / `node-editing.ts`(216) / `workflow-io.ts`(315) / `render-body.tsx`(246)。
//   · 第 3 批搬「工作流 IO」：saveDefToDisk（renameFrom 语义）、handleSaveToDisk（有名字/不撞名/AI 选模型三项校验 +
//     版本快照）、自动保存 effect（2s 防抖；空名与撞名一律不写盘）、handleRename（改名 + def 内引用同步 + 撞名防抖探测）、
//     导出 JSON·PNG·SVG、导入 JSON。
//   · 最后把文件末尾的 `renderBody`（198 行，**模块级纯渲染**、不闭包组件状态）整体移到 `panels/render-body.tsx`，
//     一次把 1118 → 921。它是"最安全的一块"：所有依赖走参数或 import，搬移零行为风险。
//   · 手法（值得沿用）：**用脚本按锚点抽取原文再包进 hook 骨架**，不手抄代码 ⇒ 零抄写误差；
//     抽出的语句因参数同名解构而一个字都不用改。
//   · ★ 差点出事（dry-run 救了）：`pickImportFile` 的依赖数组是 `[importFile]` 而不是 `[]`，
//     我最初用 `}, []);` 找区间终点，会一路找到 118 行外、把 inputsDlg/schedDlg/监视 effect 全吞进区间。
//     ⇒ **任何按行号/锚点改源码的脚本都必须先 dry-run 打印区间长度与起止行，与预期行数对上再 --apply**。
//   · 验证：typecheck 0 / 闸门 15/15 / 全量 CDP 见交付说明。
//
// v20261019-split2（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：FlowPanel 拆分第 2 批
//   —— 把「节点增删改」整块抽成 `src/client/panels/node-editing.ts`。
//   · 搬走：handleRFChange（画布抛出的改动 → def）、handleDefChange（JSON 视图/装饰节点整份改，含 canonicalizeDef 归一化
//     与"已统一为 edges"提示）、handleSelectNode、handleAddNode、handleDeleteNode、deleteNodeFull（先 dispose 画布实体再改 def）、
//     handleNodeChange（null=删键的补丁语义 + `_label` 专键写顶层 label）。
//   · 位置约束：`useUndoWiring(def, setDef, setDirty)` 不依赖这些函数 ⇒ 先接 undo 线，再调本 hook；
//     而 `handleDefChange` 会写顶部浮窗（`setImportMsg` 来自运行控制 hook）⇒ 本 hook 必须放在运行控制之后。
//   · 行数：FlowPanel **1473 → 1174**（两批累计 1655 → 1174，共 −481）；新文件 `run-control.ts` 287 行 + `node-editing.ts` 216 行。
//   · 验证：typecheck 0 / 闸门 **15/15**（见下面的事故说明）/ CDP 子集
//     `palette-drag,inspector-switch,delete-button,line-drop-panel,label-rename,json-handled` **6/6** / 全量 CDP 见交付说明。
//   · ⚠ 仍超硬顶（1174 > 1000），还差 ~174 行；下一批计划：工作流 IO（saveDefToDisk/handleSaveToDisk/自动保存 effect/
//     handleRename+撞名探测/导出 JSON·PNG·SVG/导入 ≈ 250 行，搬完约 920，够了）。
//
// ★ 事故记录（2026-10-19，务必别再犯）：用 PowerShell 的 `Get-Content -Raw | -replace | Set-Content -Encoding utf8`
//   去改 `verify-build-markers.mjs` 与 `src/client/index.tsx`，把两个文件的**中文全写成乱码**（UTF-8 被按 GBK 读入，
//   外加换行丢失）。处置：①`index.tsx` 在 git 里 ⇒ `git checkout --` 恢复，再重设版本标记（零损失）；
//   ②markers 在 `tmp-test/`（gitignore）**没有备份** ⇒ 先逆向（GBK→UTF-8）恢复，但仍有字符丢失与断行，
//   最终**重写为 15 条核心断言版**并降级说明（原 183 条里"版本标记 / 用户可见文案 / 关键类名 / 产物体积"这几类保留）。
//   铁律：**改文件一律用编辑工具或 node 脚本（readFileSync/writeFileSync('utf8')），永远不要用 PowerShell 的
//   Get-Content / Set-Content 处理含中文的源码**；关键闸门脚本要另有备份或纳入版本控制。
//
// v20261019-split1（**纯客户端**，硬刷新即可；宿主仍 `v20261019-runsperf`）：FlowPanel 拆分第 1 批
//   —— 把「运行控制」整块抽成 `src/client/panels/run-control.ts`。
//   · 起因：2026-10-19 用户新定「单文件硬顶 1000 行、不可突破」（见 CONVENTIONS.md §3），
//     自检发现 `FlowPanel.tsx` **1655 行**是唯一硬违规；NodeInspector 965 / params-editor 571 / doc-extract 563 只超软上限。
//   · 本轮搬走（只搬位置，零行为变化）：运行态 runResults/running/cancelling/cancellingRef/cancelTick/runAbortRef/manualRunRef
//     + applyRunSummary + handleRun（自检→人工确认→真跑→600ms 逐节点点亮）+ cancelRun + importMsg 浮窗
//     + **useManualDialog**（它依赖 applyRunSummary、又要给 handleRun 提供 setter ⇒ 只能一起搬，否则循环依赖）。
//   · 接线要点：`handleRun`/`applyRunSummary` 要写「运行失败详情弹窗」的状态，那个 hook（useRunFailDialog）在
//     FlowPanel 里声明在前 ⇒ 直接当入参传进去（试过用 ref 转发，实际不需要，已简化）。
//   · 行数：FlowPanel **1655 → 1473**（首次净减 182），新文件 287 行。
//   · 验证（第 1 批）：typecheck 0 / markers **183/183** / CDP 子集 `run-button,cancel-run,live-status,manual-confirm,selfcheck-gate,run-log`
//     **6/6** / **全量 CDP 59/59**（含 `undo-redo` / `drag-writeback` / `no-autosave-untitled` / `rename-revert`）。
//   · ⚠ 仍超硬顶，后续批次（下一轮）：①工作流 IO（saveDefToDisk/handleSaveToDisk/自动保存 effect/handleRename+撞名探测/
//     导出 JSON·PNG·SVG/导入 ≈ 250 行）②节点操作与画布导航（handleDefChange/handleAddNode/handleDeleteNode/deleteNodeFull/
//     handleNodeChange/handleNodeDoubleClick/handleNavBack ≈ 150 行）。两批做完约 1070 → 再压注释可到 1000 以内。
//
// v20261019-runsperf（**宿主侧**，需重启 dsh web；客户端另见 `v20261019-split1`）：
//   一次"按开发规范全量自检"里量出来的两处**随规模恶化**的性能点，都在运行记录。
//   · 起因：自检实测 `GET /runs` 45.6ms，而 handler 直调只有 0.36ms；再拆下去发现
//     ①`listRunRecords` 用「readdir + 每文件**串行** fs.stat」枚举（用户机器 343 条 = 23.22ms）；
//     ②`readRunRecord` 只拿到 runId，逐目录试读 ⇒ `GET /runs` 一次读最近 20 条 = 最坏 20×24 次 fs（实测 6.6~27ms，随目录数走）；
//     ③`writeRunRecord` 每次落盘后调 `pruneRunRecords()` **无参** ⇒ 每次都扫全树（24 目录 + 逐文件 open/read 判组）。
//   · 改法（都不改行为语义，只改枚举/定位方式）：
//     ①`listJsonNames(dir, sortBy)` 增加 `sortBy='name'` 分支：`readdir({withFileTypes})` **零 stat**、按文件名倒序
//       （记录名 `run-<13 位 epoch ms>-<rand>.json`，字典序≡时间序），子目录**并行**读；
//     ②`listRunRecords` 扫目录时顺手记 `id → 目录`（模块级 `_runLoc`），`readRunRecord` 优先**精确读**；
//       命中但读不到（文件被删/搬走）⇒ 清该项并回退逐目录试，**不需要精细失效逻辑**；
//     ③`pruneRunRecords(opts.workflowName)`：给了名字只扫**本工作流目录 + runs 根**，不传仍全量清扫（配管/手工调用口径不变）。
//   · 实测（隔离环境造 23 目录 / 342 条，与用户机器同规模）：
//     `GET /runs` **26.52ms → 2.33ms（11.4×）**；写入后 prune 的目录扫描 **2.91ms → 0.34ms（8.6×，且不再随其它工作流增长）**。
//   · 顺带（数据面，非代码）：清掉 23 个孤儿 runs 目录 / 343 条记录（对应工作流已删除，`deleteWorkflow` 只清现存工作流的）。
//   · 回归锁：`test/run-retention.test.mjs` 新增 **[H]**（`pruneRunRecords({workflowName:'wfA'})` 只压 A、B 的 201 条一条不动）
//     与 **[I]**（`listRunRecords` 顺序仍是新→旧——零 stat 排序不能把顺序改坏）⇒ **21 passed**。
//   · 验证：typecheck 0 / markers **183/183** / 离线链全绿 / CDP 子集 `run-log,cancel-run,live-status,run-path` **4/4**。
//   · ⚠ 未做（留给下一轮）：自检还查出唯一**硬违规**——`src/client/FlowPanel.tsx` **1600 行**超用户 2026-10-19 新定的
//     "单文件硬顶 1000 行"（`docs/CONVENTIONS.md` 第 3 节已写入该硬顶）。拆分方案待拍板。

---

// v20261019-wfscoped（**宿主侧**，需重启 dsh web；客户端保持 `v20261019-noautocreate`）：按工作流名分目录
//   ＋ 删除工作流时级联清理。用户原话：「dag-flow插件每个工作流产生的文件都要以 .dag-flow/**/工作流名称/文件
//   的方式存放，如果文件夹不存在，dag-flow需要自动创建；然后删除工作流的时候，也要以这种方式，
//   清理对应工作流的所有文件和文件夹」。
//   · 盘点后的现状（改前）：`workflow/<名>.json`、`workflow/versions/<名>/`、`scripts/<名>/` **已经**按工作流分；
//     而 `runs/run-*.json`、`images/`、`tmp/` 全是平铺；`deleteWorkflow` 只删「定义 json + versions」——
//     `scripts/`、`runs/`、`images/` 一律残留（真机：删完工作流，磁盘上还留着它的代码、运行记录、抽出的图）。
//   · 本轮改法：
//     ① `paths.ts` 新增 `dagFlowScopedPath(kind, wfName)` —— `<数据根>/<kind>/<工作流名>` 的**唯一出处**
//        （名字不合法/为空 ⇒ 退回 `<数据根>/<kind>`，兼容历史平铺文件与无工作流上下文的调用；只算路径不建目录）；
//     ② `Context.workflowName`（`src/types.ts`）由 `executor/run.ts` 注入 `def.name` ⇒ 节点能定位自己的子目录；
//     ③ `runsDir(wfName?)` + `writeRunRecord` 按记录的 `workflowName` 落 `runs/<名>/`；
//        `pruneRunRecords` 改扫「根 + 各子目录」两级；`listRunRecords`/`readRunRecord` 同时兼容两级
//        （历史平铺记录仍读得到）；
//     ④ `dagFlowTmpDir(wfName?)`：doc_parse 的 OCR 临时文件落 `tmp/<当前工作流>/`（下载缓存等跨工作流的仍走根）；
//     ⑤ **删除级联**：`deleteWorkflow` 现在清 6 处 —— `<名>.json`、`versions/<名>/`、`scripts/<名>/`、
//        `runs/<名>/`、`images/<名>/`、`tmp/<名>/`（逐个删、单个失败不阻塞其它）；
//     ⑥ 历史数据：`migrateRunRecords()` 把平铺的 `runs/run-*.json` 按记录里的 `workflowName` 归进子目录
//        （**幂等、无需标记**：归完根目录就没这类文件了；读不出名字的原地不动，不猜也不删）。
//   · **images 也按工作流分（同日追加，用户拍板「全部严格按照要求做，不做兼容」+「只读当前工作流自己的图」）**：
//     ① `imageDir(wfName?)` → `images/<工作流名>/`；`saveImagesToLibrary(items, wfName)` 落子目录；
//     ② `imagePathCandidates(p, wfName?)` **去掉了 `images/` 根目录兜底**（只认本工作流目录 + 上游产物的
//        `<DSH_HOME>` 相对写法）；`loadImageInput(s)` 透传 wfName；
//     ③ 调用链打通：`Context.workflowName` → `ai.ts`（`runSubagentNode(p, ctx.workflowName)`）→ `prepareImageRefs`
//        → `loadImageInputs(specs, wfName)`；doc_parse 抽图走 `landImages(..., ctx.workflowName)` + `meta.imageDir`；
//     ④ `GET /images?workflow=<名>` 只列该工作流的图；「🖼 选图」弹窗带 `workflowName`，「📁 打开图片目录」
//        打开 `images/<工作流名>/`；
//     ⑤ 用户可见文案同步（param-meta 的 images / extractImages、面板下拉、doc_parse schema 描述、选图空态）。
//     ★注意：`resolveImagePath` 的 dshHome 候选**保留**——它接的是"上游节点写出的相对 <DSH_HOME> 路径"，
//       不是旧图兼容；旧图（平铺在 images/ 根）按用户口径**不读**。
//   · **同日再追加两条（用户：「工作流如果没名称，禁止运行和自动保存、手动保存；如果工作流名称发生变动，
//     涉及工作流名称的路径也要同步变更」）**：
//     ① **空名三禁**收敛到一个判据 `hasName`（`FlowPanel`）：自动保存守卫（已有）+ **运行按钮 disabled**
//        + **手动保存按钮 disabled**，两个按钮的 title 各自说明原因（「先在上方名称框里起个名字才能运行/保存」）；
//        两个 handler 里的兜底提示保留（防键盘/程序化路径绕过 disabled）。
//        ★为什么不只靠"点了报错"：用户要的是**禁止**，按钮禁用才符合语义，也免得多点一次才知道。
//     ② **改名搬移扩到 5 个目录**：`writeWorkflow` 的 `renameFrom` 分支此前只搬 `versions/` + `scripts/`，
//        按工作流分目录后新增的 `runs/`、`images/`、`tmp/` **全漏了**（改名后运行记录/抽图/临时文件留在旧名下，
//        等于丢失归属、还会被当成别的"工作流"）。现在 5 个一起搬；**目标已存在时先合并再删旧**
//        （改名时新名字可能已有目录——先跑过又改回来，两边文件都该留住），否则直接 rename。
//   · **同日再追加：改名撞名绝不覆盖（用户拍板 A）**。
//     起因是用户问「工作流改名，如果改完的名称已存在，现在是怎么处理的」——查下来是**静默覆盖**：
//     ①`handleRename` 只改 name、无任何存在性校验；②`writeWorkflow` 直接 `writeFile` 覆盖目标 json；
//     ③再叠加"改名搬 5 个目录"，撞名时对方定义被吃掉、两边 runs/images 混在一起，全程无提示。
//     对比：**创建**路径早已修过同一个坑（`workflow-picker.ts:220`「已存在 → 直接打开它，绝不覆盖」），
//     改名这条漏了 —— 所以按同一把尺子补齐，而不是新立规矩。
//     · 服务端（不可绕过）：`writeWorkflow` 在**写文件之前**判断——带 `renameFrom` 的改名保存，若目标
//       `<新名>.json` 已存在 ⇒ 直接抛「工作流「X」已存在——改名会覆盖它，已拒绝」。普通保存不查（写自己那份）。
//     · 前端（更快的反馈）：`handleRename` 里防抖 400ms 探 `GET /workflows/<新名>`（只在**真改名**时探，
//       否则编辑一个已存在的工作流会立刻误报）⇒ 撞名时状态栏显示「⚠ 名称已存在，换个名字才能保存」、
//       手动保存按钮禁用、**自动保存也停发**（改动留在内存里，等服务端同意才写）。
//   · **同日再追加：用户追问「改成自己的原名会不会误报」⇒ 不会，并补了回归锁**。
//     用户原话：「原来的工作流名是 12345，我改了一下还是：12345，这会不会触发误报，说流程已存在」。
//     答案（判据来源就是实现本身）：探测的比较对象是 `renameFromRef`——**本次改动最初的旧名**，
//     不是磁盘内容。所以 `want === from` 时直接 `setNameTaken(false); return;`，**一次 GET 都不发**，
//     物理上不可能自己和自己比。三条路径都安全：
//       ①A→A（原样没变）：`oldName === newName` ⇒ 根本不记 `renameFromRef` ⇒ 早退；
//       ②A→X→A（打错再改回，用户问的这条）：`want === from` ⇒ 早退；
//       ③改名已保存过（`renameFromRef` 被清空）后再改回 A：此时 A.json 已被搬走 ⇒ 探测 404 ⇒ 不报。
//     ★注意口径：用户随后明确「大小写要区分的」⇒ 前端比较**保持原样字符串精确比较**，不做大小写归一
//      （曾一度想按 `normalizeWorkflowName` 比较以免 `demo`→`Demo` 被当成撞名，已撤回：
//       那与用户口径相反。服务端保存路由本来就 toLowerCase，属既有行为，不在本轮改动范围）。
//   · 新增回归锁（这三条是"确定结论"的凭据，不是"我觉得不会"）：
//     - `tmp-test/cdp/test-rename-revert.mjs`（CDP `rename-revert`）：夹具里先把 `12345` 与 `67890`
//       真写进"磁盘"，然后 ①改成 `12345x`（不存在 ⇒ 不报）②**改回 `12345`（核心：不报 + 保存按钮可用）**
//       ③改成 `67890`（别人在用 ⇒ 必须报）。第③步是**反向锁**——没有它，前两步的绿灯可能只是"探测没跑"。
//     - `tmp-test/ab-rename-self.mjs revert|restore`：A/B 反证。去掉 `want === from` 短路后，用例 B1
//       立刻变红，且请求日志直接抓到它自己探测自己（`GET /workflows/12345 -> 200`）；恢复后转绿。
//     - `test/api-e2e.test.mjs` 新增第 16 组（5 条，真实 HTTP + 真实文件系统）：原样改回自己 → 200；
//       两端规范化后同名 → 200；磁盘上仍只有一份且是最新内容；改成别人名字 → 400 且对方原样保留。
//   · 验证（本轮终）：typecheck 0 / `storage-json` **[8a][8b][8c][9a][9b][10a][10b][10c]**（新增撞名三条：
//     被拒 / 对方 version 仍是 7 且节点完好 / 改名方仍在原位）/ `api-e2e` **103 passed**（+5）/
//     `run-retention` **16 passed** / `storage-workspace` 28 passed / 离线链全绿（所有脚本 0 failed）/
//     markers **183/183** / 全量 CDP **59/59**（新增 `rename-revert`；`no-autosave-untitled` 含 10 条断言）。
// v20261019-migrations（**宿主侧**，需重启 dsh web；客户端保持 `v20261019-noautocreate`）：
//   迁移状态标记从 `workflow/` 搬到 `<DSH_HOME>/.dag-flow/.migrations/`（2026-10-19 用户拍板 A 方案）。
//   · 起因（用户原话）：「.migrated-from-workspace，.fallback-migrated，这两个文件是否必须，如果非必须，则删除」
//     → 答：**必须保留**（它们是防"删了又复活"的护栏）→ 用户追问「这两个文件适合放在哪里，给我建议，先不改」
//     → 给 A/C/B 三选项，他选 **A｜收到 .dag-flow/.migrations/**。
//   · 为什么搬：标记是**插件元数据**，不该混在 `workflow/`（那是用户的工作流数据）。旧位置能"不被当成
//     工作流列出"靠的是 `listJsonNames` 的「点号开头 + 非 .json 结尾」双重排除——搬走后不再依赖这个巧合。
//   · 新布局：`.migrations/workspace.json`（原 `.migrated-from-workspace`）、`.migrations/fallback.json`
//     （原 `.fallback-migrated`），与 `workflow/`、`runs/`、`logs/` 同级。
//   · ★关键：**旧标记兼容** `adoptLegacyMarker()` —— 新位置没有、旧位置有时，视为"已迁过"并把旧标记搬过去。
//     少了这一步，新位置读不到标记 ⇒ 判定"从未迁移" ⇒ 重跑补缺复制 ⇒ 把已删工作流补回来
//     （10-04 那条 bug 的另一条通道，搬目录最容易踩这脚）。搬失败也返回"已迁过"，绝不放行重跑。
//   · 回归锁：`test/storage-workspace.test.mjs` 新增场景 ⑥（3 条断言）——模拟"老机器上标记还在旧位置"：
//     断言标记被搬到新位置、旧位置不再残留、**且兜底目录里的文件一个都没被复制**。
//   · 验证：typecheck 0 / storage-workspace **28 passed**（+3）/ markers **178/178**（+3：`.migrations`
//     与两个旧标记名都在产物里）/ 全量 CDP 待跑。
//   · 真机首次重启会把现有两个标记**自动搬过去**（`workflow/` 变干净，只剩工作流 json）。
// v20261019-noautocreate（**纯客户端**，硬刷新即可；宿主仍 `v20261019-engtimeout`）：自动保存的判据改成
//   **「有没有名字」**（2026-10-19 用户原话：「自动保存改为如果有工作流名称才自动创建，没有工作流名称，就不创建」）。
//   · 前情：`stalecache` 那版把"删除后的画布"重置成 `DEFAULT_WORKFLOW`（名字 **my-workflow**），
//     而 def 一改就进自动保存队列 ⇒ 磁盘上凭空出现 `my-workflow.json`。用户随即报：
//     「工作流删除的时候，立刻就自动创建了一个 my-flow 工作流不合理，不能保持空的状态吗」。
//   · 本版规则（用户定，比"是否已落盘"更简单也更符合直觉）：
//     ① 名字非空 ⇒ 自动保存照常（含首次创建）——用户输入名字即视为"要这份工作流"；
//     ② 名字为空 ⇒ 只改内存、**绝不写盘**；画布是"未命名"的正常状态。
//   · 三处配套改动：
//     ① 自动保存 effect 的守卫：`if (!String(def.name ?? '').trim()) return;`
//        （曾短暂实现过一版"挂载时 GET /workflows/<name> 探测是否已落盘"的方案，已按用户新规则**整体移除**）；
//     ② `handleRename` 去掉 `name || 'my-workflow'` 的回退 —— 否则"空画布"一碰名字框就变 my-workflow 再被写盘；
//        同时空名时跳过 `scripts/` 前缀与 subflow 名字的联动替换（空名没有前缀可言，替换会改坏路径）；
//     ③ `handleRun` / `handleSaveToDisk` 在空名时给一句人话（"先起个名字"），不把后端 400 抛给用户。
//   · ★同日追加（用户原话：「删除工作流的时候，状态改为未保存，工作流名称那里改为未命名，名称是空的」）：
//     ① 名称框 placeholder `工作流名称` → **`未命名`**（空名不再像"等你填的字段"，而是明确的状态）；
//     ② 状态栏把**空名判断提到 `!dirty` 之前** ⇒ 空名恒显示 `● 未保存`。
//        这条顺序很关键：刚重置的画布 `dirty=false`，按老顺序会走 `✓ 已保存` ——
//        等于告诉用户"这份空白画布存过盘了"，正好是要的反面。
//     ③ CDP `no-autosave-untitled` 的 A 段补了两条断言：状态栏含「未保存」且**不含**「已保存」、
//        名称框 `value === ''` 且 `placeholder === '未命名'`。
//   · 删除后的"空状态"：`dock.tsx` 的 `blankDef()` = 空白模板 + **name:'']（不是 DEFAULT_WORKFLOW），
//     `onDeleted` 与 `pruneStaleCachedDef` 都走它。
//   · 新用例 `no-autosave-untitled`（CDP，**双向**，靠夹具新增的 `/__saves` 记录真实保存请求）：
//     A 段＝`?name=`（空名）拖节点后等 3.6s ⇒ **0 次保存**；B 段＝填上名字后再等 3s ⇒ 保存发生（snapshot=false）。
//     ★ A/B 反证（`tmp-test/ab-autosave-guard.mjs revert|restore`）：把守卫换成注释后重建，
//       A2 精确变红（实测 1 次保存），恢复后转绿。
//   · 夹具配套：`picker-server.mjs` 新增 `GET /__saves` 与 `POST /__saves-reset`（记录保存请求），
//     并给 `GET /workflows/<用例名>-<ts>` 加"已存在"兜底（`deleted` 集合保证删过的不复活）；
//     否则既有依赖自动保存写回的用例（drag-writeback / json-handled / label-rename…）会全部假红。
//   · 验证：typecheck 0 / markers **175/175** / `no-autosave-untitled` 双向 + A/B 反证 / 全量 CDP 待跑。
// v20261019-stalecache（**纯客户端**，硬刷新即可；宿主仍 `v20261019-engtimeout`）：第二轮修
//   「删了还能看到删掉的工作流」。用户装上前一版（delcache）后**仍能复现**：「我重启了，但是打开工作流，
//   还是能看到已经删除的工作流」。
//   · 上一版（`v20261019-delcache`）为什么没治好：它的清缓存挂在**删除成功的那一刻**（picker `onDeleted`），
//     而用户的工作流是**在装上新版本之前就删掉的** ⇒ 删除事件早过去了，清理代码一行都没机会跑，
//     `localStorage['dag-flow:def-cache']` 里的旧 def 原样留着，打开画布照样恢复。
//     一句话：**只解决"以后删除"，没解决"已经删掉的"**。
//   · 本版改法（治本）：`dock.tsx` 新增 `pruneStaleCachedDef()`，在 `apply()` 里启动时跑一次——
//     读缓存 → `GET /workflows` 取真实列表 → **缓存里的名字不在列表里就清掉缓存并 `dockDef=null`**
//     （bump `dockVersion` 让已挂载的面板重挂载，回落到 `DEFAULT_WORKFLOW` 空白工作流）。
//     ★ 拉不到列表（网络/401）时**什么都不做**，宁可留脏缓存也不误清用户正在用的内容。
//     ★ 判据为何成立：自动保存（2s 防抖）会让画布内容及时落盘 ⇒ 正常在用的工作流一定在列表里；
//       不在列表的只可能是"已删除"或"新建后 2s 内没改动就刷新"这种极窄边角。
//   · 两版合起来才是完整闭环：**删除时清（管以后）+ 启动时校验（管历史）**。
//   · 排查中还核实了两件不是原因的事：①磁盘真干净（`workflow/` 0 个 json、`versions/` 0 快照）；
//     ②旧位置的自动迁移不是元凶（`.fallback-migrated` / `.migrated-from-workspace` 标记都在，
//     那个标记的 note 本身写着「2026-10-04 修复「删掉的工作流会复活」」——**同一类问题第三次出现，每次通道不同**）。
//   · 验证：typecheck 0 / markers **173/173**（新增"清缓存日志在产物里"一条）/ 全量 CDP 待跑。
//   · ★仍需真机验：CDP 夹具不加载 `index.tsx` 的 `apply()`（夹具只挂 FlowPanel）⇒ `pruneStaleCachedDef`
//     不在自动化覆盖范围内。用户已用「控制台 `localStorage.removeItem('dag-flow:def-cache')` + 刷新」
//     自行确认症状消失（**等于反向证明了诊断**）；本版是让这件事**不再需要手动做**。
// v20261019-delcache（**纯客户端**，硬刷新即可；宿主仍 `v20261019-engtimeout`）：删掉工作流后它还会"复活"
//   （2026-10-19 用户原话：「我明明把所有的工作流都删了，为啥打开还能看到删掉的工作流」）。
//   · 现场核实（只读）：真机 `GET /api/dag-flow/workflows` 返回 `workflows: []`，数据根 `workflow/` 下
//     **0 个 .json**、`versions/` 0 个快照 —— **磁盘确实删干净了**，问题在浏览器侧。
//   · 真因（两处叠加）：
//     ① 打开工作流时整份 def 会写进 `localStorage['dag-flow:def-cache']`（`dock.tsx` 的 `setDockDef`）；
//     ② 删除走 `workflow-picker.ts` 的 `deleteWorkflow`：DELETE 成功后只「从下拉列表过滤掉 + 该行退场动画」，
//        **既没清缓存、也没通知画布**；而 `dock.tsx` 面板挂载是 `dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW`
//        ——`readCacheDef()` **不校验磁盘是否存在**，于是重新打开画布/刷新页面就把已删的工作流原样恢复。
//     ★连带风险：此时改一下就会 2s 防抖自动保存，把已删工作流**重新写回磁盘**（等于真复活）。
//   · 改法：
//     ① `openWorkflowPicker(onOpen, onDeleted?)` 新增可选第二参；`deleteWorkflow` 成功后 `onDeleted?.(w.name)`
//        （缓存键归 dock 层管，picker 只负责把"删了谁"报上去，不 import 存储细节）；
//     ② `dock.tsx` 的 `wireDockOpenRequest` 传回调：缓存里那份 def 的名字 === 被删名 ⇒ `removeItem`；
//        画布当前显示的正是它 ⇒ 重置成空白（`DEFAULT_WORKFLOW` 深拷贝后 `setDockDef(..., true)` 触发重挂载）。
//        ⇒ 用户不会在一个"已删"的工作流上继续编辑，也就不存在保存复活。
//   · 顺带清数据（用户拍板"都修，顺带清掉孤儿定时任务"）：`schedules.json` 里有一条孤儿定时
//     `sch_8bhqjv → 金融政策日报 cron 0 6 * * * enabled=true`，def 已不存在、每天 6:00 仍在排期
//     （`scheduler.ts` 的"定时项保留、等它回来"设计），而定时弹窗按当前工作流过滤 ⇒ 这条**界面上根本看不到**。
//     已备份到 `backup-20261017-192628/workflow/schedules.json` 后经 `POST /schedules/delete` 删除，现 `items=0`。
//   · ★验证边界（必须说清）：CDP 夹具**只挂 FlowPanel、不加载 dock 层**（无「➕ 打开 / 新建」入口），
//     所以"删除后清缓存 + 重置画布"这条**无法在自动化里覆盖**——只能真机验。
//     `onDeleted?.()` 在夹具里恒不传 ⇒ 对既有 57 项用例零影响（全量 CDP 已跑确认）。
//   · 验证：typecheck 0 / markers **172/172** / 全量 CDP 无回归 / 定时任务已删并读回确认。
// v20261019-engorder（**纯客户端**，硬刷新即可；宿主仍为 `v20261019-engtimeout`）：修我自己上一轮漏改的地方
//   （2026-10-19 用户原话：「网页搜索里面下拉选的顺序也没调整啊」）。
//   · 真因：上一轮「按真机实测重排」只动了**三处里的两处**——
//     ①宿主 `ENGINE_CHAIN`（改了）；②面板说明文案 + `param-meta` 的 auto 释义（改了，都写成新顺序）；
//     ③**`inspector-fields.tsx` 里 SelectBox 的 `options` 数组本身**（没改，还是旧序
//     `bing → ddg-lite → ddg → searxng → anysearch`）⇒ 摘要文字说新顺序、下拉里却是旧顺序。
//   · 改法：options 严格按 `ENGINE_CHAIN` 排（`auto` 永远第一，它是默认值）：
//     `auto → Bing → AnySearch → DuckDuckGo HTML → DuckDuckGo Lite → SearXNG`。
//   · 为什么之前没被发现：说明文案里也有一句「Bing → AnySearch → DuckDuckGo → …」，
//     按 `indexOf` 比对产物字符串会被这句**误命中**（假绿）⇒ 顺序只能靠 CDP 守。
//   · 新增 CDP 用例 `engine-order`（`tmp-test/cdp/test-engine-order.mjs`，已登记进 `run-all.mjs`）：
//     拖 web_search → 开参数弹窗 → 点开「搜索引擎」→ 读 `.dsh-wf-sel-opt .dsh-wf-sel-label` 的**真实渲染顺序**，
//     与期望数组全等比对 + 单独断「AnySearch 在两个 DuckDuckGo 之前」。
//   · A/B 反证（`tmp-test/ab-engine-order.mjs revert|restore`）：切回旧序重建后用例**精确变红**
//     （实测输出 `auto → Bing → DuckDuckGo Lite → DuckDuckGo HTML → SearXNG → AnySearch`），恢复后转绿。
//   · 验证：typecheck 0 / markers **172/172**（新增"6 个引擎 label 齐全"）/ CDP `engine-order` 1/1（A/B 双向）/ 全量 CDP 56→**57 项**。
// v20261019-engtimeout（**宿主侧为主**，客户端只升标记；需重启 dsh web + 硬刷新）：压短引擎超时
//   （2026-10-19 用户拍板「选择A」：单引擎约 8s、SearXNG 每实例约 4s）。
//   · 为什么改：上一轮重排顺序后，ddg/ddg-lite/searxng 虽退到链尾，但**一旦真轮到它们**仍要
//     22.7s / 34.6s / 48.0s 才失败 —— auto 全挂时用户要等 105s 才看到报错。
//   · 改法（`src/adapter/search.ts`）：
//     ① 新增 `ENGINE_DEADLINE_MS`（bing/anysearch/ddg/ddg-lite 各 8000）——引擎级**总** deadline，
//        含它内部的 3 次重试；到点放弃换下一个引擎。
//     ② `SEARXNG_INSTANCE_TIMEOUT_MS = 4000`（原每实例 8s）⇒ 6 实例最坏 48s → 24s。
//     ③ deadline 用 **`Promise.race`** 兜住，不只是 `AbortController.abort()`：abort 只是"请求它停"，
//        若底层 fetch 卡在不响应 signal 的状态，`await` 会永不返回、整个搜索挂死。**这是本轮实测发现的
//        真缺陷**：只 abort 时用例跑满 300s 都不返回（`test/search.test.mjs` A12 复现），加 race 后 8s 准时结束。
//     ④ 另补两处守卫：`fetchHtml` 开头检查 `signal.aborted`（已 abort 时 addEventListener 不补发事件，
//        内部请求会白跑满 12s）、`fetchHtmlWithRetry` 循环开头 break（超时后别再补请求）。
//   · 真机复测（`tmp-test/probe-engine-timeout.mjs`，加载 dist + 本地 server + 真实网络，逐个 provider）：
//     | 引擎 | 改前 | 改后 |
//     | bing | 645ms | **720ms**（5 条，不受影响） |
//     | anysearch | 2715ms | **1744ms**（5 条，不受影响） |
//     | ddg | 22731ms | **8007ms**（超时放弃） |
//     | ddg-lite | 34632ms | **8011ms**（超时放弃） |
//     | searxng | 48040ms | **22986ms**（全实例失败） |
//     ⇒ auto 全挂最坏 105s → **39s**；正常路径（第一个就命中 bing）毫无变化。
//   · 副作用（单列）：① 网络极慢时 bing/anysearch 若超过 8s 会被判超时转下一个引擎（实测两者 ≤2.7s，余量充足）；
//     ② 错误信息里出现「超时 8000ms 未返回」，聚合到 `SEARCH_FAILED` 的 message 里。
//   · 验证：typecheck 0 / markers **171/171**（新增超时文案锚点）/ 离线链 exit 0 / search **24/24**（新增 A12）。
// v20261019-engineord（**宿主+客户端都改**，需重启 dsh web + 硬刷新）：内置搜索链**按真机实测重排**
//   （2026-10-19 用户原话：「网络搜索免费的尝试顺序调整一下，哪些比较好用的都移到前面来」）。
//   · 实测方法：`tmp-test/probe-engine-order.mjs` 走**真宿主** `POST /api/dag-flow/run-node`
//     （nodeType=web_search、逐个指定 provider），中英文各一次、共 10 次调用。结果：
//     | 引擎 | 成功率 | 平均耗时 |
//     | bing | 2/2 | **645ms** |
//     | anysearch | 2/2 | **2715ms** |
//     | ddg | 0/2 | 22731ms（fetch failed） |
//     | ddg-lite | 0/2 | 34632ms（fetch failed） |
//     | searxng | 0/2 | 48040ms（公共实例全超时） |
//   · 改法：`ENGINE_CHAIN` 由 `bing → ddg-lite → ddg → searxng → anysearch`
//     改为 **`bing → anysearch → ddg → ddg-lite → searxng`** —— 能通的提到前面，DDG 系与 SearXNG
//     留在链尾兜底（**没删**：换网络环境/换公共实例时它们可能可用，只是不再排在前面白等几十秒）。
//   · 副作用（重要）：改前若 bing 失败，会先白等 ddg-lite(34s)+ddg(22s)+searxng(48s) 才到 anysearch；
//     改后第二个就是 anysearch ⇒ bing 不可用时**找得到结果的路径短得多**。
//   · 文案同步：`inspector-fields.tsx` 的 auto 说明、`param-meta.ts` 的 provider 释义、
//     `docs/ERROR_REFERENCE.md` 的 SEARCH_FAILED 说明都写成新顺序。
//   · 用例同步：`test/search.test.mjs` A4 原来断「bing 判 0 条 → 回退 ddg-lite」⇒ 改成「→ 回退 anysearch」；
//     A5 的 ddg-lite uddg 解码改为**直接指定 provider=ddg-lite**（它已排在链尾、A4 不再触达）。
//   · 验证：typecheck 0 / markers **170/170** / 离线链 exit 0 / search 23/23 / 全量 CDP 见交付记录。
// v20261019-nohost（**宿主+客户端都改**，需重启 dsh web + 硬刷新）：删掉 web_search 的「宿主优先」通路
//   （2026-10-19 用户原话：「网络搜索依赖 dsh-free-search 插件的内容都删掉，不能依赖不稳定的第三方插件」）。
//   · 删了什么（`src/adapter/search.ts`）：整套宿主优先实现 —— `HostTools` / `getHostTools()`（走
//     `hostService('tools')`）/ `normalizeHostOutput()`（兼容 sources|results / MCP content[].text / JSON 字符串）/
//     `toSources()` / `tryHostSearch()`（25s 超时、callId 传参、失败静默回落），以及 `runWebSearch` 里
//     "provider=auto 先试宿主、失败回落内置链"那条分支；`SearchOutcome` 的 `viaHost` 字段也删了。
//     净效果：search.ts 496 → 390 行，**web_search 不再探测也不再调用宿主注册的任何工具**。
//   · 老数据兼容（红线）：节点 schema 的 `provider` 枚举**仍保留 `'host'`**（否则老工作流结构校验直接失败），
//     但运行时 `provider='host'` 会**明确报错**并给改法（「…已移除（不再依赖 dsh-free-search 等外部插件）——
//     请改成 auto 或任一内置引擎」）。不静默降级成 auto，免得用户以为还在走宿主。
//   · 客户端：`inspector-fields.tsx` 删掉「仅宿主」这个正常选项（改为"当前值兜底项"——只有老节点存着
//     `provider:'host'` 时才出现，文案「（当前值：仅宿主，已移除）/ 运行会失败——请改成 auto 或任一内置引擎」）；
//     auto 的说明文案与 `param-meta.ts` 的 provider 释义都不再提宿主，改成"只走内置免 key 引擎"；
//     `client/types.ts` 的 web_search out 字段表删掉 `viaHost` 一行。
//   · ★**必须保留的**：`search.ts` 文件头的 **MIT 版权声明**（"引擎适配器移植自 dsh-free-search 0.4.36，
//     MIT License，© DDDMUC"）以及两处"常量/小工具移植自…"的出处注释 —— 那是**许可证义务**，与"是否依赖
//     那个插件"无关（代码是复制进来自己维护的，不是运行时依赖）。删掉它会违反 MIT。
//   · 文档：`docs/ERROR_REFERENCE.md` 的 SEARCH_FAILED 说明改写；`docs/PARAM-LABELS.md` 重新导出
//     （`node tmp-test/export-param-labels.mjs`，仍 20 节点 / 90 条）。
//   · 用例翻转：`test/search.test.mjs` B 段整段重写 —— B1「宿主注册了 web_search 工具也**不再被调用**」
//     （用 called 计数，正面证明零依赖）、B2「out 里不再有 viaHost 死字段」、B3「老数据 provider=host →
//     明确报错并给改法」；`node-matrix` 的 16b 去掉 `viaHost === false` 断言。
//   · 验证：typecheck 0 / markers **169/169**（新增 `!h.includes('host:web_search')` 锚点证明通路真没了）/
//     离线链 exit 0（search 23/23、node-matrix 58/58）/ CDP 子集 3/3 / 全量 CDP 见交付记录。
// v20261019-testbarin（纯客户端，硬刷新即可）：试跑条整体内缩，不再贴弹窗左边框/下边框
//   （2026-10-19 用户原话：「参数与试跑弹窗左下角的试跑本节点按钮几乎和弹窗最下边的线重合了，
//     做下区分，往右边上边移动一些，不要紧贴弹窗的边缘线」）。
//   · 真因（先量后改，不靠猜）：`.dsh-wf-params-dialog` 自身 padding 是 0，参数区靠
//     `.dsh-wf-params-split { padding: 0 20px 16px }` 缩进；而底部试跑条 `.dsh-wf-testbar` 是
//     **dialog 的直接子元素（在 split 之外）** ⇒ 拿不到那 20px。实测按钮「左边距边框 1px / 底边距边框 1px」
//     （那 1px 就是弹窗自己的 border），所以看起来像贴死在边框上。
//   · 修法：`.dsh-wf-testbar { margin: 12px 20px 16px }`（原 `margin-top:12px`）——左右 20px 与参数区同缩进、
//     底 16px 与 split 的 padding-bottom 一致；顺带**顶部分隔线也跟着内缩**（不再横贯到边框）。
//   · 实测（1101×546 弹窗、视口 900）：按钮左距边框 **1 → 21px**、底距边框 **1 → 17px**；
//     试跑条自身左边 20px、底 16px。
//   · 回归锁：CDP `params-testbar` 新增四条几何断言——左留白 ≥12、底留白 ≥12、试跑条整体内缩 ≥12、
//     且**不过分缩进**（左留白 ≤32，防止以后被改成"缩到中间"）。markers 另锚 CSS 值 `margin: 12px 20px 16px`。
//   · 验证：markers **167/167** / 全量 CDP 见交付记录。截图 `tmp-test/build/shot-testbar-geo.png`（探针
//     `tmp-test/cdp/probe-testbar-geo.mjs` 量完自动出图，用 `Emulation` 之外的 clip 裁弹窗 2 倍）。
// v20261019-panelbtn（纯客户端，硬刷新即可）：面板三键尺寸统一 + 删掉参数摘要 + 规范账批次 1
//   （2026-10-19 用户三条要求 + 一个"按推荐方式一起修"的授权）。
//   · ①「右侧编辑面板里面的打开变量弹窗按钮和删除节点按钮的大小都改成和参数与试跑按钮的大小一致」
//     ⇒ 三个按钮统一 `width:100%`（高度本来都由 `.dsh-wf-btn` 决定、同高）。实测：面板 323px 时三键都是
//     263×34；缩窄到 223px 时都是 163×34 —— 等宽且跟着容器走。
//   · ②「参数与试跑按钮的下方，会显示参数情况，不用显示了，清掉吧」⇒ 删掉那行只读摘要
//     （`paramsSummary()` 渲染的 "prompt: xxx · model: yyy"）+ 它的 `.dsh-wf-params-summary` 样式。
//     参数只有弹窗一个入口，按钮上已带「（N 项）」计数。
//   · ③ 规范账批次 1（上一轮自检报的 4 条，按推荐分两批，这是第一批）：
//     a) 删死代码 `visibleRows()`（params-editor，从未被调用）；
//     b) `metaAutoRows` 改 `useMemo`（原来每次渲染都 `Object.entries + map` 重建，规范要求 render 里不建大常量；
//        `paramMeta` 是模块常量表里的同一对象引用，依赖它即可）；
//     c) `extFromContentType` 的 20 项映射表提到**模块级常量** `EXT_BY_CONTENT_TYPE`（原来在函数体里每次调用新建）；
//     d) 单行/多行两个行内 SVG 图标搬到新文件 `src/client/param-icons.tsx`（`params-editor.tsx` 曾 596 行、
//        离 600 硬上限只剩几行 ⇒ 596 → **578**）。
//     ★第二批（把 `rowEl`/`codeToolbar` 拆成 `ParamRow` 组件，可再降约 200 行到 <500 合规）**本轮没做**：
//       它依赖十几个闭包，属"重构"而非"整理"，等这两轮修复真机验完单独开一轮、用全量 CDP 守。
//   · 附带净化：`codeSummary()` 是「批 2 删掉面板代码摘要」时遗留的**死导出**（全仓零调用）⇒ 一并删除。
//   · 用例同步（旧断言会替旧设计站台，两处必须翻转）：
//     `button-fit` ①b 原本断「按钮外框跟随文字（不该被容器拉满）」⇒ 三个按钮移出该断言（它们现在故意整行宽），
//     并新增 ①c **正面断三个等宽同高 + 整行宽**；`params-editor` ① 断「面板有一行只读参数摘要」⇒ 翻转成
//     「摘要不存在」+ 断按钮上仍有「（N 项）」计数。新增 CDP 用例 `panel-buttons`（注册进 run-all）。
//   · 验证：typecheck 0 / markers **166/166** / CDP 子集 5/5 / 全量见交付记录。
// v20261019-jsonhandled（纯客户端，硬刷新即可）：修「JSON 视图里改由专属表单管的参数**静默失效**」
//   （2026-10-19 全量自检抓到、用户拍板 A）。
//   · 现象：选中节点 → 🧪 参数与试跑 → 「JSON 视图」→ 改 path / ocr / count / cases / model 这类键，
//     不报错、界面像改成功了，实际 def 里还是旧值（切走再回来就"变回去"）。
//   · 真因：`onJsonChange` 把 `rowsFromParams(parsed)` 里 handled 行 filter 掉后，`keepHandled()` 又从
//     **旧的 props.params** 回填原值 ⇒ 用户在 JSON 里刚写的新值被旧值覆盖（旧值不存在时整键丢失）。
//     讽刺点：`openJson()` 特意把这些键显示在 JSON 里（注释写"否则用户会以为参数丢了"），看得到却改不动。
//   · 影响面（8 类节点的关键参数）：doc_parse(path/url/maxChars/ocr/extractImages)、web_search(query/provider/
//     count/timeRange)、web_fetch(url/maxChars/raw)、file_save(source/url/content/filename)、
//     session_input(sessionId/limit)、switch(value/cases)、subagent(model)、loop(count/over/roundIf/
//     maxIterations/body/onIterationError)。**字段视图那条路一直是好的**（专属表单直接 onParamsChange）。
//   · 修法：JSON 视图本就代表**整份 params**（parsed 里带着全部键）⇒ 直接 `diffPatch(params, parsed)`，
//     不再 filter + keepHandled；用户主动删键也照旧按"缺键＝删键"处理。
//   · 连带修：`extraFields` 的专属表单（loop 循环设置 / switch 分支 / subagent 模型 / doc_parse 两段式 /
//     file_save 来源）编辑态是 NodeInspector 里的**惰性 useState**；以前 JSON 改不动那些键，所以"切回来是旧值"
//     看不见。现在改得动了 ⇒ 从「JSON 视图」切回「字段视图」时给 extras 容器换一个 key（`extras-<epoch>`）
//     强制重挂载，让它按最新 params 重新初始化。
//   · 验证：新 CDP 用例 `tmp-test/cdp/test-json-handled.mjs`（已注册进 run-all，第 55 项）断四件事——
//     handled 键改得动 / 非 handled 新键照旧 / 切回字段视图显示新值 / 删键语义不变；
//     **A/B 反证**：把实现改回旧版重建后该用例精确变红（`count=3`，即"改了不生效"），还原后绿。
//   · markers **165/165**（新增标记行 + `extras-` 锚点；`diffPatch/parsed` 是局部标识符、minify 后不在产物里，
//     所以这条行为只能靠 CDP 用例守，markers 里写明了原因）。
// v20261019-loophint（纯客户端，硬刷新即可）：删掉 loop「🔁 循环设置」弹窗里两处边界 ⚠ 长句
//   （2026-10-19 用户原话：「⚠ 边界值还是空的…这个提示是啥意思，需要吗」→「有用就不删，没用就删掉」）。
//   · 删的两句：①`loopBound==='none'` 的「没有边界时运行会立即失败（LOOP_NO_BOUND），画布问题面板也会报错」；
//     ②`boundBlank` 的「边界值还是空的——引擎会当作没有边界，运行报 LOOP_NO_BOUND（卡片副标题也会显示「⚠ 无循环边界」）」。
//     判定＝同一事实已在两处说清（画布卡片副标题「⚠ 无循环边界」+ 左下角问题面板 error「循环边界缺失」），
//     弹窗里是第三处；且第②句只在「刚切到 over、值还没填」的过程态出现，填入即消失，属边填边骂。
//   · 保留的：下拉兜底项「（当前值：无循环边界）」+ 小字「运行会失败——请改成 count / over」（控件要有显示值，
//     删了下拉会空白）；画布卡片副标题；问题面板；`legacy` 那条「旧版条件循环已移除」（那是引擎新事实，别处没有）。
//   · 断言翻转：markers 把这两句从「文案在」改成「不在产物里」（反向），并正向断卡片副标题与下拉 sub 仍在。
//   · 验证：typecheck 0 / markers **164/164** / CDP `loop-visible`+`select-box`+`params-editor` 3/3。
// v20261019-docurl（**宿主**改动，需重启 dsh web）：修 doc_parse 抓「首页型 URL」报
//   `DOC_UNSUPPORTED 无法识别文件类型（没有扩展名）`（2026-10-19 用户报「现在修」）。
//   · 真因：url 分支只用 `new URL(url).pathname` 的最后一段当文件名 ⇒ `https://example.com/`
//     的 pathname 就是 `/`，取不到任何段 ⇒ 扩展名为空 ⇒ 按扩展名分派时失败；
//     `.php` / `.aspx` 这类页面壳同理（扩展名不在支持集里 ⇒ 「不支持的文件类型 .php」）。
//   · 修法：新增 `downloadedFileName(url, headers)`（`src/registry/doc-extract.ts`，纯函数、可单测）做**三级兜底**：
//     ① pathname 末段（**仅当其扩展名在内核支持集里**才算数）→ ② `content-disposition` 的 filename/filename* →
//     ③ `content-type` 映射（html/pdf/txt/md/csv/json/xml/yaml/ooxml/图片，另含 `+json` `+xml` 族与未知 `text/*`）。
//     都没有线索时名字退回 `download`（无扩展名 ⇒ 仍然明确报 DOC_UNSUPPORTED，**不静默**）。
//   · 影响面：只影响「此前必然失败」的两类 URL（首页型、页面壳扩展名）。pathname 已是支持类型的
//     URL 一字不动（单测 D 段断 `.pdf` 不被 content-type 改写）；本地 path 分支一行没碰。
//   · 验证：`test/doc-extract.test.mjs` 新增 §7 共 18 条（引擎侧纯函数 + 端到端"补名后能解析成 html"）；
//     `tmp-test/probe-doc-url-name.mjs` 真起 HTTP 服务跑节点 def（12/12，含"旧逻辑对照"复现原缺陷）；
//     `tmp-test/probe-doc-url-live.mjs` 打真宿主 3080（未重启时 1/8 —— 精确复现旧行为，作为 A/B 的 A 侧）。
//     全链：typecheck 0 / markers **160/160** / 离线链 exit 0 / install-check 断言产物含新标记。
//   · 标记：host `v20261019-docurl`（**需重启 dsh web**）；client 仍 `v20261019-toast22`。
// v20261019-toast22：「试跑本节点的结果」浮层从 16vh 下移到 **22vh**（2026-10-19 用户选 A）。
//   · 原因：16vh 时卡片顶边会压住参数弹窗的标题栏（「参数与试跑」那颗标题 + 页签），看着像弹窗自己的内容。
//   · 只改 `.dsh-wf-testtoast { top }` 一处（水平居中仍走 left/right + margin:auto，不用 transform，保住几何断言）；
//     `test-params-testbar` 的 toast 顶边断言同步改成 `0.22`，CDP 量真实几何通过（真机 800px 视口卡片 top≈176px）。
//   · 顺带产出 `docs/PARAM-LABELS.md`（由 `node tmp-test/export-param-labels.mjs` 从 param-meta.ts 导出，
//     20 个节点 / 90 条，供逐条校对中文名与释义措辞；改词请改 param-meta.ts 再重跑脚本）。
//   · 验证：markers **158/158** / CDP `params-testbar` 通过。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-paramtab3：**批 3——loop「🔁 循环设置」搬进「参数与试跑」弹窗**（2026-10-19 用户「开始批3」）。
//   · 整块搬进弹窗 `extraFields`：边界下拉（固定次数 count / 遍历数组 over，老数据给「当前值」兜底）、
//     跑几次（count 单框）、每轮条件 `roundIf`、最大迭代 `maxIterations`（仅 over）、旧 maxIterations 的
//     警示 + 「清除」按钮、循环体（子工作流下拉 + 该子工作流声明的参数列表 + 传参映射行 + `+`）、
//     某轮失败策略（stop / continue）。
//   · `handledKeys` 纳入 `count/over/roundIf/maxIterations/body/onIterationError` **以及三个已退役的 while 键**
//     （否则老节点会在弹窗里冒出三行看不懂的通用参数行）。
//   · `param-meta.ts` 里 `loop.body` 的释义同步改口（原来写"右侧面板「🔁 循环设置」里有可视化编辑"，
//     现在改成"弹窗下方「🔁 循环设置」里可以选子工作流并配传参"）。
//   · **右侧节点面板至此对全部 21 类节点都不再有参数控件**：只剩 显示名 / 节点ID / 节点类型 / 变量引用 /
//     失败策略 / 本节点输出 / 「🧪 参数与试跑」按钮。
//   · 用例同步：`loop-visible` 作用域改到 `.dsh-wf-params-extras` + 每处查询前幂等打开弹窗（切节点后弹窗会随面板卸载）；
//     `select-box` ⑧ 的循环设置段落同样改成"先开弹窗再取 extras 里的下拉"。
//   · 验证：markers **157/157** / 离线链 exit 0 / CDP 全量见交付记录；截图 `tmp-test/build/shot-batch3-loop.png`。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-paramtab2：**批 2——switch 分支列表 + subagent 选择模型搬进「参数与试跑」弹窗**（2026-10-19 用户「开始批2」）。
//   · switch：整块「🔀 分支设置（case 列表）」（每行 case 值 + 说明 + ✕ 删除 + `+` 添加）搬进弹窗 `extraFields`；
//     `value`/`cases` 加入 `handledKeys`（通用行不再重复列，写回原样保留）。
//   · subagent：「选择模型」下拉 + 动态提示（未选警告 / 旧 id 不在列表的警告 / 执行 id 回显 / 模型能力徽标与
//     "已配 N 张图"）全部搬进弹窗；动态内容按项目口径**平铺**（不进问号）。`model` 加入 `handledKeys`。
//   · python/bash：面板那行「📄 代码」只读摘要**直接删除**（代码本来就在弹窗里的语言感知编辑器改，
//     用户上轮明确"删干净之后不用留备注"）。
//   · 面板现在对**全部节点**只剩：显示名 / 节点ID / 节点类型 / 变量引用 / 失败策略 / 本节点输出 / 参数与试跑按钮
//     ——只剩批 3 的 loop 循环设置还是面板控件。
//   · 用例同步：`code-file` ①（面板「📄 代码」行从"只读摘要"改成"已无该行"）、⑥（不再有代码摘要，改成断面板里
//     没有任何代码相关文案）；markers 里那条"面板代码行改成只读摘要"同步反转。其余用例零改动。
//   · 验证：markers **156/156** / 离线链 exit 0 / CDP 子集（select-box / inspector-switch / code-file / params-editor /
//     params-varpick / hovertip / params-images / doc-parse-panel / params-testbar）+ 全量见交付记录。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-paramlabel：**所有节点的参数行统一成「图片生成」那套两行式（中文名 + 参数名注脚）**
//   （2026-10-19 用户原话：「弹窗里面参数的形式，也都要改成和图片生成的样式一样」）。
//   · `src/client/param-meta.ts` 从 2 个节点（image/video）扩到**全部节点**：end / set_var / if / switch / loop /
//     log / manual / merge / subflow / session_input / http / file_save / web_search / web_fetch / python / bash /
//     doc_parse / subagent，共新增约 75 条 label + desc（+ 示例占位与 multi）。文案口径：一句讲清"填什么 / 限制 /
//     为什么"，不写 Markdown、不写新旧对照。
//   · 形态复用图片生成那套：`.dsh-wf-params-kcell.named`（150px）= 中文名 12.5px 正常色在上、参数名 11px 等宽灰注脚
//     在下 + 问号；**参数名只读**（键名是引擎契约，改了静默失效）；未登记的键（用户自己加的参数）仍是可编辑输入框。
//   · 副作用（正向）：登记过的可选参数现在**全部铺出来**（`auto` 语义：留空不写进 def）——以前 http 只露 method/url，
//     headers / body / timeoutMs 用户根本不知道能填；python 的 codePath / cwd / requirements / packages 同理。
//   · 行新增 `data-key` 属性：两行式之后参数名不再是 input，`.dsh-wf-params-k` 的 value 读不到了 ⇒ 测试按
//     `data-key` 定位行（**优先 data-key、回退旧写法**，`__df_prow` 等 7 处已改）。
//   · 单行框的示例占位统一走 `singleLinePlaceholder`（元数据里的多行示例要折成 " / "，否则 input 里换行变空格）。
//   · 验证：markers **154/154**（新增：抽样 5 个只存在于元数据里的中文名 + data-key 锚点）/ 离线链 exit 0 /
//     CDP 全量见交付记录（params-editor ③ 改成"每个 def 键都有行 + 登记键也铺出来"，params-images ②c/③、
//     code-file ④ 的文案断言随新 desc 调整）。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-tipfix：**修「小问号不点在按钮上也会弹提示」**（2026-10-19 用户原话：
//   「小问号现在不直接点在按钮上，也会显示提示信息，有问题」）。
//   · 真因（浏览器默认行为，不是事件冒泡）：小问号被放在 `<label>` 标签里（`row()` 与面板各处「标签 + 问号」
//     都是这个结构），而 `<label>` 会把它**关联到第一个 labelable 后代** —— 问号是 `<button>`，正好是
//     labelable ⇒ **点标签文字上任意位置（离问号几十上百 px 也算）浏览器都会把 click 直接派发给问号**，
//     气泡就弹出来。`stopPropagation` / `preventDefault` 都拦不住（浏览器是"直接对控件派发"，不经冒泡链）。
//   · 修法：InfoTip 根元素 `<button>` → **`<span role="button" tabIndex={0}>`**（span 不是 labelable ⇒ label
//     不再关联它），键盘可达性用 role + tabIndex + Enter/Space 补齐；CSS 补 `box-sizing: border-box`
//     保持 16×16 不变（span 默认 content-box，不补会被 border 撑成 18px）。**一处改动修掉所有"标签包问号"的位置。**
//   · 回归锁（doc-parse-panel）：在弹窗里点问号**左侧 10px 的标签文字** ⇒ 断言气泡**不出现**；再点问号本身 ⇒ 出现；
//     并断问号仍 16×16。**A/B 反证过**：改回 `<button>` 时第一条精确变红
//     （`命中 "dsh-wf-panel-label" / 问号 BUTTON {"w":16,"h":16}`），改成 span 即绿。
//   · 验证：markers **152/152**（新增"小问号是 span role=button 形态"）/ 离线链 exit 0 / CDP 全量见交付记录。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-selzfix：**修「参数弹窗里面的下拉选都不能用了」**（2026-10-19 用户原话：
//   「出问题，参数弹窗里面的下拉选都不能用了」）。
//   · 真因（我们自己上一轮引入的回归）：批 1 把专属表单搬进「🧪 参数与试跑」弹窗，而弹窗遮罩
//     `.dag-flow-picker-overlay` 是 **z-index 10000**；下拉列表 `.dsh-wf-sel-list` 仍是最初服务右侧面板时的
//     **z-index 90**（悬停提示 91）⇒ 列表被整层压在弹窗下面：控件看得见、点开却没有列表、也点不着。
//     DOM 一直在，所以"只断言列表存在"的用例照样绿（select-box ② 就是这种），真机才撞得到。
//   · 修法：交互浮层必须高于所有容器层 —— 列表 90 → **10120**、悬停提示 91 → **10130**（提示在列表之上）。
//     并在 styles.css 里补了一张层级约定表（面板 2~30 / 遮罩 10000 / InfoTip 10006 / toast 10030 /
//     试跑结果浮层 10100 / 下拉 10120 / 下拉提示 10130），规定新增浮层按"最后打开的在上"插值。
//   · 回归锁（select-box，弹窗内点开 OCR 下拉后）：①z-index > 10000 ②`document.elementFromPoint` 命中的元素
//     **在列表内部**（= 没被任何东西盖住）③列表完整落在视口内。**A/B 反证过**：把 z-index 退回 90 时
//     第一条精确变红（`z-index 90 > 10000`），修回即绿。
//   · 验证：markers **151/151**（新增一条：产物里 `z-index: 10120 / 10130` 都在）/ 离线链 exit 0 / CDP 子集与全量见交付记录。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-paramcentral：**节点专属参数表单搬进「🧪 参数与试跑」弹窗（批 1）+ 试跑结果改中上部浮层告知**
//   （2026-10-19 用户原话：「所有节点的右侧编辑模板的参数都改成图片生成节点和视频生成节点一样，挪到参数与试跑的
//    弹窗里面，右侧面板就不再配置参数了，全部挪到一个地方」；「试跑本节点的结果，现在是在弹窗下面显示，
//    改成中上部弹窗告知」。拍板：分 3 批搬（A）、结果用固定定位的中上部卡片（A））。
//   · 盘点结论：21 类节点里有 14 类**本来就只能在弹窗里配参数**（面板没有表单）；真正留在面板的只有 7 个专用块
//     ⇒ 迁移范围＝这 7 块，不是 21 类全重做。本批（批 1）＝ session_input / file_save / web_search / web_fetch / doc_parse。
//   · `ParamsEditor` 新增两条通道：`extraFields`（专属控件**整块**渲染在通用参数行上方，不拆成一格一值）与
//     `handledKeys`（这些键由专属表单负责 ⇒ 通用行不重复列出；**写回时原样保留**，否则 diffPatch 会把
//     "旧有新无"的键判成删键，一改参数就把 path / ocr / filename 删掉。JSON 视图里仍显示、计数也含它们）。
//   · 试跑结果：不再渲染在底部试跑条里，改成 `dsh-wf-testtoast`（position:fixed、top:16vh、左右 margin:auto 居中、
//     z-index 10100 > 遮罩 10000、宽 ≤720、内部可滚、深色细滚动条）；成功 2.6s 自动消失、失败常驻 + 右上角 ✕；
//     内容仍用 `TestResultView`（逐字不变）。用特征串做依赖避免父组件重渲染反复重置计时器。
//   · 用例同步（锚点搬家，断言语义不动）：`doc-parse-panel` / `file-save-click` 改成"面板里**没有** + 弹窗里**有**"；
//     `select-box` 的 7 处行查询改到 `.dag-flow-picker` 作用域（循环设置仍留面板，2 处保留 `.dsh-wf-right`）、
//     助手 `__df_sel` 同时查两处；`params-testbar` / `testrun-noupstream` / `inspector-switch` 的结果锚点改到浮层，
//     并新增 6 条浮层几何断言（fixed / top≈16vh±6 / 左右留白差 ≤2 / 宽 ≤720 且不贴边 / z>10000 / 底部条无结果块）。
//   · 验证：tsc 0 / markers **150/150** / 离线链 exit 0 / CDP 全量见交付记录；三产物重建。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-parammeta：**图片/视频生成节点的参数只留「🧪 参数与试跑」弹窗，并改成两行式（中文名 + 参数名注脚）**
//   （2026-10-19 用户四轮原话：「参数既在右边面板、又在参数与试跑面板里…只想保留参数与试跑面板的参数…
//    最好对每个参数加个中文名称或释义」→ 拍板 A；「右侧面板参数删除掉之后，就不用留下备注信息了，没必要」；
//    「最好显示成两行，中文名在上面，参数名在下面，并且参数名变小，字体颜色变浅，弱化，中文名正常显示，
//    参数名就像注脚」；「参数与试跑按钮的弹窗，如果参数较多，用滚动的方式，不要整个弹窗页平铺」；
//    「图片生成节点里面的提前测试…是否可以直接删掉提前测试按钮」→ 拍板 B 删掉）。
//   · 新增 `src/client/param-meta.ts`＝**参数的唯一元数据源**（image_generate 9 项 + video_generate 15 项：
//     中文名 label / 问号释义 desc / 示例 placeholder / 是否默认富文本 multi）。`ParamsEditor` 新增 `paramMeta` prop。
//   · 行内形态：`.dsh-wf-params-kcell.named`（150px）= 中文名 12.5px 正常色在上 + 参数名 11px 等宽灰注脚在下（问号跟注脚）。
//     参数名**不再可编辑**（key 是引擎写死的，改了不报错、只是静默失效）；判据 `named = meta && (r.auto || r.orig !== undefined)`
//     ——只对"登记表补出来的行 / def 里本来就有的键"生效，「+ 添加参数」新起的那行仍是可编辑输入框（否则输到 prompt 时会丢焦点）。
//   · 弹窗是唯一入口：`rowsFromParams` 新增第 5 参 `autoRows` ⇒ 登记表里的键**全部自动补行**（auto 语义：留空不写进 def，
//     清空＝删键）。这一步是必须的：不然新节点 params 为空时弹窗一片空白、一个参数都填不了。
//   · 右侧面板**整块不渲染**（连一句备注都不留）；图片节点的「🔍 提前测试」按钮已删除（用户拍板 B：改由弹窗底部
//     「▶ 试跑本节点」验证；宿主路由 `POST /api/dag-flow/test-image-api` 保留为纯后台能力，离线测试仍覆盖它）。
//   · 弹窗限高 + 参数区内部滚动：`max-height: calc(100vh - 14vh - 44px)`，标题/页签固定、参数区 `overflow-y:auto;min-height:0`、
//     底部试跑条 `flex:0 0 auto` 常驻（实测视口 800 时弹窗 646px、试跑条 bottom 757 可见）；滚动条改深色细条；
//     遮罩不再承担整页滚动。参数区左内边距补到 21px（原来贴到弹窗边框 1px）。
//   · 回归锁：markers 147/147（新增 3 条：元数据文案在产物里 / 面板已无「提前测试」与那句备注 / 弹窗限高类存在）；
//     离线链 exit 0；CDP 子集 11/11（params-editor / params-images / params-testbar / file-save-click / doc-parse-panel /
//     select-box / loop-visible / inspector-switch / testrun-noupstream / node-result-tip / undo-redo）。
//   · 纯客户端改动 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。
// v20261019-srcrowfix：**修 doc_parse 面板「文件来源」下拉切不过去**（2026-10-19 用户原话：
//   「文档解析节点右侧的编辑框有个文件来源，下拉选，本地路径还是下载地址，下拉选无法切换」）。
//   · 真因（一行判据）：面板用 `String(p.url ?? '').trim() ? 'url' : 'path'` 判当前类型，而切到「下载地址」时
//     写入的正是 **`url: ''`（空串）** ⇒ trim 后为空 ⇒ 判据立刻回退成 path ⇒ 下拉一选就弹回「本地路径」。
//     现象看着像"下拉坏了"，其实是"写了 url 键但显示按值回退"（A/B 反证时断言打印 `下拉=path / def url 键=true`，正是这个病象）。
//   · 修法：改成**看键在不在**（`hasOwnProperty('url') && p.url !== null`）—— 与项目里"null＝删键"的既有语义一致，
//     也和 loop 的边界判据（按键存在、不按值非空）同一口径。
//   · 回归锁：CDP `select-box` 新增 ②f —— 依次点「下载地址」「本地路径」，同时断**下拉显示**与 **def 里的键**；
//     A/B 反证过：退回旧实现时 ②f 精确变红（下拉=path，但 def 里 url 键已存在）。
//   · 验证：tsc 0 / markers 144/144 / 离线链 exit 0 / CDP `select-box` + `doc-parse-panel` 2/2。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261019-nowhile`）。

// v20261019-nowhile：**while 条件循环整条移除（引擎 + 面板），循环只保留 count / over**（2026-10-19 用户拍板：
//   「那就删掉 while 循环逻辑，引擎逻辑也删掉，历史工作流也同步处理掉」；同时「每轮条件保留，输入框位置按循环逻辑调整」）。
//   · 宿主 `control.ts`：删掉 while 分支、`whileMode`、`dynamicWhile`、`whileCap`、`condWanted/keepOn`、两处
//     `LOOP_MAX_ITER` 路径、以及"动态 while 必须配循环体"的报错；轮数＝已算好的迭代序列长度（不再有边跑边判）。
//     `LOOP_NO_BOUND` 文案改为「count / over 至少配置一个（条件循环已移除：要满足条件就停，请在循环体里用条件节点判断，
//     并让 end 输出 break: true）」。
//     ★schema 里**仍保留** `while` / `whileMode` / `dangerouslyAllowInfinite` 三个键（标"兼容老数据"），
//     并把 while 留在 anyOf 里 —— 否则老 def 会因 `additionalProperties:false` 直接结构校验失败（违反红线）。
//   · 面板：边界下拉只剩 count / over；老 while 节点显示「（当前值：旧版条件循环，已移除）」+ 一句改法提示；
//     删掉 while 输入框、真/假继续下拉、`dangerouslyAllowInfinite` 勾选框；`maxIterations` 只在 over 下出现。
//   · ★**「每轮条件」位置按配置直觉调整**：挪到「边界值」之后、「最大迭代次数」之前 —— 顺序变成
//     跑几次 → 每轮做不做 → 上限 → 循环体，跟他描述的"按循环的逻辑"一致。
//   · 客户端：卡片副标题不再显示 `while: xxx`，老节点改成「⚠ 条件循环已移除（改 count / over）」；问题面板对
//     "只配了 while"的节点报 error 并给 break 出路。
//   · 文档：README 边界表删 while 行 + 「最大迭代次数」段与两处节点参数表同步；`ERROR_REFERENCE` 把 `LOOP_MAX_ITER`
//     标"已退役"，`LOOP_NO_BOUND` 说明同时覆盖"只配了 while"的老节点。
//   · 测试：`loop` 专项删掉 while 全部用例（原 D 段 8 条、C3 的 ①~④、C5 的 3 条），保留 count/over、截断、
//     循环体传参、break 打断、每轮条件、表达式求值器（后者改用 if 条件钉）；CDP `loop-visible` 的 while 副标题断言
//     改成"老节点如实提示已移除"；`verify-live-restart` 的 ② 改成"while 退役检查"。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记 host / client 均 `v20261019-nowhile`）。

// v20261019-roundif：**新增「每轮条件」+ 删掉「不设边界」入口**（2026-10-19 用户原话：「循环节点里面的 while 和
//   不设边界感觉都没必要，可以设置一个自定义判断，用户自定义语句，如果语句为真，就执行，如果语句不为真，就进入下一轮」；
//   我把两种语义的差别摆清后，他从 A/B/C/D 里拍板 **A：保留 while，删不设边界，新增「每轮条件」**）。
//   · 语义澄清（关键）：`while` 决定「**还有没有下一轮**」（为假就整个循环结束）；「每轮条件」只决定
//     「**这一轮做不做**」（为假就跳过本轮、继续下一轮）。两者正交，可同时用，删掉 while 会丢掉「提前结束」的声明式
//     表达（只能全靠 `break`），所以保留。
//   · 宿主 `control.ts`：新参数 `roundIf`（表达式）；**只在配了循环体时生效**（没循环体时 loop 只产出序列）；
//     每轮在 while 判断之后、执行循环体之前求值：为真照跑，为假 `skipped++` 后 `continue`（不写 out.items）；
//     求值抛错 ⇒ `LOOP_COND_ERROR`（文案指明是「每轮条件」，不静默当 false 一路跳过）；
//     配了它 out 里补 `rounds`（共经过几轮）/ `skipped`（跳过几轮）—— 没配时这两个字段不出现。
//   · 面板：边界下拉**删掉「⚠ 不设边界」**（它唯一用途是让运行必失败）；仅当节点本来就是三键全空时，
//     把它作为「（当前值：无循环边界）」显示，避免下拉显示空白（老数据兼容，不隐式改数据）。
//     边界下方新增「每轮条件（可选）」输入框 + 问号（讲清与 while 的区别、例子 `loopIndex % 2 == 0`、out 字段）。
//   · 文档：README「循环怎么用」补一段；`ERROR_REFERENCE` 的 `LOOP_COND_ERROR` 说明加上 `roundIf`。
//   · 测试：`loop` 专项新增 3 条 —— ①count=4 + `loopIndex != 1` ⇒ 执行 0,2,3（count 3 / rounds 4 / skipped 1）；
//     ②`roundIf` 写错变量 ⇒ `LOOP_COND_ERROR` 且文案含「每轮条件」；③没配循环体时 `roundIf` 不生效（不带 rounds/skipped）。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记 host / client 均 `v20261019-roundif`）。

// v20261019-loopbreak：**子工作流可以打断循环**（2026-10-19 用户问「子工作流怎么配置，打断循环节点执行」，
//   从三个方案里拍板 A：约定 end 输出带 `break: true` 就中断）。
//   · 背景：此前循环只有三种停法 —— while 条件不满足「继续」、某轮失败（整节点失败）、跑满上限。
//     循环体内部**没有**"别再跑下一轮"的通道，想提前收工只能把判断反写进 while 条件（要求每轮把信号从
//     上一轮输出里带出来），很绕。
//   · 改法（宿主 `control.ts`，纯加法）：每轮循环体跑完后看它的 end 输出 —— 带 `break: true` 就**立刻结束**，
//     剩余轮不再跑；节点仍算 `success`（这是正常收敛，不是失败）；`out` 里补 `broken: true` 与 `breakAt`
//     （第几轮停的），已完成轮次照旧在 `out.items`，那一轮的 end 输出也含 `break` 键便于排查。
//     判据 `isBreakOutput()`：只认对象上的 `break === true`（为了不误伤既有数据，不做任何字符串/数字宽松匹配）。
//   · 不写 `break` 的老循环**一字不变**（不出现 broken / breakAt 字段）。
//   · 推荐配方（也写进面板气泡与 README）：子工作流里用 `if` 判断，满足就 `set_var` 写 `break=true`，
//     `end` 会自动把 `vars` 带进输出 ⇒ 循环看到就停。
//   · 验证：tsc 0 / markers **138/138** / 离线链 exit 0（`loop` 专项 **72 passed**，新增 3：
//     恒打断（count=5 只跑 1 轮）/ 不写 break 不变 / if+set_var 条件打断在第 2 轮停）/ CDP `loop-visible` 1/1。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记 host / client 均 `v20261019-loopbreak`）。

// v20261019-whilefalse：**while 多了一种模式：条件为「假」时继续**（2026-10-19 用户原话：
//   「循环的 while 模式，不能只有为 true 才执行，也要可以配置成为 false 时执行」）。
//   · 新参数 `whileMode: 'true' | 'false'`：`'true'`（默认，**老行为一字不变**）＝条件为真时继续；
//     `'false'` ＝条件为假时继续 ⇒ 等价于「一直跑到条件变真」（until 语义，例如「生成到 `lastOutput.ok == true` 为止」）。
//   · 宿主 `control.ts`：`condWanted` + `keepOn(v)` 统一映射（wanted=true ⇒ keep=v；wanted=false ⇒ keep=!v），
//     静态预生成路径与动态逐轮路径**共用**同一映射；`LOOP_MAX_ITER` 文案跟着模式说「条件仍为真 / 条件仍为假」
//     （以前固定写"仍为真"，在 until 模式下会误导）；schema 加 `whileMode` 枚举（`additionalProperties:false` ⇒ 必须登记）。
//   · 面板：while 模式下表达式框下面多一个两选下拉「条件为真时继续（默认）/ 条件为假时继续（一直跑到条件变真）」；
//     「🔁 循环设置」问号补一句"两种模式共用同一个上限/保险丝"；`maxIterations` 气泡措辞改为「仍满足继续」。
//   · 文档：README 的 while 行补「跑到成功为止」的用法示例；`ERROR_REFERENCE` 的 `LOOP_MAX_ITER` 说明跟着模式走。
//   · 测试：`loop` 专项新增 3 条 —— ①`whileMode:'false'` + 条件 `lastOutput.n == 2` ⇒ 3 轮（序号 0,1,2）；
//     ②同一条件用默认模式 ⇒ 0 轮（A/B 对照，证明模式真生效）；③`while:'false'` + 模式 false ⇒ 撞保险丝且文案含「为假」。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记 host / client 均 `v20261019-whilefalse`）。

// v20261019-countone：**count 模式把「次数」与「最大迭代次数」合并成一个输入框**（2026-10-19 用户原话：
//   「循环节点的 count 形式里面有三个需要填写的框，最大循环次数和填写的次数可以使用一个输入框，写清楚说明」）。
//   · 面板（`NodeInspector.loopConfigNodes`）：`count` 模式只剩「跑几次，如 3」一个数字框，右侧问号说清
//     「填几次就跑几次，count 模式没有第二个上限框（只受 100000 硬保护）；最大迭代次数只在 over / while 下出现」。
//     该框的 onChange 写 `count` 的同时把 `maxIterations` 置 null（删键）—— 避免留下一个**看不见的**旧上限偷偷截断。
//     `setLoopBound('count')` 同样顺带清 `maxIterations`。
//   · 老工作流（def 里已有 count + maxIterations）进面板时：明说「还带着旧的最大迭代次数 N（会把轮数截断到 N）」
//     并给「清除」按钮（`onParamsChange({ maxIterations: null })`）—— 不做隐式改数据，但也不让它隐形。
//   · 引擎（`control.ts`）**一行未改**：语义仍是「填了就截断、count/over 留空＝不限、while 留空＝1000 保险丝」，
//     本轮纯客户端 + 文档 ⇒ **硬刷新即可**（宿主标记仍是 `v20261019-maxiterblank`，那份要重启 `dsh web`）。
//   · 文档：README 边界表 count 行改写 + 「填与不填」段落注明该框只在 over / while 出现。
//   · 测试：CDP `loop-visible` 改为断「count 模式只有 1 个数字框」+「旧 maxIterations 被明说」+「点清除后 def 里键被删」；
//     maxIterations 问号的断言移到 over 模式（那里才有这个框）。
//   · 验证：tsc 0 / markers **133/133**（新增"单框""旧上限可清除"两条）/ 离线链 exit 0 / CDP `loop-visible` 1/1；
//     探针 `probe-maxiter-row.mjs` 量到 count 行：输入框与问号同一行、输入框占行宽 91.6%、气泡在视口内。

// v20261019-maxiterblank：**「最大迭代次数」留空的语义改成「不限」**（2026-10-19 用户原话：
//   「不填应该是按照默认数组实际有多少数据执行的吧，填了才是按照数据截断」——他拍板 A：count/over 留空＝无上限）。
//   · 背景：上一版 `maxiters` 只是把现状讲清（不填＝1000），但用户对"留空也有隐形上限"明确不认可 ⇒ 这版改语义。
//   · 宿主 `control.ts`：`explicitCap = 填了就 min(值, 100000) / 没填 null`；`countOverCap = explicitCap ?? 100000`
//     （count / over 留空 ⇒ 按数据实际长度执行，只受 schema 硬保护 100000，被它截断时照旧标 truncated）；
//     `whileCap = explicitCap ?? 1000`（**while 例外**：留空仍是 1000 轮保险丝 —— 条件永不转假时要有自然停点，
//     只能手动取消很难受）；`LOOP_MAX_ITER` 文案在"没填"时补一句「while 留空时默认 1000 的保险丝；要跑更多请显式填」。
//   · 面板：maxIterations 的 placeholder 改「不填＝不限（while 为 1000）」，问号气泡改写成同一口径；
//     README「填与不填」段与 `ERROR_REFERENCE` 的 `LOOP_MAX_ITER` 说明同步。
//   · ★**行为变更（单列）**：`count` / `over` 不填上限、且数据量 > 1000 时，以前只处理前 1000 个（静默），
//     现在会跑满实际数量 —— 这正是用户要的；`while` 不填时的 1000 保险丝**保持不变**。
//   · 测试：`loop` 专项新增 4 条（over 1200 项不填 ⇒ 跑满 1200 且不标 truncated；count 1200 不填 ⇒ 1200；
//     while 不填 ⇒ 仍 LOOP_MAX_ITER 且文案含 1000）。
//   · 验证：tsc 0 / markers **131/131**（新增"while 留空＝1000 保险丝"文案锚点）/ 离线链 exit 0
//     （`loop` 专项 **66 passed**）/ CDP `loop-visible` 1/1（问号气泡改断"按数据实际长度执行"）。
//   · 标记 host / client 同为 `v20261019-maxiterblank` ⇒ **需重启 `dsh web` + 硬刷新**。

// v20261019-maxiters：**把「最大迭代次数填与不填」讲清，并让「超上限截断」可见**（2026-10-19 用户原话：
//   「循环里面的最大迭代次数，填与不填的区别」——面板上只有一句 placeholder，没说什么情况下会影响结果）。
//   注：本条里"不填＝1000"的语义已被上一条 `maxiterblank` 改掉（count/over 留空＝不限），这里保留历史记录。
//   · 核实到的现状（三类边界三种命运）：`maxIter = min(maxIterations ?? 1000, 100000)`；
//     `over` / `count` 超过它 ⇒ 只处理前 N 个、**静默截断**（不报错、out.count 显示 1000，看不出少跑）；
//     `while`（含动态条件）跑满它而条件仍真 ⇒ `LOOP_MAX_ITER` 失败；勾 `dangerouslyAllowInfinite` 只是
//     **"到上限不报错"**，`while (i < maxIter)` 仍是硬上限 —— 旧文案「到上限后继续」名不副实。
//   · 改法（用户从 A/B/C/D 里拍板 A）：①宿主 `control.ts` 记下截断并落进 out —— `truncated: true` +
//     `requested`（本来要做多少）+ `processed`（实际做多少），**只在真截断时出现**，未截断时 out 形态一字不差
//     （既有下游引用零影响）；②面板 maxIterations 改为「输入 + 右侧问号」，气泡讲清三种边界下的不同作用；
//     ③checkbox 文案改为「跑满上限后不报错（仍只跑到 maxIterations，不会真无限）」。
//   · 文档：README「循环怎么用」补一段「填与不填」+ `ERROR_REFERENCE` 的 `LOOP_MAX_ITER` 说明订正
//     （明确 count/over 超上限**不报错**、只在 out 里标出来）。
//   · 验证：tsc 0 / markers 130/130 / 离线 `loop` 专项 62 passed（新增 4：over 截断标出、count 截断标出、
//     未截断时 out 仍是 `count,items` 两项）/ CDP `loop-visible`（新增"maxIterations 问号讲清差别"断言）。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记 `v20261019-maxiters`，客户端同样）。

// v20261019-loopstate：**循环体传参也能引用「上一轮输出」**（2026-10-19 用户在问完"循环里能不能定义只在本次运行有效的
//   临时参数"后，从三个选项里拍板「A｜补：把上一轮输出注入循环体传参」）。
//   · 背景：`ctx.vars` 每次运行都是新的（`vars: {}`），临时参数**天然只活一次运行**，`set_var` 写、模板与 `end` 都能读；
//     但**轮与轮之间**原来没有任何传递通道 —— 上一轮的 `end` 输出只落在 `loop.out.items` 里，循环体的 `body.inputs`
//     拿不到。这一轮把 `lastOutput` 补进迭代上下文（宿主 `control.ts` 的 `iterCtx`），于是：
//     `body.inputs` 的值里可以写 `{{vars.lastOutput.字段}}`，while 条件里同样可用（上一版 `loopwhile` 只接了条件侧）。
//   · 首轮 `lastOutput` 是空对象 `{}`（不能用 `null`：表达式引擎里 `null` 不是字面量，会报 `undefined variable: null`），
//     判"第一轮"用 `loopIndex == 0`；比较用 `==`，逻辑用 `||`/`&&`（内部会被归一成 `or`/`and`）。
//   · 文档：面板「循环体参数映射」的问号补一行 + README「右侧能写什么」表新增 `{{vars.lastOutput.字段}}`。
//   · 验证：tsc 0 / 离线 `loop` 专项 58 passed（含「循环体传参可引用上一轮输出：每轮回显长度 +1」）。
//   · ★**宿主也改了 ⇒ 需要重启 `dsh web`**（标记升到 `v20261019-loopstate`）。

// v20261019-loopdoc：**把「循环怎么用 / 怎么给循环体传参」说清**（2026-10-19 用户原话：「循环节点的循环设置不知道
//   怎么设置，感觉和现实使用的方式不一致；而且怎么给子循环传参数也没说」）。
//   · 面板（`NodeInspector.tsx` 的 `loopConfigNodes`）：
//     ①选中循环体子工作流后，读它自己的 `def.inputs`（即「工作流参数」），在循环体下方**平铺列出**「该子工作流声明的
//       参数：a、b…」—— 这就是"左侧输入名该填什么"的答案（纯只读，不动任何 def）；
//     ②`+` 添加映射时**预填**一个"已声明但还没映射"的参数名，值默认 `{{vars.loopItem}}`（最常见用法）；
//     ③循环体的问号补「传参怎么对应」：左边＝子工作流参数名；右边可用 `{{vars.loopItem}}` / `{{vars.loopItem.字段}}` /
//       `{{vars.loopIndex}}` / `{{节点id.out.x}}` / 常量，并给 `topic = {{vars.loopItem.title}}`、`n = {{vars.loopIndex}}` 的例子；
//     ④「🔁 循环设置」的问号补 while 的真实语义（每轮开始前求值；引用 lastOutput/loopIndex 才随轮次变化；表达式语法边界）；
//     ⑤`over` 的 placeholder 去掉误导的「或直接写数组」⇒ 改为「上游数组引用（整串），如 {{list1.out.items}}」。
//   · 文档：README「循环怎么用」从一句话扩成「三步 + 两张表（边界怎么填 / 右侧能写什么）+ 示例 + 两条注意事项」。
//   · ★ 闸门抓到我两处错并已修：README 表格里写 `\|\|` 转义（表格解析器不认，报"列数 5 ≠ 表头 3"）、
//     面板气泡里用了 Markdown `**`（用户可见文案禁用；CDP `loop-visible` 的"问号气泡无星号残留"断言当场抓红）。
//   · 验证：tsc 0 / markers 126/126 / 离线链 exit 0 / CDP `loop-visible` + `node-result-tip` 2/2。
//   · **纯客户端 + 文档改动 ⇒ 硬刷新即可**（宿主标记 `v20261019-loopwhile` 那份需要重启 dsh web）。

// v20261019-seltip：**下拉的悬停提示改成自绘深色浮层**（2026-10-19 用户原话：「下拉选鼠标悬停展示的框也比较丑，
//   可以优化下」—— 他指的是原生 `title` 的浏览器提示框：白底 / 系统字体 / 方角，CSS 完全改不了）。
//   · 做法：`SelectBox` 去掉列表项与闭合态控件上的 `title` 属性，改 `showTip(anchor, text, force)`：
//     悬停 **180ms** 后才弹（列表里快速扫过不闪）；**只在文案真被截断**（`scrollWidth > clientWidth`）、
//     或调用方传了 `title`（说明性文字，force）时才弹；内容＝「名称 —— 解释」，与闭合态同一口径。
//   · 定位：默认在锚点**上方**（用 `bottom` 固定底边 ⇒ 不需要预先知道提示框高度），上方不足 96px 就落到下方；
//     左右夹进视口（留白 8px）。`pointer-events: none` ⇒ 不挡点击、也不会触发"点外部关闭列表"。
//   · 样式 `.dsh-wf-sel-tip`：与列表同色系（`--wf-panel3` + `--wf-border3`）、圆角 8、`max-width: 340px`、
//     12px/1.5、`overflow-wrap: anywhere`；同样 Portal 到 body（面板 `backdrop-filter` 会造包含块）、
//     `box-sizing: border-box`（浮层不在 `.dsh-wf-root` 里）；只做 opacity 淡入。列表一关即收起。
//   · 用例：CDP `select-box` ②d 改为断"列表项**没有**原生 title"；新增 ②d2 —— 用 `Input.dispatchMouseEvent`
//     真实移入 → 出现 `.dsh-wf-sel-tip`（`role=tooltip`、`pointer-events:none`、内容含完整解释、深色底、
//     在视口内），移开后消失。（★不能用合成 `mouseenter`：React 的 onMouseEnter 是由 mouseover 派生的。）
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261019-selnowrap：**下拉展开浮层与控件同宽、列表项单行省略号、悬停 title 看全名**
//   （2026-10-19 用户原话：「下拉选浮窗的长度要保持和下拉选一致，不要超出，如果下拉选里面内容比较长，
//   超出了浮窗的长度，就...显示，鼠标放上去显示全名」）。
//   · ①**宽度**：去掉 `Math.max(r.width, 180)` 的 180px 下限 ⇒ 浮层宽度**严格等于控件宽度**。
//     触发场景＝doc_parse 两段式里那个窄的「本地路径」下拉（约 100px）：旧实现会把浮层撑到 180px，
//     明显比控件宽。
//   · ②**文案**：`.dsh-wf-sel-label` / `-sub` 从"可换行看全"改回**单行 + `text-overflow: ellipsis`**
//     （`-body` 加 `overflow: hidden` 才让省略号生效）；新增列表项 `title`（`名称 —— 解释`，与闭合态同一口径）
//     ⇒ 悬停看全名。
//   · ③这是**对上一版的自愿收口**：`v20261018-selsub` 里"展开列表可换行看全长解释"是当时的收益，
//     用户现在要"不超宽 + 省略号 + 悬停看全"，按最新口径覆盖；信息仍不丢（title 里是全的）。
//   · 高度估算不变（每项仍是"单行名称 [+ 单行小字]"，34 / 52px）。
//   · 用例：CDP `select-box` ② 增三条 —— 列表项单行省略号且真的溢出、列表项 `title` 含完整解释、
//     窄控件（`.dsh-wf-srcrow-kind`）浮层宽度 ≈ 控件宽度且 < 160px（反证旧的 180 下限）；
//     markers 增一条断 `.dsh-wf-sel-label` 规则里带 `text-overflow: ellipsis`。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261019-selsubfix：**修自研下拉的两个真机 bug**（2026-10-19 用户原话：「ai节点的选择模型下拉选，
//   无法滚动，滚动就闪退，搜索栏显示也不对」）。
//   · ①**滚动就闪退**（我的 bug）：关闭监听把 `scroll` 用 **capture** 挂在 `window` 上，而列表自己
//     （`.dsh-wf-sel-opts`）就是可滚动的 —— 内部滚动同样会命中它 ⇒ 一滚整个列表就消失
//     （探针实测：`scrollTop=300` 之后 `open=false / items=0`），所以用户看到的是"滚不动 + 一滚就没"。
//     几十个模型的 AI 节点下拉、以及 13 项的循环体下拉必然要滚，所以这个 bug 只有这类长列表会撞。
//     修法：scroll 回调里判断**滚动目标是否在列表内部**，是就放行；页面 / 面板真的滚动时仍然关闭
//     （"浮层与锚点分离就收起"的老口径不变）。
//   · ②**搜索栏显示不对**：下拉是 Portal 到 `<body>` 的，**不在 `.dsh-wf-root` 里**，拿不到最上面那条
//     `box-sizing: border-box` ⇒ 搜索框 `width:100%` 加上 padding/border **溢出列表 11px**
//     （实测：输入框右缘 1339 > 列表右缘 1328）。修法：对 `.dsh-wf-sel-list` 及其后代补
//     `box-sizing: border-box` 兜底（将来浮层里再加"100% + padding"的元素不会再踩）。
//   · ③顺带校准：列表高度估算里搜索框那一项 44 → **50px**（实测：输入框 42 = min-height 30 + padding 5+5
//     + border 2，再加搜索容器上下 padding 8），免得搜索框占位被少算。
//   · 用例：CDP `select-box` 新增 ⑧b（把列表内部滚到 300px 后**列表仍在且真的滚动了**）与 ⑧c
//     （搜索框不溢出列表右缘 + `box-sizing=border-box`）；两条都用旧产物 A/B 反证过"修之前必红"。
//   · 取证脚本：`tmp-test/cdp/probe-model-scroll.mjs`（打印列表/搜索框几何 + 内部滚动前后状态）。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261018-selsub：**下拉选项的「长解释」挪到列表项下方的小字说明（sub）**，选项名只留短名称
//   （2026-10-18 用户原话：「如果你想让它更清爽——把长解释挪到列表项下面那行小字说明里（就是我预览图里 sub 那种），
//   说一声我就做」→ 回复「做」＝授权）。上一轮换自研下拉后，长文案在闭合态只能靠省略号截断（点开才看全）；
//   本轮把「名称 + 解释」分层：**label 只留名称/值标识**（「关」「自动（默认）」「Bing」「仅宿主」「⛔ 停止这条支路」），
//   **解释原文一字不改地进 sub**（灰色 10.5px 小字、跟在名称下面、可换行）⇒ 闭合态不再溢出、列表更好扫。
//   · 改动面（14 处下拉里的 9 处，**纯文案结构：value 与 onChange 一字未动**）：
//     `inspector-fields.tsx` —— web_search 搜索引擎 7 项（auto / Bing / DDG Lite / DDG HTML / SearXNG /
//     AnySearch / 仅宿主）、doc_parse OCR 3 项、抽取内嵌图片 2 项、web_fetch 原样返回 2 项；
//     `NodeInspector.tsx` —— loop 边界「⚠ 不设边界」、循环体「（不设循环体）」、轮次失败策略「某轮失败 → 整节点失败」、
//     失败策略 3 项、跳转目标的上游警告、模型「当前值，dsh 当前未提供」。
//   · **故意没动**的四处（避免"为整齐而拆"）：`file_save` 内容来源（`文本内容（text）` 的括注是**参数值标识**不是解释）、
//     web_search 时间范围、loop 三种边界名（`固定次数 count` 里的字段名同理）、模型名的 `📷 图片` 能力徽标
//     （它是扫列表时要一行看全的能力标注，不是长解释）。
//   · 信息不丢的三道保险：①解释**只挪位置、一字不改**；②每档失败策略的完整语义**仍平铺**在下方
//     `.dsh-wf-failpolicy-hint`（关键说明既不进问号、也不只藏在列表项里）；③`select-box.tsx` 闭合态的 `title`
//     改成「名称 —— 解释」，悬停仍能看全。
//   · 用例同步：CDP `select-box` ② 从"断言长文案溢出"改成"断言短名称 + 省略号 CSS 契约 + 三档解释确实在 sub"；
//     ④ 闭合态文案断言改成 `强制`；`model-select` 的选项文本拼接补上 sub（断言语义不变）；
//     markers 新增 3 条（sub 类在产物里 / 长解释原文仍在 / 旧长选项名已撤净）。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261018-selectbox：**右侧参数面板的下拉全部换成自研组件**（2026-10-18 用户拍板「直接上样式 2（自研下拉）」）。
//   · 为什么自研：原生 `<select>` 的**展开列表**在 Windows Chromium 下是系统菜单（白底 + 系统字体 + 蓝高亮），
//     CSS 改不了、CDP 也拍不到；闭合态那个系统三角与项目的线条图标风格也不搭。实测右侧面板 12 个下拉里
//     8 个文字溢出（失败策略 18 字 / 需 221px、OCR 29 字 / 320px、抽取内嵌图片 34 字 / 416px，可用只有 215px）。
//   · 新增 `src/client/select-box.tsx`（`SelectBox`）＋ `styles.css` 的 `.dsh-wf-sel*`：
//     闭合态＝与输入框同几何（38px / 圆角 10 / 1px 边框 / 9px 11px）+ 单行省略号（长文案不再硬裁）；
//     展开态＝Portal 到 body 的深色列表（`position:fixed`，因为右侧面板的 `backdrop-filter` 会给 fixed 造
//     包含块），文案可换行看全、每项支持一行小字说明、项数 ≥8 时带搜索框；选中项 ✓ + 高亮；
//     键盘 ↑↓/Enter/Esc、点外部关闭、滚动/改窗口关闭；只做 opacity 淡入（有几何依赖的浮层不用位移动画）。
//   · 替换 14 处原生 select（`inspector-fields.tsx` 8 处 + `NodeInspector.tsx` 6 处），**语义一一等价**：
//     值回调从 `React.ChangeEvent<HTMLSelectElement>` 改成 `(value: string)`；模型那处的 disabled 占位项、警示
//     边框 style、`✓` 前缀与「当前值」兜底项全部保留（style 落在控件本体、className 落在 wrapper 供 srcrow 布局用）。
//   · ★ 实测抓到一个真 bug 并修掉：项数 ≥8 时搜索框用 `autoFocus` 会把视口滚一下 → 触发 scroll →
//     刚打开的列表被自己关掉（13 项的「循环体」下拉点开即消失，4 项的下拉正常）⇒ 改成
//     `focus({ preventScroll: true })`；CDP `select-box` ⑧ 专门锁这条（700ms 后列表仍在）。
//   · 用例同步：新增 CDP `select-box`（原生 select 退役 / 省略号 / Portal / 键盘 / Esc / 点外部 / 不贴边 / ✓ /
//     写回 def / 大类下拉不被自己关掉）；`doc-parse-panel`、`loop-visible`、`model-select`、`drag-writeback`、
//     `node-result-tip` 五条改为「点开列表 → 点选项」（并记录"点开与读取必须分两次往返：同 tick 里 Portal 还没提交"；
//     `model-select` 里"用原生 setter 清空"那条场景改为锁 disabled 占位项语义 + 重复展开一致性）。
//     markers 新增 3 条（类名 / 箭头 path / 只做 opacity 淡入）。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261018-metaaftertip：「3 个参数 · 改动即自动保存」**恢复成一段、挪到标题行小问号之后、样式与计数统一**
//   （2026-10-18 用户第四轮定稿原话：「3 个参数 · 改动即自动保存；恢复成这样，并且放到小问号后面，
//   字体颜色大小，状态统一成"3 个参数"一样的」）。
//   · 这轮是对前两版的收口：①原版（页签行末尾 `.dsh-wf-params-meta` + `margin-left:auto`）⇒ 贴右内边被报；
//     ②我改成"页签行下方一行 + 亮色半粗"⇒ 用户要求"恢复成这样、放到小问号后面、样式统一"。
//   · 现状：标题行内 `🧪 参数与试跑（…）` → 说明问号 → **`N 个参数 · 改动即自动保存`** → ✕ 关闭。
//     该类 `.dsh-wf-params-meta` 恢复使用但**不带 `margin-left:auto`**（改为 `flex:0 0 auto; white-space:nowrap`），
//     右侧让位交给关闭按钮自己的 auto；中间两版类（`.dsh-wf-params-count` / `.dsh-wf-params-autosave`）删净。
//   · 用例同步：CDP `params-editor` ③b 改断"一整段（正则 `^\d+ 个参数 · 改动即自动保存$`）+ 紧跟问号 ≤16px +
//     与问号同一行 + 11px / 等宽 / 不加粗 + 距右内边 ≥200px + 中间两版类已撤 + 问号气泡里没有这句"；⑧ 改断
//     标题行那段在 JSON 视图下仍可见。markers 改断「`.dsh-wf-params-meta` 在产物里」+「该规则**不带**
//     `margin-left:auto`」（按规则形态断，专防回归贴右）+「中间两版类已撤净」。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261018-autosavehint：**关键提示「改动即自动保存」从问号里搬出来、平铺在显眼处**（2026-10-18 用户纠正原话
//   「改动即自动保存，还是要在明显地方提示的，不能放到小问号里面，这个提示信息属于关键提示」）。
//   · 上一版（v20261018-paramscount）把它当"静态说明"、只留计数，是**判断错误**：这条属于**关键提示**
//     （用户看不到它会以为改的值没落盘）⇒ 必须平铺 + 视觉强调，而不是收进问号。
//   · 现状：页签行下方一行、左对齐 ＝ `N 个参数`（浅色等宽）+ **「改动即自动保存」**（`.dsh-wf-params-autosave`：
//     12px / 字重 600 / 强调色，可见度明显高于计数）；放在字段 / JSON **两个视图共享**的位置（切到 JSON 视图也
//     看得见，那里改同样会自动保存）；`PARAMS_TIPS`（标题旁问号）里那半句删掉——问号只留操作说明（引用语法 /
//     多行框切换 / 类型自动识别 / Tab 缩进）。
//   · 口径沉淀进规范：`docs/CONVENTIONS.md` §4.3 新增**关键提示判据**（用户看不到就会做出错误判断的句子＝
//     数据会不会丢 / 会不会生效 / 会不会产生费用 / 是否不可逆 ⇒ 平铺 + 可见度），只有纯操作说明才进问号。
//   · 用例同步：CDP `params-editor` ③b 反转（断"平铺行里有它 + **问号里没有它** + 字重 ≥600 / 字号 ≥12 /
//     颜色 ≠ 计数"，并用 Range 量文本矩形锁左对齐、不贴右内边）+ ⑧ 新增"切到 JSON 视图后提示仍在"；
//     markers 加"平铺类 `.dsh-wf-params-autosave` 在产物里"。A/B 反证可复用 v20261018-paramscount 的夹具
//     CSS 注入法（`tmp-test/ab-count-pos.mjs`）。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`）。

// v20261018-paramscount：「参数与试跑」弹窗里那条**靠右的提示挪位**（2026-10-18 用户原话「3 个参数 · 改动即自动保存；
//   这段提示位置太靠右了，放到合适位置；在参数与试跑的弹窗里」）。
//   · 原状：`N 个参数 · 改动即自动保存` 挂在页签行末尾的 `.dsh-wf-params-meta` 上，带 `margin-left:auto` ⇒
//     天生顶在弹窗右内边上（与 2026-10-16 用户报「小问号在最右边线边上」同源，同一个位置又报了一次）。
//   · 拆两半：**静态说明**「改动即自动保存」弹窗标题旁的小问号里早就有（PARAMS_TIPS 末行）⇒ 页签行那段删掉、不重复；
//     **动态计数**只留 `N 个参数`，挪到它描述的参数列表**上方左对齐**（新类 `.dsh-wf-params-count`；旧的
//     `.dsh-wf-params-meta` 规则连壳删除，不留半套）。
//   · 用例同步：CDP `params-editor` 新增 ③b（用 Range 量**文本**矩形，不用块级元素宽度——它撑满容器会误判：与列表
//     同一左基准 ≤2px、在列表上方、文本落在弹窗左半区、旧 meta 类已退役、静态说明确实在问号里）；markers 新增
//     「计数类在产物里 + 旧规则已退役」两条。★旧类名只能断**规则形态**（`类名 { 属性`）——CSS 注释也会被打进产物，
//     注释里提到旧类名不算"还在用"（实测该串在 dist/client.js 里因注释出现 2 次）。
//   · A/B 反证：夹具 CSS 注入一条 `.dsh-wf-params-count{text-align:right}` ⇒ ③b 精确变红（报文「差 753px」），
//     还原即全绿；截图复核 `tmp-test/build/shot-params-dialog.png`（计数 137px 与列表同左基准、在列表上方）。
//   · **纯客户端改动 ⇒ 硬刷新即可**（宿主标记仍是 `v20261018-srckind`，本轮没动 host）。

// v20261018-srckind：**doc_parse 按用户要求的两个改动 + 公共开发规范落地**（2026-10-18）。
//   · ① **path / url 合并成一个两段式输入框**（用户原话：「文件解析节点的文件路径和 url 合并成一个输入框，
//     输入框分为两段，前面选类型，后面填路径」）：新行「!文件来源」＝前段 `select`（本地路径 / 下载地址）
//     ＋后段 `input`；**切换类型时把另一侧置 null（＝删键）**，避免两个都填的歧义（执行层 url 优先会打架）。
//     CSS 类 `.dsh-wf-srcrow` / `-kind` / `-val`（styles.css）。**引擎侧一字未改**（仍读 path / url）。
//     ★ 截图复核发现：输入框被两段式压窄后，旧 placeholder（两种路径示例 + `{{}}` 引用示例）被截成
//     「documents/公告.pdf 或」半句话 ⇒ placeholder 只留**能完整显示**的一个示例（`documents/公告.pdf` /
//     `https://…/公告.pdf`），绝对路径 / `{{}}` 引用 / 相对路径锚定都搬进问号气泡。
//   · ② **OCR 默认改「自动」**（用户原话「OCR识别默认成自动」）：`normalizeOcrMode` 未给 / 空串 ⇒ `auto`
//     （显式 `off` / `false` / `0` / `关` 才是关；未知值仍当 `off`，不偷偷下载引擎）；面板默认选中「自动（默认）」。
//     ★ **必须同时改 `src/client/types.ts` 的 `NODE_PALETTE.defaultParams`**（原为 `ocr:'off'`）：拖拽 / 插入 /
//     AI 生成新节点都读它（FlowPanel / node-shell / node-palette 三处），只改引擎侧缺省值的话，新建节点照样带
//     `ocr:'off'`、面板显示「关」——等于没改（本轮先漏了这一处，靠截图 + 复看源码才发现）。已加 CDP 回归锁：
//     `doc-parse-panel` 断言「拖出来的新节点面板值 + def 里的 params.ocr 都是 auto」，并用夹具注入 A/B 反证
//     （把夹具里那处改回 off ⇒ 该断言精确变红、报文 `面板 off / 参数 "off"`；还原即全绿）。
//     ★**行为变更（必须知道）**：以前没设 `ocr` 的 doc_parse 节点遇到图片 / 扫描版 PDF 会明确报错，
//     现在会**自动跑 OCR**。★订正（2026-10-18：用户质疑「不是已经放到 runtime 文件夹里面了吗」后当场实测）：
//     **不需要下载任何东西** —— RapidOCR 整套（含模型）随包内置在 `runtime/rapidocr/1.4.4/win-x64/`
//     （3662 个文件 / 257MB，`package.json#files` 已含 `runtime`），`<DSH_HOME>\runtime` 下没有任何 rapidocr；
//     首次跑只是第一次加载 onnxruntime + 模型（本机实测：首次识别 1.9s、置信度 0.97、import 校验通过）。
//     想保持旧行为就把该参数显式设为「关」。
//   · ③ **公共开发规范落到 `docs/CONVENTIONS.md`**（用户要求「梳理之前所有的聊天记录和记忆，整理成开发规范，
//     抽取公共开发规范，每次修改都要遵循规范」）：10 节 + "每次修改的检查清单"；该文件自身也进闸门
//     （离线链尾部用 `check-readme.test.mjs` 校验它的代码围栏 / 锚点 / 表格 / 相对链接，非 README 时跳过
//     "必备串"检查）；`README.md` 的「开发者」段与「更深的文档」表都加了指向它的入口。
//   · ④ **README 里写死的「离线回归套件（N 个文件）」自同步**：该数字曾漂到 46、实际 52 ⇒ 中英文两处改为 52；
//     `check-readme.test.mjs` 新增第 ⑥ 项闸门：README 只要写了数字，就必须等于 `package.json#test:offline`
//     的去重文件数（没写就跳过）。A/B 反证：把链里任一文件删掉 ⇒ 中英两处同时报"漂了"、exit 1。
//   · 用例同步：`ocr.test.mjs`（默认值断言翻转）、`node-matrix.test.mjs`（21g11 / 21g12 / 21g13 / 21h / 21l
//     显式传 `ocr:'off'`，标题改「显式关」）、CDP `doc-parse-panel`（改断「文件来源」两段式控件 + 旧
//     「下载地址 (url)」行不再出现；问号定位断言按新行标签找，旧标签「文件路径」会找不到 ⇒ 前提断言变红）。
//   · **host + client 都有改动 ⇒ 重启 `dsh web` + 硬刷新**。

// v20261017-refine：**按用户拍板收的三处整改**（2026-10-17；① 的"维持现状"未动）。
//   · ②（host）**PDF 单元素 Filter 数组收窄**：`/Filter [/DCTDecode]` 是合法单元素数组、里面就是真 JPEG，
//     原判据"是数组就跳过"白丢一张图 ⇒ 现只对"数组里除 DCTDecode 外还有别的编码"才跳，安全性仍由
//     SOI(FF D8) 闸兜底。新增夹具 `pdfWithBracketFilter()` + 两条断言（单元素数组照抽 / 复合 filter 仍跳过）。
//   · ③（client）**值层纯函数抽成 `src/client/params-value.ts`**：`params-editor.tsx` 575 → ~450 行（回到
//     500 行软上限以内），并把最易错的 `valueOfText` / `paramsFromRows` / `diffPatch` / `rowsFromParams`
//     变成**可离线单测**的纯模块 —— 新增 `test/params-value.test.mjs`（A–E 段，含 C3「删一行不污染别行」的
//     高危回归锁），已注册进 `test:offline`。
//   · ④（client）**客户端版本标记单一出处**：`src/client/index.tsx` 新增 `CLIENT_VERSION` 常量，头注释
//     不再写死版本串（原先"头注释 + apply() 的 console.log"两处手写，升位时容易漏改一处）。
//   · ①（AI 生成提示词里节点 schema 的 400 字预算）按用户选择**维持现状**、不动。
//   · **host + client 都有改动 ⇒ 重启 `dsh web` + 硬刷新**。

// v20261017-auditfix：**全量自检后的修复**（2026-10-17 用户「根据开发规范，全量自检，还有没有引发其他的新的额外的
//   bug 和问题，报错和不符合规范的」；两位独立审查者分 host / client 侧审未提交 diff，我再逐条复核）。
//   · **①-1 高危（client）**：参数弹窗里**删掉一行**会让它之后的所有行被误判"用户改过" ⇒ 这些行重新过
//     `valueOfText`：`"0012"`→12、`"true"`→布尔、`"null"`→**参数键被整条删掉**（原判据按下标对齐 + 粘性 `edited`）。
//     修法：去掉粘性标记，改判"这一行文本是否还等于从 def 读出的原值"（`paramsFromRows`）；`pushRows` 还原成 setRows。
//   · **①-2 中（client）**：撤销回退位置只读 `tgt.layout` ⇒ def 里**没有 layout** 的节点（AI 生成／导入／CLI 模板）
//     撤销时位置不动、这一步历史被白吃。修法：用与显示同源的 `toRF(tgt)` 坐标给缺失节点兜底。
//   · **① 高危（host）**：`extractImages: off` 对**所有**文本无条件洗 ⇒ 解析普通 .md/.txt 也会被删掉行尾空格
//     （Markdown 硬换行失效）、压缩连续空行、裁首尾缩进。修法：`stripImageMarks` 无占位立即原样返回。
//   · **② 中（host）**：off 分支只清 `out.images`，`meta.images` 仍假报"有 N 张图"。修法：同时清 meta。
//   · **规范**：`ERROR_REFERENCE.md` 补 `IMAGE_SAVE_FAILED`（doc_parse 行）+ 更新 `IMAGE_NOT_FOUND` 文案；
//     删 `image-library.ts` 里不可达的 bmp 分支；去掉 `NodeInspector` / `inspector-fields` 用户可见文案里的
//     Markdown `**`（裸星号，用户极敏感）。
//   · 用例：`image-paths` 新增 B7（无占位文本原样返回）；`undo-stack` 新增 G（静默期内涟漪吸收 vs 真实位移记条）
//     与 H（markPending / flushPending）两段。
//   · **host + client 都有改动 ⇒ 重启 `dsh web` + 硬刷新**。

// v20261017-imgbtn：**选图弹窗的按钮统一**（2026-10-17 用户报「选图按钮弹窗里面的重新读取和打开图片目录
//   等其他按钮大小不一致」）。根因：「↻ 重新读取」「📁 打开图片目录」原本挂在**说明行**
//   `.dsh-wf-imgpick-hint` 里，而该行带 `font-size` / `opacity` 又没有 `flex-wrap` ⇒ 按钮被一起压暗、
//   并被长说明挤得文字折行（高度与工具条里的按钮不一致）。
//   修法（用户追加要求「重新读取是不是放到输入框里面，点击重新加载一下就行」）：①「↻ 重新读取」做成
//   **搜索框内的图标按钮** `.dsh-wf-imgpick-searchwrap > .dsh-wf-imgpick-reload`（规格抄参数行的框内把手
//   `.dsh-wf-params-grow`：22×22、圆角 6、透明底、hover 才出色），不再占工具条里的一颗文字按钮；
//   ②「📁 打开图片目录」与全选/清空勾选/写入已选同在工具条 `.dsh-wf-imgpick-bar`；
//   ③工具条按钮 `.dsh-wf-imgpick-bar .dsh-wf-btn { flex:0 0 auto; white-space:nowrap }` 防被挤压折行；
//   ④说明行只保留文字淡化 `{ opacity:.75 }`（不再把按钮一起压暗）。
//   · 用例同步：`params-images` ⑥ 断言"刷新在搜索框内、打开目录在工具条里"，新增 ⑥b（工具条文字按钮
//     同高、说明行无按钮）与 ⑥c（框内刷新按钮 22×22、opacity=1）。
//   · **纯客户端** ⇒ 硬刷新即生效（host 标记不动）。

// v20261017-offtext：**界面文案里去掉「老行为」这种字**（2026-10-17 用户真机看到 doc_parse 面板
//   「抽取内嵌图片」下拉项后要求：「不要有老行为这种字」）。
//   · 下拉项文案：`关 —— 只解析文本（老行为）` ⇒ `关 —— 只解析文本，不抽取图片`。
//   · 顺带清掉同源字样（源码注释 / 文档 / 测试注释）：doc.ts、NodeInspector.tsx、FlowGramCanvas.tsx、
//     workspace.ts、EXEC-MODEL-MERGE.md、test/*、tmp-test/picker-server.mjs。
//   · **纯客户端**改动（host 标记不动）⇒ **硬刷新即生效**，不必重启 dsh web。
//   · 断言：markers 新增「client 产物里不含『老行为』字样、且新下拉文案在」。

// v20261017-imgfix：**修掉全量审查查出的 7 条真缺陷**（2026-10-17 用户"按开发规范全量扫描"后拍板全修；
//   两条来自 host 侧独立审查、三条来自 client 侧独立审查，其余自查核实；每条我都读代码复核过）。
//   ① **传图路径基准（高）**：上游产物 `image_generate.out.images[].path` 是相对 `<DSH_HOME>` 的
//      `.dag-flow/images/x.png`（adapter/assets.ts 用 `path.relative(DSH_HOME, file)`），读侧却按统一图片目录再拼
//      ⇒ 双层化 ⇒ 官方推荐的 `{{img.out.images}}` 传图必 `IMAGE_NOT_FOUND`（且 path 优先于可用的 url）。
//      现按**候选顺序探测**：`imagePathCandidates()` = [统一图片目录（裸名）, `<DSH_HOME>/…`（兼容上游形态）]，
//      失败信息列出全部探查路径。
//   ② **bmp 白名单不一致（中）**：doc_parse 会落 `.bmp`，而宿主附件服务与「🖼 选图」只认 png/jpeg/webp/gif
//      ⇒ "文本公布的地址自家读不了"。现把 bmp 移出 `IMAGE_MEDIA_TYPES`（三个收集器都走 `!mediaType` ⇒ 计入
//      `skipped`，不会静默丢图）。
//   ③ **extractImages:off 的假地址（中）**：占位符由 extractDocument 按"有没有抽到图"**无条件**插入，节点侧 off
//      只清 images ⇒ 文本留下指向不存在文件的 `[图片 #N]`（还会进下游 prompt）。现加 `stripImageMarks()`，
//      off 时洗净 ⇒ 真正回到只解析文本的形态。**行为变更**：`node-matrix` 21g5 断言随之翻转。
//   ④ **纯图 PDF 落盘失败不再算成功（中）**：那条通路的全部价值就是"图片地址清单"，落盘全失败 ⇒ `IMAGE_SAVE_FAILED`。
//   ⑤ **PDF 复合 filter 的 DCTDecode（中低）**：`[/ASCII85Decode /DCTDecode]` 这类**未解码**字节会被当 JPEG 原样
//      写出（坏图）⇒ 现在 `/Filter` 是数组即跳过，另用 SOI(FF D8) 校验字节，宁缺勿坏。
//   ⑥ **Form XObject 误报（低）**：页资源里的 `/Subtype /Form`（表单/透明组/水印）不是图片，原来一律计入
//      `skipped` ⇒ meta 谎报"跳过了 N 张图"。现不再计数。
//   ⑦ **ai.ts schema 说明的路径基准写错（低，但它会被喂给"AI 生成工作流"）** ⇒ 改为统一图片目录。
//   · 另修 client 侧独立审查报的 3 条：参数值类型自动推断**只作用于本次真正编辑过的行**（改一行不再把别行的
//     `"0012"` 静默变成 12、文本 `null` 被删键；JSON 视图写引号现在**真的**能存成字符串）；撤销/重做入口先
//     `flushPending()` 补落栈（修"刚编辑完立刻 Ctrl+Z 没反应 / 多撤一步"）；回放静默期 **1200ms** 兜底
//     且静默期内**只吸收不含位移的差异**（撤销后立刻拖动＝真实编辑，照常记条）。
//   · 断言：新增 `test/image-paths.test.mjs`（13 条，锁 `imagePathCandidates` 与 `stripImageMarks`）；
//     `node-matrix` 21g5 翻转。
//   标记 `v20261017-imgfix`（host + client 都有改动 ⇒ **重启 dsh web** + 硬刷新）。
//
// v20261017-undowire：**撤销接线抽成独立模块 + 清冗余诊断 API + 内联布局改 CSS 类**（2026-10-17 应"按开发规范
//   全量扫描"要求自查出的三条不符合规范项，用户拍板"修 1/3/4"）。
//   · ① 抽 `src/client/undo-wiring.ts`（导出 `useUndoWiring(def, setDef, setDirty)`）：FlowPanel.tsx 里那约 90 行
//     接线（observe 记录 / 回放 applier / 挂载基线 / Ctrl+Z 快捷键 / 诊断钩子）整体搬出 —— 该文件当时已
//     **1587 行**、越过项目 500 行软上限，而本项目对这类"面板里的独立职责"一贯抽独立模块（panel-utils /
//     inspector-fields / dialogs/* / canvas-chrome / node-shell 都是这么来的）。**行为零变化**（同一批 effect、
//     同一顺序、同一常量）。
//   · ② 删掉 `undoKeys()` 与诊断钩子 `__df_undoKeys`：**无任何消费者**（CDP 早已改用 `undoDump`）。
//   · ③ `NodeInspector.tsx` 变量入口那行的内联 `style:{display:'flex',alignItems:'center',gap:6}` 改为 CSS 类
//     `.dsh-wf-hint-row`（与对话框里的 `.dsh-wf-varpick-hint` 同口径：客户端布局走 CSS 类才适配双主题）。
//   · 未修（用户选择留待以后）：`params-editor.tsx` 536 行超软上限。
//   标记 `v20261017-undowire`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261017-undokeep：**重命名工作流不再清空撤销历史**（2026-10-17 自查发现：上一版 `v20261016-undo` 用
//   `def.name` 变化当"换工作流"的判据，而 `handleRename` **每键都写 `def.name`** ⇒ **改个工作流名就把撤销
//   历史清了** —— 判据选错，重命名与换工作流不是一回事）。
//   · 修法：删掉 name 判据。真实情况是：打开/新建、进入子工作流都经 dock 的 bump 版本号**重挂载 FlowPanel**
//     （`dock.tsx:57` 注释写明"与打开已有工作流同一条通路"），挂载时的 `resetUndo(def)` 已是准确基线；
//     **导入**是唯一的"同实例换 def"路径 ⇒ 在 `importFile` 里显式 `resetUndoPending()`（清栈，并把下一条
//     观察到的 def 当基线 —— 导入还要经 `canonicalizeDef` 归一化，当下拿不到最终 def）。
//   · 附带好处：重命名现在算一次普通编辑，可以 Ctrl+Z 撤回去。
//   · 断言：CDP `undo-redo` ⑥/⑥a —— 改 `.dsh-wf-name-input` 后 index/size 不归零、历史仍在。
//   标记 `v20261017-undokeep`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261016-oneprob：**问题面板只留左下角一个入口**（2026-10-16 用户原话：「上部有个问题面板和左下角校验是
//   同一个东西，只保留左下角的校验就行，上部的问题面板按钮可用删掉」）。
//   · 删掉画布**工具条**右侧那颗「⚠ 问题(N)」按钮**及其分隔符**；`Toolbar` 不再接收
//     `problemCount / showProblems / onToggleProblems` 三个 props（`FlowGramCanvas` 相应不再传），
//     组件内那个 `problemCount` 局部量一并删除。
//   · 左下角**状态栏**（`.dsh-wf-statusbar`）的「⚠ N 个问题（点击查看）」保持原样，它现在就是唯一入口
//     （点它打开问题面板；关闭走面板自己的 ✕）；`✓ 校验通过` 分支不变。
//   · 用例同步：`test-branch-labels` / `test-loop-visible` 原先点的是**工具条那颗**
//     （`.dsh-wf-fg-tb` 里含「问题」）⇒ 改为点 `.dsh-wf-statusbar-error`（`test-goto-warn` 本来就走这条路径）；
//     产物断言加两条：状态栏入口在 + 旧 title 文案「问题面板（校验/孤立节点）」不再出现。
//   标记 `v20261016-oneprob`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261016-undo：**撤销/重做按钮真正可用**（2026-10-16 用户报「画布上的撤销和重做按钮好像被改坏了，
//   移动画布撤销和重做按钮没反应了」；给 A/B 两方案后用户拍板 **B「自建撤销栈」**）。
//   · 定性（只读排查）：**不是本轮 UI 改动造成的** —— 这两个按钮从 FlowGram 迁移起就没接线、恒为灰。
//     真因两条：①位移走 2026-10-01 自建的原生事件拖拽引擎（直接改 transform），绕过
//     `operationService.onNodePostionUpdate`（free-history-plugin 只在那里记 `dragNodes`，
//     dist/esm/index.js:665-679）；②每次 def→fromJSON 都触发 `document.onReload → historyService.clear()`
//     （同文件 632-634）。⇒ `canUndo()` 恒 false。夹具实测（探针 `tmp-test/cdp/probe-undo-redo.mjs`）：
//     初始 / 拖动节点后 / 移动画布后，撤销+重做 disabled **全为 true**。
//   · 修法（B）：新增 `src/client/undo-stack.ts` —— 在 def（**唯一事实来源**）层记快照栈（上限 60 步；
//     同一连续编辑动作 700ms 内合并成一条，避免"打字每键一条 / 拖动补写多条"）。`FlowPanel` **用一个
//     effect 观察 def** 记录快照（因此 9 处 `setDef` 一处都不用改；快照相同 = 回放 ⇒ 直接忽略，
//     撤销本身不会变成新历史）；撤销/重做 = 回退 def + 把**位移直接改画布实体**
//     （`applyNodePositionsRef`：`structSigOf` 刻意不含 position，只回退位置时 DefSync 会判定"结构没变"
//     而跳过 fromJSON ⇒ 位置必须走这条专线）。切工作流（def.name 变化）自动清栈。
//   · 覆盖范围：位移 / 参数 / 增删节点与连线 / 装饰；`🛟 失败策略` 这类非位移编辑同样可撤销。
//   · 快捷键：接管 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（**编辑框聚焦时放行原生撤销** —— 参数弹窗输入框、
//     Monaco/CodeMirror 各有自己的栈）；FlowGram 内置那套以 `history.disableShortcuts: true` 让位。
//   · 断言：单测 `test/undo-stack.test.mjs`（23 条，含"回放不入栈 / redo 分支丢弃 / 上限 / 合并"）；
//     CDP `undo-redo`（拖动后可撤销 → 退回去 → 重做 → 参数编辑也能撤销 → Ctrl+Z 生效）。
//   标记 `v20261016-undo`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261016-tiptitle：**参数弹窗的说明问号从「最右边线边上」挪到标题旁**（2026-10-16 用户原话：「这段话的小
//   问号在最右边线边上，调整下位置」，指的就是这个弹窗级问号；他贴出来的"这段话"＝ PARAMS_TIPS 那四行）。
//   · 真因：它原先挂在页签行（`.dsh-wf-params-tabs`）**末尾**，而同一行的 `.dsh-wf-params-meta` 带
//     `margin-left:auto` ⇒ 计数被推到最右、问号紧随其后，**天生**顶在弹窗右内边上（不是"夹取没夹好"）。
//   · 修法：插进标题行 `.dag-flow-picker-title` 的**标题文字与关闭按钮之间**——该行是 `flex + gap:8px`、关闭
//     按钮自带 `margin-left:auto`，所以问号稳定停在标题右侧（左上区、显眼、不贴任何边线）；CSS 从
//     `margin-left:8px` 改成 `flex:none`（左右间距交给 gap，避免两处间距叠加）。
//   · 顺带更正**同一气泡里的过时文案**：它还写着「要数字 / true / false / 对象时，把「T」点成「{}」」与
//     「「T / {}」控制该行是否按 JSON 解析」，而这两个按钮在上一轮 `v20261016-paramauto` 已整体撤掉
//     ⇒ 改成描述现状（框内「多行框」把手 / 工具栏「单行框」图标 / 值类型自动识别 + 需要强制字符串时切
//     「JSON 视图」给值加引号）。
//   · 几何断言（CDP `params-images` ③c）：问号在**标题行内**（下边界 ≤ 页签行上边界）+ 距弹窗右内边 ≥ 120px
//     + 点开后气泡文案含「值类型自动识别」且**不含**旧文案「把「T」点成」。
//   标记 `v20261016-tiptitle`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261016-tippos：**小问号气泡不再贴视口边缘**（2026-10-16 用户反馈，同一句说了两遍：「小问号提示信息要
//   放在显眼位置，不要放在靠近边缘线的位置」）。
//   · 旧实现＝「左对齐问号 + 夹进视口」⇒ **靠右的问号**（右侧编辑面板里最常见）会把气泡一路挤到视口右边缘、
//     贴着边线走（在面板里点开肉眼可见）。
//   · 新实现＝**按问号所在的半边选对齐**：中心在视口右半边 ⇒ 气泡**右缘对齐问号右缘**（向左展开、朝界面
//     中间伸）；左半边 ⇒ 左缘对齐问号（向右展开）。安全边距 8px → **16px**（水平与垂直都收在 16px 内）。
//   · 几何断言（CDP `doc-parse-panel`）：前提"该问号在右半边" + "气泡右缘 ≤ 问号右缘"（证明确实向左展开）
//     + "左/右/下留白均 ≥ 12px"（证明不贴边）。
//   标记 `v20261016-tippos`（纯客户端 ⇒ **硬刷新**即可）。
//
// v20261016-paramauto：**参数弹窗去掉两个切换按钮**（2026-10-16 用户原话：「参数弹窗里面的文字和json切换的
//   按钮，必须要有这两种形态的数据吗，单行输入和富文本框切换，必须要有这两种形态吗，如果不需要保持多形态，
//   能否统一化，不要切换了」⇒ 我给了 A/B/C 三个候选并推荐 A，用户选 **A**）。
//   · 两个按钮本来管的是两件事：`T/{}`＝**落盘值的类型**（字符串 vs 数字/布尔/对象，影响 def 与引擎消费，
//     `executor/dataflow.ts:119` 明确"纯引用保持类型"）；`单行/富文本`＝**编辑控件形态**（不影响数据）。
//   · **去掉 `T/{}`**：值类型改为**自动推断**（`valueOfText`）——纯数字样→数字、`true/false`→布尔、
//     `{…}`/`[…]` 且能解析→对象/数组、其余按**原文字符串**；有首尾空白不猜（按原文存）；`null` 仍＝删键语义。
//     判据（我跑的只读统计，5 份工作流 118 个参数）：字符串 62 / 数字 30 / 对象 26，而 62 个字符串里
//     **没有一个**"看起来像数字/布尔/JSON" ⇒ 自动推断在现有数据上**零误判**。
//     ⚠ 已知代价（已在候选里说明）：`"0012"`、`"1.0"` 这类"看起来像数字的字符串"会被存成数字，
//     需要字符串时切 JSON 视图手写引号。
//   · **形态不再占行内按钮**：单行框右侧一个小把手 `.dsh-wf-params-grow`（点了升级为多行框）；
//     多行框的"改回单行"放进富文本工具栏 `.dsh-wf-params-shrink`（形态双向仍可用，只是不再常驻两个按钮）。
//     ⇒ 每行常驻按钮从 2 个降到 **0 个**（只剩删除 ✕）。
//   · 死代码一并清理：`.dsh-wf-params-type` / `.dsh-wf-params-form` 的样式与 `Row.kind` 字段全删；
//     过时探针 `tmp-test/cdp/probe-paramtoggle.mjs`（专验"类型开关把富文本压成单行"那个 bug）删除
//     ——该 bug 的场景已随按钮撤掉而不存在；`probe-placeholder*.mjs`、`shot-imgpick.mjs`、
//     `shot-params-editor.mjs` 改点新把手。
//   · 断言随设计翻转（CDP 3 处）：`params-editor` ⑤b 由"新增行默认字符串 + 点 T/{} 变数字"改成
//     "填 4096 就是数字、填中文仍是字符串、行内已无类型开关"；`params-images` ⑥ 与 ④b 改成
//     "行内无类型开关 + 形态把手双向可用"；`code-file` ② 由"code 行也有单行/富文本按钮"改成
//     "富文本工具栏里有「变单行」、且富文本里没有升级把手"。markers 新增正向（grow/shrink）与
//     反向（不再有 params-type/params-form）两类断言。
//   标记 `v20261016-paramauto`（host + client 同步升位；纯客户端改动 ⇒ **硬刷新**即可）。
//
// v20261016-infotip：**解释信息收进小问号**（2026-10-16 用户原话：「所有编辑框，富文本框，弹窗里面需要
//   解释的地方，解释的信息统一放到合适的地方用个小问号，单击显示解释内容，现在平铺解释信息很乱」）。
//   · 新组件 `src/client/info-tip.tsx`（`InfoTip`）：线条问号（14×14 / viewBox 24 / strokeWidth 2 / round，
//     与项目其它图标同规格）+ 单击气泡。气泡 **Portal 到 body**（面板与弹窗遮罩的 backdrop-filter 会给
//     fixed 造包含块——同 image-picker 的教训）；单击开、再单击关、点外面关、Esc 关、滚动/缩放关；
//     同一时刻只开一个；**只做 opacity 淡入 140ms**（有几何依赖的浮层不做 transform）。
//     ★故意不写 `title`：全局 hover-tip 会接管 title 再弹一层，与点击气泡重复。
//   · **位置＝方案 A（用户拍板）**：问号紧跟它解释的那个标签/字段右侧。
//   · **口径（用户拍板）**：只收**静态解释**（怎么填、什么语义、什么限制）；**动态状态一律留平铺**——
//     ⚠ 警告（LOOP_NO_BOUND、模型不在可用列表）、空态引导（无上游/无全局变量/暂无 case）、
//     测试与运行结果、当前值回显（执行 id、上游/输出/全局计数）、失败策略每个选项的语义说明（10-10 定的）。
//   · 落地处：`params-editor`（字段说明＝参数名框右侧问号；弹窗级说明＝标题区问号；JSON 视图与试跑条各一个；
//     富文本框工具栏末端的「Tab = 4 空格缩进」、字段视图顶部与新增按钮旁的常驻说明都收走）；
//     `inspector-fields`（`row()` 的 hint 统一变标签右侧问号；SessionInput / 图 / 视频 / 搜索 / 文档解析 /
//     网页抓取的表单级说明也各自挂到首行问号）；`NodeInspector`（循环设置 / 循环体 / 分支设置 / 代码 /
//     选择模型 / 变量搜索 / 变量入口 / 参数与试跑）；`var-picker`（静态说明进问号，命中数等动态信息留平铺）。
//   · 断言随设计翻转：`verify-build-markers` 里旧锚点「点变量插入到值框光标处」改成气泡新文案 +
//     `dsh-wf-info` / `dsh-wf-info-pop`；CDP `params-images` ③ 与 `doc-parse-panel` 由"读平铺文本"
//     改成"点开问号再读气泡文本"（顺带证明这条交互真的可用）。
//   标记 `v20261016-infotip`（host + client 同步升位）。
//
// v20261016-pdfimg：**PDF 抽图**（2026-10-16 用户：「开始PDF 抽图」）。
//   · host（本轮改动都在 host；客户端无功能变化，标记同步升位以保持两侧产物组合可辨识）：
//     新增 `src/registry/doc-image-pdf.ts`（零依赖）——扫对象表找 `/Subtype /Image`：
//       `/DCTDecode` ⇒ **原样取 JPEG**（零重编码，覆盖绝大多数 PDF 里的照片）；
//       `/FlateDecode` ⇒ 扫描时已 inflate 的**原始像素** ⇒ 现场编码 PNG（8 位灰度/真彩，
//         IHDR/IDAT/IEND + CRC32，`node:zlib` 压缩）；`/DecodeParms` 的 Predictor 2（TIFF）
//         与 10–15（PNG 系列）先反预测再编码。
//       `/JPXDecode`（JPEG2000）`/CCITTFaxDecode`/`/JBIG2Decode`/`/LZWDecode`/`/RunLengthDecode`/
//         `/ImageMask`/非 8 位/调色板/长度对不上 ⇒ **明确跳过并计数原因**（绝不产出打不开的图）。
//     页归属：按页 `/Resources` 里的 `/XObject` 引用反查 ⇒ 文本标记能落在**对应页**文本之后；
//       没被任何页引用的图像对象排文末（page=0），保证落盘的图在文本里都有出处。
//     `src/registry/doc-pdf.ts` 的 `extractPdf` 新增返回 `pages[]`（**纯加法**：逐页文本，
//       与 pageNums 一一对应含空页）；`doc-extract.ts` 的 `.pdf` 分支只在**真抽到图**时才用
//       `pages` 重排文本并插 `[图片 #N]` ⇒ 无图 PDF 的输出与改动前**逐字相同**。
//   · 落盘/命名/幂等复用既有的 `adapter/image-library`（`<doc>-<n>.<ext>`），节点侧无需改动。
//   · 轮内追加（用户：「只有图没有文字的，text 里面说明抽出来的图片地址就行」）：**无文本层但整页是图**的
//     扫描件，在 OCR 关着时不再一律抛 `DOC_NO_TEXT_LAYER`——能抽出图就**成功返回**：
//       文本 = 一行说明 + 每张一行 `[图片：<文件名>]`（落盘后的真实文件名，文件就在统一图片目录里
//       ⇒ 这段文本就是"图片地址清单"）；`meta.imagesOnly = true`；`out.images` 照常给出。
//     边界（都是"行为不变"）：OCR 自动/强制 ⇒ 照旧栅格化 + OCR（既有通路不动）；`extractImages:'off'`
//       或一张图都抽不出来 ⇒ 保持原来的报错与提示。
//     节点侧把落盘+替换占位抽成 `landImages()`，主流程与"纯图 PDF"共用，避免两份落盘代码分叉。
//   · 真机证据（`tmp-test/build/scan-sample.pdf`，2 页真实扫描件）：内核零损失抽出 2 张 1240×420 JPEG
//     （31004B / 25033B，SOI/EOI 完整）⇒ 节点文本逐行给出 `[图片：scan-sample-1.jpg]` / `-2.jpg`。
//
// v20261016-modality：**P2 不静默降级**（2026-10-16 用户：「开始P2 不静默降级」）。
//   · host：新增 `checkImageModality(endpoint, count)`（`src/adapter/llm-modality.ts`）——按 `images` 的
//     **真实条数**判模态：`count > 0` 而模型 `input` 不含 image ⇒ **发调用之前**直接失败
//     `MODEL_MODALITY_MISMATCH`，提示「你配了 N 张图片…」——既**不静默丢图**、也不"只发文本"。
//     `count = 0` ⇒ 返回 null（不干预：不填 images 时行为与改动前完全一致）。
//     调用点＝`runSubagentNode` 里"prompt 扫描"之后、"读图字节"之前；条数用新纯函数
//     `countImageEntries`（**不抛错**，格式/上限仍由 `parseImageList` 报）。
//     ★ 与 prompt 扫描（image/video/file 扩展名）是**两条互补判据，都保留**：后者防"让模型读 PDF"白跑。
//   · client：模型能力提示叠加「当前已配 N 张图」（支持 / 不支持两种文案分别说清后果），
//     客户端用同口径的 `countImageRows`（R3 不能 import 宿主模块；两份契约由 `test/modality.test.mjs`
//     的 B9 段（host 侧）与 CDP 的 images 用例（client 侧）看住）。
//
// v20261016-imgpick5：**示例占位不再依赖"自动补行"（真正的根因）**（2026-10-16 用户：「已经重启了，
//   参数弹窗里面的images参数的示例占位还是没改好」）。前两版都在改文案（长度/形态分支），但**示例
//   是写进行对象 `Row.placeholder` 的，而它只在「自动补行」那条分支里赋值** ⇒ 只要 `def` 里已经有
//   `images` 这个键（用户填过值、清空过、或早期类型开关 bug 留下的 `"images": ""`），该行就走
//   `Object.entries(params)` 分支、**示例永久丢失**，显示的只是通用文案。⇒ 改为按字段名**无条件**
//   附示例（`rowsFromParams` 的 params 分支也取 `fieldPlaceholders[k]`）。
//   ★CDP 新增 ⑤c 回归：先让 def 里存在 images 键再清空，断言示例占位仍在。
//
// v20261016-imgpick4：**示例占位收短（单行形态会被裁）**（2026-10-16 用户：「示例占位还是没改好」）。
//   量化实测（`tmp-test/cdp/probe-placeholder.mjs`）：单行形态把多行示例折成一行后，文字宽 **443px**
//   > 输入框可用 **438px** ⇒ 恰好超出，肉眼就是尾部贴边/被切。⇒ 示例收短成三类写法的短代表
//   （`每行一个：` / `chart.png` / `C:\图片\a.jpg` / `https://x.png`，详细规则仍在下方的说明文字里），
//   并给 CDP 加了**几何断言**（②d：文字宽 ≤ 可用宽），防止以后文案再变长又悄悄被裁。
//
// v20261016-imgpick3：**修「富文本框↔输入框切换后示例占位消失」**（2026-10-16 用户报：「参数里面的富文本框
//   和输入框切换后，框内的示例占位没有了」）。单行 `input` 分支原先写死 `值（字符串）`/`值（JSON…）`，
//   把该字段登记的示例丢了 ⇒ 新增 `singleLinePlaceholder(r)`：优先用 `r.placeholder`（多行示例折成
//   「a / b / c」一行，因为 input 的 placeholder 不认换行），没登记示例才回退通用文案；
//   顺带让**放大编辑弹窗**也用该字段的示例（原来是写死的 `'…'`）。

// v20261016-imgpick2：**修「参数里输入框和富文本框切换失效」+「🖼 选图」挪位**（2026-10-16 用户报：
//   「引发其他bug了，参数里面输入框和富文本框切换失效了」+「图片选择的弹窗按钮，在提示语后面有点奇怪，
//   最好放在一个合适的位置，富文本框里面是否可以」）。
//   · 真因（CDP 实测复现）：**类型开关 T/{} 的 onClick 里顺带写了 `multi: false`**（把"类型"和"形态"
//     耦在一起）⇒ 默认是富文本框的行，点一下类型开关就被压成单行、**再点也回不到富文本**。
//     现在它只切类型，形态由右侧「单行/富文本」按钮单独控制。
//   · 顺带修：`paramsFromRows` 里 auto 行的"留空不写进 def"只在 string 分支生效 ⇒ 把类型切成 `{}` 后
//     空文本会写进 `"images": ""` 脏值。判断已提到类型分支之前（与类型无关）。
//   · 「🖼 选图」从说明文字后面挪进**富文本框工具栏**（与「📋 复制」「🧹 清空」同一排，只在该参数行出现）。
//   · 选图弹窗：401/404 时不再暴露 `res.json()` 的解析错误，改成「HTTP 401（图片清单接口还没生效——重启
//     dsh web 后重试）」；新增「↻ 重新读取」（往目录里放完图不用关弹窗重开）。

// v20261016-imgpick：**「🖼 选图」弹窗——从统一图片目录勾选多张**（2026-10-16 用户原话：「针对统一图片目录
//   里面有多张图片要添加，现在一个一个复制名称有点麻烦，有解决办法吗」→ 我出四个候选，用户拍板「按照推荐A做」）。
//   · 形态：`images` 行的说明旁一颗「🖼 选图」→ 弹窗（`.dag-flow-picker.dsh-wf-imgpick`，760px）里列统一图片
//     目录下的图（文件名/大小/修改时间，按最近修改倒序），支持文件名搜索、点行勾选、全选/清空勾选、
//     「☐ 覆盖原有内容」（默认**追加并去重**）、「✓ 写入已选（N）」主操作；另有「📁 打开图片目录」
//     复用既有 `/open-folder`（`sub:'images'`，零新路由）。
//   · 数据源：新增只读路由 `GET /api/dag-flow/images`（`listImageFiles()`：只根目录、跳隐藏与子目录、
//     只认 png/jpg/jpeg/webp/gif、按 mtime 倒序；目录不存在＝空清单不是错误）。
//   · 产物/断言：markers 加 ASCII 锚点 `dsh-wf-imgpick` 与 `/api/dag-flow/images`；离线契约 G 段 5 条。
//
// v20261016-images2：**AI 子代理节点的 `images` 参数（多模态传图 P1）**（2026-10-16 用户拍板原话：
//   「开始执行p1，读取图片的位置，放在统一的位置，方便后续文档解析节点解析出来的图片，也放到同一个位置使用」）。
//   · 参数弹窗给 `subagent` 自动补出一行 `images`（走 `fieldHints` 机制，同 python `codePath` 先例；
//     `auto:true` ⇒ **留空不写进 def**，不填就与改动前完全一致＝纯加法零行为变更），默认多行富文本框。
//   · 相对路径基准＝**统一图片目录** `<DSH_HOME>/.dag-flow/images/`（只写文件名即可；绝对路径与 http(s) URL 照旧）。
//     路径唯一出处＝`src/dsh-gate/paths.ts` 的 `dagFlowImagesDir()`（启动时由 storage 建好该目录）；
//     doc_parse 将来从 PDF/Office 抽出的图片也落同一目录，两边天然对齐。
//   · （images2）用户追问「多张图片、多个路径或 URL 要怎么区分」⇒ 给该行加**示例占位**（`fieldPlaceholders`：
//     每行一个，示例为 文件名 / 绝对路径 / URL 三类），一眼看出「换行＝分隔符」。
//   · 宿主侧实现见 `src/adapter/image-inputs.ts`（解析/载入）与 `src/adapter/subagent.ts`（真发图）。
//
// 以下为 2026-10-16 从 `src/client/index.tsx` 头部原样迁出的历史变更注记（旧→新阅读）。

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
//     ≤3 个 case：`labels` 逐行标签（保持既有行为，行数少不别扭）
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
