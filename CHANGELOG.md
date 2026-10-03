# CHANGELOG

## v0.2 (current)

> 主题：**FlowGram 画布 + 节点扩展 + 重命名 dag-flow + 工作区 JSON 存储**。

### 破坏性更名
- 插件名 `dsh-workflow-builder` → **`dag-flow`**（package.json / cordis.patch.yml / API 前缀 `/api/dag-flow` / 存储目录 `.dag-flow-workflows/`）

### 新增
- **FlowGram 画布**：`@flowgram.ai/free-layout-editor` 替换 reactflow v11（minimap / 自由吸附 / 问题面板 / 运行状态徽标回放 / 连线配色）
- **节点 12 → 20**：`merge` / `subflow` / `session_input` / `image_generate` / `video_generate` / `file_save` / `web_search` / `web_fetch`
- **搜索/抓取**（方案 C）：内置 5 个免 key 引擎（Bing / DDG Lite / DDG / SearXNG / AnySearch）+ 宿主 dsh-free-search 优先、失败自动回落；`web_fetch` 剥 HTML / 解析 JSON / raw 三模式
- **数据引用数组下标**：`{{nodeId.out.list.0.url}}`
- **节点参数必填预检**：运行前一次性检出全部节点必填缺失（`NODE_PARAMS_INVALID` 附逐节点明细，不进入执行）；AI 生成结果同步校验，缺必填直接拒绝并给出修复指引；AI 系统提示词注入必填红线 + subagent schema 标注 model 必填；画布问题面板补齐 if/switch/log/manual/set_var/subflow/session_input 七类校验
- **模型多模态能力感知**：`/models` 透传 settings.yaml 的 `models[].input` 模态（text/image，未标注视为仅文本）；subagent 模型下拉显示 📷 徽章、选中纯文本模型提示不支持图片；运行前校验 prompt 引用（图片/视频/文件扩展名）与模型能力，不匹配 → `MODEL_MODALITY_MISMATCH` 明确失败并给出换模型/标注能力两条出路
- **image_generate 提前测试**：配置面板「🔍 测试连接」真实发一次最小生成请求，验证 baseURL/Key/模型组合（401 Key 无效 / 404 模型不存在 / 400 参数不支持 均给出针对性指引），新增 `/test-image-api` 路由
- **版本管理**：工作流保存自动快照，最近 20 份可回读（`/workflows/<name>/versions`）
- **统一落盘布局**：全部运行数据收拢 `<工作区>/.dag-flow/`——工作流定义 `workflow/`、运行记录 `runs/`、临时文件 `tmp/`、按天日志 `logs/`；最终产出（图片/视频/文件）直接放 `.dag-flow/` 根下（可含子目录，防路径穿越）；旧 `.dag-flow-workflows/` 不迁移不删除
- **管理视图**：过滤 / 重命名 / 复制 / 删除 / 版本历史 / 导入导出
- **侧边栏入口** + 工作流选择器组合框（过滤 + 内联新建）

### 变更
- **存储 SQLite → 工作区 JSON**：`<工作区>/.dag-flow-workflows/<name>.json` + `runs/`，原子写（同盘 tmp+rename）；旧 `~/.dsh/workflows/workflows.db` 首启自动导出
- **模型/密钥收编 dsh**：插件零密钥存储；`/models` 只读自动发现；AI 节点**模型必选**（UI 拦截保存/试跑/运行 + 执行层 `MODEL_REQUIRED` 兜底）
- **留空中断语义**：subagent prompt / web_search query / web_fetch url 为空 → 对应错误码秒返，不发请求、流程中断
- onError 失败策略泛化（stop / continue / goto）；merge 需 ≥2 上游
- 测试体系：vitest 遗留 → 纯 node 离线套件（offline 30 / runtime 24 / storage-json 6 / api-e2e 46 / search 24 / node-matrix 27 / install-check 22）

### 修复（2026-09-26 全量回归）
- dist/ 混入旧 tsc 管线产物（含旧插件名）→ 清理并重生成声明文件，install-check 新增 dist 全目录旧名扫描
- dataflow 数组路径遍历拒绝数组 → 支持数组下标；yaml-lite 嵌套列表解析丢数据 → 惰性对象转数组
- README 重写对齐现状；移除 pnpm 遗留与 vitest 时代测试文件

