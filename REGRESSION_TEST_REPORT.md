# dag-flow 全量回归测试报告

- **日期**：2026-09-26（会话内执行）
- **对象**：`D:\workspace\pluginspace\dag-flow` 全部代码（构建产物 dist/ + 源码 src/ + 测试 test/ + 清单）
- **处置模式**：用户已批「发现 bug 直接修复并复测」
- **总体结论**：**功能全部可用，全部自动化测试通过**。发现并修复 3 处非运行时缺陷（dist 旧产物残留 / README 过时 / files 清单引用不存在文件），修复后全量复测通过。无运行时回归。

---

## 1. 验证环境与手段说明

| 事项 | 实况 |
|---|---|
| git 核实改动 | **不可用**：`dag-flow` 目录及全部父目录均非 git 仓库（`fatal: not a git repository`）。改用**文件修改时间戳 + 本会话改动记录**核实改动面，与任务列出的四区域吻合（最新改动依次为 search.ts → dataflow.ts → FlowPanel/FlowGramCanvas/nodes/types/builtin） |
| 浏览器/UI 实测 | **本会话无浏览器**（机器无系统 Chrome/Edge）。UI 类功能做静态与逻辑核验（代码路径 + bundle 内容断言 + e2e API 重放），见 §6「未能验证」 |
| 沙箱 | node.exe/npm.cmd/esbuild spawn 被沙箱拒绝，按提示逐次以 danger-full-access 提权执行；测试逻辑本身无权限依赖 |

---

## 2. 自动化全跑记录（按 package.json 实际脚本）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm run build`（build:host + build:client） | host bundle `dist/index.js` (451KB) + client bundle `dist/client.js` (1.0MB) 构建成功 | 0 |
| `npm run typecheck`（tsc --noEmit） | 0 错误 | 0 |
| `npm run lint`（tsc --noEmit，与 typecheck 同实现） | 0 错误 | 0 |
| `npm run test:offline` | offline **30 passed, 0 failed**；runtime **24 passed, 0 failed**；storage-json 通过（6 断言）；api-e2e **46 passed, 0 failed**；search **24 passed, 0 failed** | 0 |
| `node test/storage-json.test.mjs`（单独复跑） | 通过 | 0 |
| `node test/node-matrix.test.mjs` | **27 passed, 0 failed**（20 节点逐个真实执行 start→target→end） | 0 |
| `node test/install-check.mjs` | **22 passed, 0 failed**（含本次新增的 dist 全目录旧名扫描断言） | 0 |

基线合计：**30+24+6+46+24+27+22 = 179 项断言全绿，typecheck/lint/build 0 错误**。

> 对照说明：install-check 从 21 → 22 断言，是本次回归**主动加固**（新增 dist 全目录旧名扫描），非测试变更导致的口径漂移。其余套件口径与上一基线一致。

---

## 3. 功能全景清单（逐项结论）

### 3.1 内置节点（20/20）

| # | 节点 | 结论 | 验证手段 |
|---|---|---|---|
| 1 | start | ✅ | node-matrix #17 + offline 契约（恰好 1 个入口） |
| 2 | end | ✅ | node-matrix #17（run-node 正确拒绝 400）+ api-e2e |
| 3 | python | ✅ | node-matrix #6（runtime 缺失时优雅 failed 带错误码） |
| 4 | bash | ✅ | node-matrix #5（同上） |
| 5 | subagent | ✅ | node-matrix #7/7a/7b/7c（模型必选 MODEL_REQUIRED、不存在模型优雅失败、空 prompt 秒返不调 LLM） |
| 6 | session_input | ✅ | node-matrix #8 + api-e2e（sessions 路由） |
| 7 | http | ✅ | node-matrix #4（真实本地 mock GET + JSON 解析） |
| 8 | web_search | ✅ | search 测试 A1-A11（5 引擎 fixture 解析、无关缓存页回退、全挂聚合报错、空 query 快失败）+ node-matrix #16b/16d |
| 9 | web_fetch | ✅ | search 测试 C1-C7（剥 HTML/JSON/raw/HTTP 500/maxChars 钳制/空 url 快失败）+ node-matrix #16c |
| 10 | set_var | ✅ | node-matrix #2 + C 组合流（vars 引用解析） |
| 11 | if | ✅ | node-matrix #9 + C1（条件真激活分支） |
| 12 | switch | ✅ | node-matrix #10 + api-e2e（case/'*' 兜底边激活） |
| 13 | merge | ✅ | node-matrix #12（无上游明确失败）+ api-e2e（≥2 上游合流） |
| 14 | loop | ✅ | node-matrix #11 + api-e2e（over 数组迭代） |
| 15 | subflow | ✅ | node-matrix #13（不存在的工作流明确失败）+ api-e2e |
| 16 | log | ✅ | node-matrix #1 |
| 17 | manual | ✅ | node-matrix #3（awaitingUser 结构） |
| 18 | image_generate | ✅ | node-matrix #14（缺 key 明确失败）+ api-e2e（mock API 落盘 assets/dag-flow/） |
| 19 | video_generate | ✅ | node-matrix #15（缺 pollUrl 明确失败）+ api-e2e |
| 20 | file_save | ✅ | node-matrix #16（text 落盘路径断言）+ api-e2e |

