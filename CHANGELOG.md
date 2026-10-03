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