### 变更（2026-10-03）
- **AI 节点模型下拉显示「模型显示名」**（用户原话：「ai子代理节点里面的选择模型，最好是改成下拉选显示名称改成模型显示名称，不用模型id，不容易分辨，代码里面可以用模型id确定调用的模型」）：`/models` 新增 `label`（宿主 `llm.listModels` 的 name，如 `deepseek-flash` → `DeepSeek-V41-Flash`）与 `providerLabel`（提供方显示名）；下拉 option 文案改为显示名、**同名时才补提供方名消歧**、宿主未提供显示名时回退 model id；**option 的 value 仍是模型 id**（存值/执行零变化），下拉下方细字始终给出「执行 id」便于对照 JSON。`id`/`name`/`model` 字段保持不变（向后兼容）。锁定：`test/host-llm.test.mjs` G1–G5 + CDP `model-select`（显示名/不出现内部 id/同名消歧/无显示名回退/徽标仍在/value 仍是 id/空列表分支）。
- **显示名收口到错误消息与 settings 源**（同一诉求的延续）：①`checkModelModality` 的 `MODEL_MODALITY_MISMATCH` 消息改用 `modelLabel ?? providerName ?? model`（此前印内部串 `llm:deepseek-official:deepseek-flash`），docs/ERROR_REFERENCE.md 同步；②settings 直读源（`buildLlmCandidates`）补 `providerLabel = provider 键名`（如 `custom-model`），并把 `models[].name` 在**与 id 不同**时才当 `modelLabel` 带上（name===id 不带 → UI 老实回退 model id）——修掉「同名消歧时回退内部串 `custom-model:doubao-seed-2.1-pro`」的难看文案。锁定：`llm-config` J1–J5、`host-llm` H1–H4。
- **模型列表去重 + 下拉「重进即定位已选模型」**（用户 2026-10-03 拍板 + 反馈）：①`listAllEndpoints` 去重键由 `providerName` 改为**去掉 `llm:` 前缀后的 `provider:model`**——host 发现的 `llm:<p>:<m>` 与 settings 直读的 `<p>:<m>` 是同一批模型的两种来源，保留 host 那条（带显示名 + host 路由）；真机实测 56 → **39 条**（去掉 17 条重复）。**故意不按 model 单独去重**：`custom-model` 与 `custom-model-vision` 是同一模型的两条不同路由（后者多「自动识图」），按 model 去重只剩 18 条且会误删能力。②下拉把**已选中的那条挪到列表最前**（紧跟占位项，只调顺序、不复制、不改 value）→ 重进下拉直接定位；③同一节点被换掉 def 时用 effect 把下拉 value 同步回 def。锁定：`host-llm` G6–G8（去重）、CDP `model-select` ③ 段（重进后 value 仍是所选 / 已选项在最前 / def 存值仍是 id）+ ④ 段（清空选择后任何项都不带 ✓，重复重进一致）。
- **下拉给「已选中模型」加选中态标记**（用户 2026-10-03 补充口径：「点开下拉选项的已经选中的下拉选项就有一个选中的状态标记它……如果没有已经选择的下拉选，点开下拉选项的时候，就没有选中状态，都可以选」）：原生 `<option>` 不能设背景色/图标，故用文案前缀 **`✓ `** 标在**当前已选那一条**（含「存值不在当前列表」的 `✓ ⚠ …（当前值）` 那条）；未选任何模型时任何一项都不带 ✓。它同时出现在展开列表与收起显示里（原生 select 两者共用同一文案——若只想要展开态才标，需要换自定义下拉，另议）。锁定：CDP `model-select` ①/③/④ 段（同一时刻只有一条带 ✓ / 未选中的都不带 / 清空后 0 条带 ✓）。
- **switch 分支键改「横排 chips」**（用户 2026-10-03 反馈：「这个图片里面 quick，full，vedio，image，其他；是竖向展示，很别扭，也会遮挡，优化一下」；原型三选一后拍板 A）：`switchLayout()` 变三档（唯一的端口/卡片同源真源）——≤3 个 case 保持逐行标签；**4~6 个 case 进入 chips 档**：端口行只留极淡序号 ①②③…（与端口同高，`★` 表示兜底），分支键横排成一行 chips 贴卡片**底部做图例**（`1·quick` `2·full` … `★其他`），**悬停 chip → 对应行序号高亮放大**（拖线不认错是哪个 case）；≥7 个 case 仍是 tight（行距 12 + 卡内不留字）。行距 30→16px、端口起点仍 22px：**5 个 case 卡高 166 → 136px**，且文字不再贴着右边缘被裁。★chips 放底部（而非标题下）的原因：头部实测 ~80px，chips 放上面就得把端口下移到 112px 起，卡片反而涨到 192px。锁定：CDP 新增 `switch-chips`（chips 数量/文案顺序、卡内无逐行标签、行距 16px、起点 22px、chips 在末行下方 ≥6px 且不溢出、悬停高亮 chip+行号、移出消失、≤3 case 仍走逐行标签）。
- **switch 端口行删除：只留一行 chips，「选中哪个 chip，画线就带哪个分支」**（用户 2026-10-03 拍板 B，原话：「switch节点里面的端口行去掉，保留chips，选择哪个chips，画线带出来的就是哪个分支，如果有很多分支或者chips没展示出来，就在节点里面写明情况说明，先画线，再在线上选择需要的case分支，节点保持和其他的节点大小一致」）：
  - **端口**：每个 case 仍各有端口（`portID` ↔ `flowDef` 的 `sourceHandle`/`when` ↔ 执行器 `node.next` 这条原链路**一字未改**，多个 case 指向同一目标照旧），但**不给 locationConfig** → 引擎像普通节点一样垂直居中，所有出口锚在同一像素（实测 5 个圆点全在 `(585,287)`＝卡片垂直中线）⇒ 视觉上只有一个圆点、端口行消失；新增 `out` 端口＝「这条线还没选分支键」（`flowDef.fromRF` 按未设分支处理，不会退化成顺序执行）。
  - **画线带哪个分支**：**不**依赖「鼠标命中哪个端口」（同坐标叠着多个端口元素，命中顺序由引擎绘制决定，实测会命中任意 case）——`onContentChange` 里 `adoptChipCaseForNewLines()` 把**本次新建的** switch 出线就地改端口为「节点上选中的 chip」（没选中则保持 `out`＝先画线、再在线上点选）；老线一律不动（按「同 from→to 的 out 线数量超出上一帧快照」判定新线，否则改一次选择会把历史线全带跑）。
  - **卡片**：逐行分支标签 + 行序号全删；一行 chips（上限 4 个，超出→前 3 个 + `+N`），点 chip 选中/再点取消（`✓` 前缀 + 强调色，`switchCaseStore`）；chips 放不下时卡内补一行「还有 N 个分支未展示 · 先画线，再在线上点选分支」。
  - **高度恒定**（用户要「和其他节点大小一致」）：实测普通节点 78px、switch 恒定 **91px**（＝+一行 chips）、溢出说明再 +16px＝**107px**，**与 case 数无关**（旧版 4~6 case 136px / 8 case 142px / 20 case 646px）。
  - 附带修：多个 case 指向同一目标时，连线中点的分支键标签此前精确重叠 → 按同源线序号纵向错开 13px。
  - ★ 踩坑记录：React 的**委托** `onClick` 在 FlowGram 节点卡内收不到（节点层把 click/mousedown 冒泡 `stopPropagation` 掉了，连 `chip.click()` 都不触发）→ chip 改用**元素上的原生监听器**；同时不再按选中重排端口（那次 `updateAllPorts` 已删，改 case / 改选择都不动已画出的线）。
  - 锁定：CDP `switch-chips` 重写（端口行/逐行标签消失、chips `3+「+2」`、说明文案、91/107 高度、点选与取消、**真机拖线**：选中 video→新线 `when=video`；未选中→`when=out`；原 4 条 case 线一条不少）、`switch-many` 重写（9 个出口仍 107px、与 5 个出口同高、8 条 case 线齐全且标签纵向错开）、`branch-labels` ④ 段改写（if 仍是真/假逐行标签、switch 无卡内标签 + 3 chips + 91px）。