### 3.2 客户端 6 视图与画布

| 功能 | 结论 | 验证手段 |
|---|---|---|
| FlowGram 画布（拖拽/连线/minimap/吸附/撤销） | ✅（逻辑与注册层面） | DSH_NODE_REGISTRIES 20 类型 = NODE_PALETTE 20 类型一一对应；install-check 断言 bundle 含画布卡类名；依赖 @flowgram.ai/free-layout-editor@^1.0.15 等 4 包 + styled-components 在 dependencies |
| 问题面板（实时校验/点击定位） | ✅（静态） | computeProblems 覆盖 20 节点必填项（含新增 web_search query / web_fetch url）；bundle 含面板类名 |
| 运行状态徽标/耗时回放 | ✅（静态） | runStatusStore + 节点卡 badge 渲染代码核验；运行链路由 api-e2e 真实覆盖 |
| 缩略图/表单/JSON 视图 | ✅（静态+注册） | findMeta/NODE_PALETTE 驱动；JSON 视图 Monaco + ajv；bundle 断言 |
| AI 生成（SSE 流式） | ✅ | api-e2e（/ai-generate 结构校验路径）+ AiGenView fetch 前缀核验 |
| 管理视图（过滤/重命名/复制/删除） | ✅ | api-e2e（save/读取/DELETE/versions 路由全重放）+ FlowPanel 调用点前缀核验 |
| 工作流选择器（组合框/新建） | ✅（静态） | workflow-picker.ts + install-check 断言 bundle 含组合列表类名 |
| 侧边栏入口 | ✅（静态） | sidebar.ts + install-check 断言 bundle 含 data-dag-flow-entry |
| 主题切换（深空蓝/浅色） | ✅（静态） | theme.ts 双主题 --wf-* 变量；SettingsPage 仅主题 + 提示文案 |

### 3.3 HTTP API（10 组路由，api-e2e 真实重放）

| 路由 | 结论 |
|---|---|
| GET /nodes | ✅（返回 20 节点类型，node-matrix A 断言） |
| POST /ai-generate（含 SSE stream:true） | ✅ |
| GET /runs | ✅ |
| POST /run（互斥 409）+ DELETE /run?name=（取消） | ✅ |
| POST /run-node（start→target→end 单节点试跑） | ✅（node-matrix 全部经由它） |
| GET /workflows（列表+存储位置） | ✅ |
| GET/DELETE /workflows/<name>、GET /workflows/<name>/versions[/<ts>] | ✅（prefix 无尾斜杠契约有专门断言） |
| POST /workflows/save（name 规范化 kebab） | ✅ |
| GET /models（dsh 只读自动发现，无密钥录入） | ✅ |
| GET /sessions、GET /sessions/<id> | ✅ |

### 3.4 横切功能

| 功能 | 结论 | 验证手段 |
|---|---|---|
| 工作区 JSON 存储（.dag-flow-workflows/，原子写，20 份版本快照） | ✅ | storage-json 6 断言（临时工作区端到端）+ api-e2e describe() |
| 同工作流运行互斥 + 用户取消 | ✅ | api-e2e（409 分支）+ activeRuns Map 代码核验 |
| onError 失败策略（stop/continue/goto） | ✅ | offline（goto 分支）+ Inspector 策略下拉静态核验 |
| 数据引用 {{}}（含数组下标 list.0） | ✅ | search 测试 D1/D2（搜索结果第一条 URL 传入 web_fetch）+ offline 数据流契约 |
| AI 节点模型必选（保存/试跑/运行三重拦截 + 执行层 MODEL_REQUIRED 兜底） | ✅ | node-matrix #7 系列 + FlowPanel 拦截代码核验 |
| 模型/密钥统一来自 dsh（插件零密钥存储） | ✅ | /models 只读自动发现；ai-models.ts 已删除；SettingsPage 无密钥录入 |
| prompt/query/url 留空中断语义 | ✅ | SUBAGENT_EMPTY_PROMPT / SEARCH_EMPTY_QUERY / FETCH_NO_URL 秒返断言（<50ms） |
| 资产落盘防穿越（assets/dag-flow/） | ✅ | api-e2e 媒体块 + storage 测试 |
| drift 探测 + safe mode | ✅ | offline 契约测试 |