- **switch「选中哪个 chip，画线就带哪个 case」真机修**（用户 2026-10-03 真机反馈：「选择哪个chips，画线带出来的就是哪个case，这个没实现，如果没有选择的话，画出来的线兜底的其他else情况，或者手动再选择没看到case」；本条**更正**上一段 43 行里「实测会命中任意 case」的笼统说法）：
  - **根因**：上一版的新线归属只处理「引擎把新线挂在 `out` 端口上」的情形；真机实测引擎把新线挂到的是 **`*` 兜底端口**（同坐标叠着多个端口，命中哪个由引擎绘制顺序决定——夹具里恰好命中 `out` 所以自测全绿、真机不生效）→ 选中 chip 后画线仍带着 `*`（显示「其他」）。
  - **修法**：`adoptChipCaseForNewLines` 改为**与命中端口无关**——源节点是 switch 且属「本次新建」（同 `from→to` 线数超出上一帧快照）的线，一律按节点上选中的 chip 就地改端口；**没选中则强制归到 `out`**（未设分支，绝不静默变成 `*` 兜底）；老线一律不动。新增真机诊断钩子 `window.__df_lastLineAdopt`（hit→want/applied），配合 `__df_lastChipClick` 可定位「点了没反应 / 拉线没带分支」。
  - **「手动再选择没看到 case」**：折叠的 chips 现在**可点开**——点末尾「+N」展开成多行、把所有 case 露出来并可选（卡片随用户操作临时变高），再点「收起」还原；卡内说明文案改为「还有 N 个分支未展示 · 点「+N」展开，或先画线再在线上点选分支」。
  - 锁定：CDP `switch-chips` 新增 ⑤（未选中 → `out`，归属钩子 want=out）、⑥（同页先画一条不选、再选 full 画一条 → 各归各的；老线不被改写：恰好 1 条 out + 2 条 full）、⑦（默认折叠不含 image → 点「+2」展开含 image/其他/收起 → 展开态卡片变高、说明消失 → 展开后能直接选中被折叠的 case）；拖线落点改为「编辑器内避开所有节点卡的空白点」（避免砸到刚建的节点、不弹快选面板）。
  - 已知抖动用例：`line-drop-panel` 本轮 3 次里 2 次超时（4400ms 逼近内部超时）、复跑通过，与本次改动无关（它拖的是 start 节点的端口，本改动不碰非 switch 源）。
- **右侧节点面板新增「变量引用」区：上游变量 / 全局变量 / 本节点输出，全部点击复制 + 逐条说明作用**（用户 2026-10-03 需求原话：「画布右边的节点编辑面板里面，要展示上游能传过来的所有变量，点击复制可以使用，包括全局变量，也要展示能给下游输出的所有变量，点击可以复制变量使用，也要包含全局变量，方便用户开发工作流的时候直接使用，最好能说明一下每个变量作用是什么」）：
  - 新增 `src/client/types.ts` 的 `NODE_OUT_SPECS` + `outSpecOf()`（**逐个读 `src/registry/builtin.ts` 各 run() 的 out 核实**的输出字段表，带每个字段的中文含义）：object 型给字段级路径；scalar 型（python/bash/subagent/log/if）说明「整份输出是什么」；dynamic 型（start/end/set_var/merge/session_input）只给整取引用 + 来源说明；**未登记类型绝不猜字段名**。
  - 面板三块（都包在 `.dsh-wf-panel-row` 里，chips 沿用既有样式）：①「🔗 上游变量（N 个上游节点 · 点击复制）」按上游节点分组，组头 `类型 · 节点id —— 整份输出是什么`，组内 chips = `{{id.out}}` + 字段级 `{{id.out.字段}}` + `{{results.id}}`（执行状态），组下一行「字段说明：count=结果条数 · results.0.url=第 1 条链接 · …」；②「🌐 全局变量（vars N · inputs N）」= 所有「设置变量」节点写过的 `{{vars.*}}`（title 注明由谁写入）+ 工作流参数 `{{inputs.*}}` + 循环体注入的 `{{vars.loopItem}} / {{vars.loopIndex}}`；③「📤 本节点输出（下游可直接引用）」= 本节点整份/字段引用 + `{{results.本节点}}` + 「本节点输出是什么：…」+ 下游用法（参数里用 `{{}}` 模板、if/switch/loop 表达式里不带 `{{}}`）。按用户要求**全局变量在上游区与本节点输出区各重复一份**（分别标注「不来自上游，任意位置都能引用」「下游同样能直接引用」）。
  - 交互：点击 chip → 写剪贴板 + 面板提示「已复制：{{…}}」（1.2s 消失）；每个 chip 的 tooltip 写「点击复制：… / 作用：…」。
  - 锁定：CDP 新增 `var-refs`（夹具 `?vars=1` = start→seed(set_var)→fetch(web_search)→py(python)→ai(subagent)→end + `def.inputs` 两项）——7 组断言：上游分组与字段级 chip、字段说明行、全局变量（vars/inputs/循环变量）、标量输出说明与 `is-out` 配色、点击复制（剪贴板探针 + 面板提示）、换节点后上游数量随动且对象型节点给字段级 chip、全局变量三处都在、面板无 `undefined`。