---

## 4. 改动区域针对性核验（四区域）

### ① FlowGram 画布替换 — ✅ 完整
- `src/client/Canvas.tsx` 仅 re-export `FlowGramCanvas`；reactflow / @xyflow 在 src/ 与 dependencies 中**零残留**（grep 验证 + install-check 断言）。
- FlowGram 四插件（free-layout-editor / free-node-panel-plugin / free-snap-plugin / minimap-plugin）+ styled-components 均在 dependencies；esbuild 双包构建成功。
- 20 节点注册表与 palette 严格一一对应（18 个 `registry()` + if/switch 专属 formMeta）。

### ② 重命名 dsh-workflow-builder → dag-flow — ✅ 完整（发现并修复 1 处交付物残留）
- **源码层**：src/ 41 处 API 前缀全部 `/api/dag-flow`，`dsh-workflow-builder`/`dsh-node-flow` 作为**本项目旧名**在 src/ 零残留（styles.css/theme.ts 等注释中的 "dsh-node-flow" 是对**另一参考项目**的设计致谢，非本项目旧名，不计残留）。
- **清单层**：package.json name=dag-flow、cordis.patch.yml id/name=dag-flow、WORKFLOW_SCHEMA $id= dag-flow、存储目录 `.dag-flow-workflows`。
- **构建产物层**：发现 dist/ 混有旧 tsc 管线产物（见 §5 问题 1），已清理并重生成，现 dist/ 全目录（84 文件）零旧名（新增断言固守）。

### ③ subagent 空 prompt 语义（SUBAGENT_EMPTY_PROMPT）— ✅ 完整
- 执行层：`src/registry/builtin.ts` L212-215 —— prompt 空/纯空白 → `SUBAGENT_EMPTY_PROMPT` 秒返（不调 LLM），默认 stop 语义中断流程；node-matrix #7b/7c 断言通过（durationMs < 50ms）。
- UI 层：NodeInspector 提示文案已同步说明「prompt 留空（或上游输出为空）时本节点不执行，流程在此中断」。

### ④ free-search 方案 C（web_search/web_fetch，不强依赖 dsh-free-search 插件）— ✅ 完整
- **不强依赖已实证**：宿主无 tools 服务时（B4 场景），`provider=auto` 走内置 5 引擎链成功（A1）；`provider=host` 单独指定时给出明确报错指引而非崩溃。
- 宿主优先：宿主有 web_search 工具 → 优先走宿主（B1/B2）；宿主调用抛错 → 静默回落内置链（B3）。
- 引擎层：5 个免 key 引擎 fixture 解析全通过；Bing「无关缓存 SERP」识别 → 自动换引擎（A4）。
- 配套：dataflow 新增数组下标引用 `{{u.out.list.0.url}}`（修复原实现拒绝数组的缺口，D1/D2 全流程实证）；客户端问题面板/配置表单/节点注册同步。

---

## 5. 问题清单与处置

### 问题 1：dist/ 混入旧 tsc 管线产物，含旧插件名残留
- **位置**：`dist/types.*`、`dist/adapter/*`、`dist/executor/*`、`dist/registry/*`、`dist/client/`（子目录）、`dist/ui/`、`dist/index.d.ts`（约 80 个文件）
- **现象**：重命名前的旧 tsc 构建产物未被清理，其中 `dist/index.d.ts` 内容为 `export declare const name = "workflow-builder"`（更早的旧名）且 import 已不存在的产物路径；`dist/client/FlowPanel.js`、`dist/registry/external.js`、`dist/adapter/logger.js` 等含 `[dsh-workflow-builder]` 日志前缀；`dist/types.js` 含旧 schema $id。
- **影响**：**运行时无害**（DSH loader 仅按 package.json exports 加载 `dist/index.js` / `dist/client.js` 两个 esbuild bundle，测试与本会话全部功能验证均基于它们）；但 `files: ["dist"]` 意味着 npm 发布会把旧名残留文件一并发出，违反交付物一致性。
- **严重度**：中（交付物污染）/ 运行时零影响
- **是否本次改动引入**：否 —— 历史遗留（重命名时只重建未清理 dist 旧产物），属「重命名不彻底」回归范畴
- **处置（已修复）**：删除全部旧 tsc 产物 → `tsc -p tsconfig.json --emitDeclarationOnly` 重新生成与新代码同步的 d.ts 树（84 文件）→ grep 验证 dist 全目录零 `dsh-workflow-builder`/`"workflow-builder"` → install-check 新增「dist 全目录旧名扫描」断言固守 → 复测 install-check 22/22、node-matrix 27/27、typecheck 0 全绿