- **变量面板升级：节点跑过一次后，字段改由「真实运行输出」反推**（用户 2026-10-03 追加：「现在字段表是静态的（按节点类型）……按照这个优化」+「用户自定义的字段，你是怎么抽取的，定义作用的」）：
  - 新增 `src/client/outFields.ts`（纯函数、可单测）：`fieldsFromValue(out)` 把一次真实输出抽成**可引用字段**——对象按键展开（≤3 层）、数组只展开第 1 个元素（对应 `{{id.out.results.0.url}}` 写法）、**键名含点/空白/方括号/花括号的键跳过并计数**（拼进 `{{}}` 会歧义/解析失败）、默认 ≤30 条防面板被大对象撑爆；`sampleOf`/`kindOf` 给单行样例与类型。
  - 面板 `fieldsFor()`：**优先用 `RunSummary.results[id].out` 反推**（组头标「（字段取自上次运行的真实输出）」，说明行写「实测字段：count=2（number）（结果条数） · results.0.url=https://…（string）（第 1 条链接）」）；没跑过（或输出是标量）退回静态表；**用户自定义键**由此自动出现——「设置变量」节点用它的 `params.vars` 键补齐（跑没跑过都有），其余动态节点（merge / session_input / subagent / 自定义返回对象）跑过就列出真实键名；静态表里有、本次输出没出现的字段补在末尾并注明「（本次输出里没有，按定义补）」；上游节点上次是 failed/skipped 时标注「（上次运行是 failed，字段按类型推断）」。
  - 锁定：新增离线单测 `test/out-fields.test.mjs`（**28 断言**：标量/空值不给字段、逐层展开、数组只取第 1 元素、中文键、含点键跳过并计数、maxFields/maxDepth 上限、sampleOf/kindOf 口径）→ 已进 `test:offline`（**17 个文件**）；CDP `var-refs` 新增 ⑧ 段——夹具 `/run` stub 改成返回**各类型的真实形状输出**（web_search 的 results 数组 / set_var 的 vars / python 的字符串 / http 的 {status,body}…），断言来源标注、深层字段 `{{fetch.out.results.0.url}}`、样例值+中文含义、自定义键 `{{seed.out.topic}}` 带样例、以及本节点输出同样走实测字段。
- **子工作流跳转：双击 loop/subflow 进入，header 一键返回**（用户 2026-10-03 需求原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，子工作流也可以一键切回到父工作流的循环节点」；拍板：返回入口=header 返回胶囊 + 面包屑，范围=loop + subflow）：①双击手势接在节点的原生 `dblclick`（此前无绑定）→ `FlowPanel.handleNodeDoubleClick` 取 `loop.params.body.workflowName` / `subflow.params.workflowName`；②跳转前 flush 当前工作流（重挂载会清掉 2s 自动保存计时器）；③导航栈独立成 `src/client/navStack.ts`（真实路径与 CDP 夹具共用同一份，夹具只替换「换 def」这一件事 = setState + key 重挂载），栈存**父 def 快照（含未保存编辑）+ 来源节点 id**，返回时恢复并**重新选中来源循环节点**；④守卫：未选子工作流 / 子工作流 404 / 自引用 / 成环 → 只提示不跳转（header 提示条 4s 自动消失）；⑤生产侧「换 def」沿用 `setDockDef(def, bump)` 重挂载停靠面板（与「打开已有工作流」同一条通路）。锁定：CDP 新增 `loop-jump`（双击 loop 进入 / 面包屑+返回胶囊 / 返回后重新选中来源节点 / subflow 同样可进 / 没选循环体提示 / 循环体不存在提示且不跳转）。

### 修复（2026-10-03 分支/循环/AI 三修）
- **switch 多 case 共用一个目标节点被误跳过**：`quick→log_mode` 与新增的 `image→log_mode` 并存时，未激活的那条边把 `log_mode` 塞进 skipped，表现为「AI 汇总成功但不写运行日志」。改为先收集「激活目标」再判定跳过（有任意一条激活入边即执行）。回归锁：`test/loop.test.mjs` H1–H6（已实测旧逻辑 H1/H5 必挂、H2/H6 仍绿）
- **AI 节点空输出报成功**：宿主 LLM 契约用错（`messages[].content` 传字符串、忽略对象形 `finish.reason`）→ 静默「成功但无结果」。改为 `content: [{type:'text'}]` + 按 `reason.kind` / `failure.{code,message,status}` 判定；零 chunk 或空文本 → `SUBAGENT_EMPTY_OUTPUT`（宿主真机 deepseek-flash 已跑通）
- **loop 循环体 = 子工作流（方案 A，用户拍板「能复用就复用」）**：`params.body = {workflowName, inputs}`，逐轮注入 `{{vars.loopItem}}` / `{{vars.loopIndex}}`，子流程 `end` 输出收进 `loop.out.items[i]`；`onIterationError: stop|continue`；循环体不存在 → `WORKFLOW_NOT_FOUND`，某轮失败 → `LOOP_BODY_FAILED`

---

## v0.1（历史）

> **关键决策**：R3（零依赖）落地 — 插件内置 Python 3.12 + 便携 bash（Windows x64），其他平台首次启动自动下载。

### 新增
- 12 个内置节点：`start` / `end` / `python` / `bash` / `subagent` / `http` / `set_var` / `if` / `switch` / `loop` / `log` / `manual`
- 客户端 UI：5 视图切换（画布 / 缩略图 / 表单 / JSON / AI 生成）
- React Flow 11 拖拽画布（v0.1 主要编辑方式）
- JSON 视图：Monaco Editor + ajv 实时校验
- AI 生成视图：调 DSH subagent（fallback /api/subagent + 本地模板）
- **运行时打包**：Python 3.12.12 (PBS 20260901) + MinGit busybox 2.55.0.5 + uv 0.4.18
- **按需下载脚本**：`scripts/download-runtime.mjs`
- **5 个 adapter 抽象层**：cli / storage / logger / subagent / runtime
- **API drift 探测**：`src/adapter/safety.ts` 自动检测 DSH 升版破坏

### 改造（相比 R3 决策前）
- `python` 节点 → 调 `resolvePython()` 找内置二进制，失败给 `PYTHON_UNAVAILABLE` 错误
- `bash` 节点 → 调 `resolveBash()` 找便携 bash（Windows 用 MinGit busybox）
- 移除 `interpreter` 字段（R3 不再回退系统 python3）
- `requirements` / `packages` 字段（v0.2 接 uv pip install）

### 文件
- 新增 `src/adapter/runtime.ts`
- 新增 `scripts/download-runtime.mjs`
- 新增 `src/client/{index,FlowPanel,Canvas,FormView,ThumbView,JsonView,AiGenView}.{tsx,ts}`
- 新增 `src/client/{styles.css, types.ts, util/flowDef.ts}`
- 新增 `scripts/build-client.mjs` + `tsconfig.client.json`
- 新增 `RUNTIME_SETUP.md`
- 改 `src/registry/builtin.ts`（python/bash 节点）
- 改 `src/ui/index.ts`（转发到 client）
- 改 `package.json`（dsh.client 块 + files + scripts）

### 体积
- npm 包：~60MB（Windows x64 全内置）
- 首装磁盘：~120MB（含其他 platform 按需下载）

### 测试
- 离线契约测试 29 + 23 = 52 项通过（`npm run test:offline`）
- 真实 e2e 需在用户 DSH 上验（沙箱禁 npm/child_process）