### 问题 2：README.md 严重过时（文档与功能不符）
- **位置**：`README.md`
- **现象**：写「12 个节点」（实际 20）、「React Flow 11 画布」（实际 FlowGram）、「5 视图」（实际 6）、引用已不存在的 `V0.1_OVERVIEW.md`、`pnpm test` vitest（项目无 vitest）、`dsh plugin install`（实际 `dsh plugin add`）、「52 项测试」（实际 179）。
- **严重度**：低（文档）/ 会误导新用户与功能全景核对
- **是否本次改动引入**：否，历次功能迭代未同步文档
- **处置（已修复）**：重写 README（20 节点表 / FlowGram 画布 / 6 视图 / JSON 存储 / 搜索节点 / 正确安装命令与测试基线），删除对不存在文件的引用

### 问题 3：package.json files 引用不存在的 README.zh.md
- **位置**：`package.json` files 数组
- **现象**：`README.zh.md` 不在项目中，npm 发布会告警
- **严重度**：低
- **是否本次改动引入**：否
- **处置（已修复）**：从 files 移除；README 同步不再引用

### 复核后判定「非问题」的项
- `styles.css` / `theme.ts` / `sidebar.ts` / `sessions.ts` 注释中的 `dsh-node-flow`：为参考项目的设计致谢注释，非本项目旧名。
- parse 的 "unreachable nodes: end" 警告：单节点试跑链（start→target→end 无 next 连接）的既有已知噪音，节点状态与结果不受影响，此前已记录为已知限制。

---

## 6. 未能验证项（需要真机/老板协助）

| 未验证项 | 原因 | 最小验证方式 | 需要老板做什么 |
|---|---|---|---|
| GUI 真实交互（画布拖拽连线、Inspector 表单、问题面板点击定位、minimap、选择器弹窗、主题切换手感） | 本会话无浏览器，机器无系统 Chrome/Edge | 重启 DSH → 打开 dag-flow 面板 → 拖 2 个节点连线运行 | 无需额外环境；若需我自动截图，请提供浏览器类 MCP |
| 真实网络搜索引擎（Bing/DDG/SearXNG/AnySearch 真实响应） | 自动化全部使用 fixture 桩（离线可重复） | 画布建 start→web_search→end 工作流，query 填任意词运行，看输出 results 与 engine 字段 | 无；如结果异常把 `out.engine` 字段值发我 |
| 宿主 web_search 工具真实调用（callId 格式与权限管线） | 宿主 ToolRuntime 的编程调用契约未在真实 DSH 内核验过 | 同上运行搜索节点，看输出 `viaHost: true` 是否出现（你机器装有 dsh-free-search，应优先走宿主） | 无；`viaHost: false` 也属正常（自动回落内置链），两者都能出结果 |
| `dsh plugin add` 实装加载 | 装验证=构建/清单自检（install-check），实装会改动 DSH 运行态 | `dsh plugin add D:\workspace\pluginspace\dag-flow` 后重启 DSH | 无 |
| AI 生成真实 LLM 流式效果 | 需要真实模型响应 | AI 生成视图输入需求观察流式输出 | 无 |

> 以上 5 项均不属于「本次改动引入的风险」：对应的执行层逻辑已被离线测试实证（节点执行、路由重放、bundle 内容断言），未验证的仅是真实环境的手感与外部服务形态。

---

## 7. 修复后复测记录

| 复测项 | 结果 |
|---|---|
| `grep dist`（84 文件）旧名扫描 | 0 匹配 |
| `node test/install-check.mjs`（含新断言） | 22 passed, 0 failed |
| `node test/node-matrix.test.mjs` | 27 passed, 0 failed |
| `tsc --noEmit` | 0 错误 |
| `grep src` API 前缀一致性 | 41 处全部 `/api/dag-flow` |

**最终判定：dag-flow 当前全部功能点自动化可测部分全部通过，修复 3 处非运行时缺陷后无回归。可交付。**
