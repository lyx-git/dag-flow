# dag-flow × dsh 升版回归清单

> 触发条件：dsh 版本升级 / 宿主 Node 或 React 大版本变化 / 重装 DSH 后。
> 用法：按层从上到下执行；每项标注【依赖点位置】【验证方法】【失守表现】。
> 设计基线：所有宿主依赖已单点适配 + fail-soft——失守的典型表现是"某功能静默降级"，不是插件崩溃。

## A. 一键基线（先跑这个，全绿再往下）

```bash
npm run build && npm run lint && npm run test:offline   # 全绿口径：编号 262 / 0 失败（含新增宿主接入层回归 apply-host 44 断言，排在首位）
node scripts/run-example.mjs examples/daily-briefing.json --probes   # E2E：搜索真调+LLM 真调+分支+落盘+校验探针
```

## B. 宿主 API 契约层（dsh 改 ctx API 形状时，只改对应单点）

| 依赖点 | 单点位置 | 验证方法 | 失守表现 |
|---|---|---|---|
| **服务获取方式**：inject 必须声明服务名（`index.ts` → `export const inject = ['webServer', 'tools']`）+ 一律走 hostService()，禁止裸 `ctx.X`（0.2.0 起 fiber.store 只快照 inject 名单——inject 为空时 `ctx.get(name)` 也拿 undefined，裸取另抛 `cannot get property "X" without inject`；且 0.1.7 起 apply 在未声明依赖就绪前就会运行） | `index.ts` inject 声明（唯一 lever）+ `safety.ts` hostService()（strict get → 非严格 get → 属性访问三层容错） | `test/apply-host.test.mjs` 首两项断言 inject 必含 webServer+tools；场景[1]：0.2.0 同款 Proxy ctx 跑 apply，必须得到 12 条路由 + workflow 工具注册 | 所有宿主能力被误判为漂移 → 全插件静默降级成"只有客户端 UI"（表现：面板 API 全 404、日志里没有 `api registered`；真机 2026-10-01 13:06:34 日志即此形态） |
| `ctx.webServer.register`（kind/path/handler 形状） | `api.ts` route() 适配函数（唯一一处 register.call） | 启动日志 `api registered` + harness 里 GET /api/dag-flow/nodes 返回 200 | 面板 API 全 404（插件不崩）；**判别特征**：响应体是英文 `not found`，该字符串只由 dsh-client-connection 的共享 `/api` 处理器发出 ⇒ 请求落到了 `/api` 前缀兜底，即 dag-flow 一条路由都没注册（dag-flow 自身从不输出 `not found`，也不输出 401） |
| `ctx.tools.register`（defineTool 形状） | `cli.ts` attachToHost | 启动日志 `workflow tool registered` | /workflow 工具消失 |
| `ctx.logger` | `logger.ts` | 日志出现且双写 .dag-flow/logs/ | 降级 console+文件，无感 |
| workspace 探测（7 候选字段） | `storage.ts` probeHostWorkspace | /workflows 返回的 storage.dir 指向工作区 | 存储降级到 cwd 或 ~/.dsh/workflows |
| `ctx.tools.execute` web_search 信封（callId/name/arguments + 四形态返回） | `search.ts` tryHostSearch | provider=host 真机调用；auto 时看 results.engine 是否 host:web_search | 静默回落内置 5 引擎链 |

## C. 文件直读层（dsh 改配置/存储布局时，只改对应单点）

| 依赖点 | 单点位置 | 验证方法 | 失守表现 |
|---|---|---|---|
| `settings.yaml` + `.credentials.yaml` schema | `subagent.ts` buildLlmCandidates（schema 常量集中在其上） | test/llm-config.test.mjs 20 断言 + /models 列表非空；结构漂移时 console.warn 告警 | AI 节点报"没有配置可用的 LLM 端点"（可临时用 DAG_FLOW_LLM_BASEURL/KEY/MODEL 环境变量逃生舱） |
| 会话存储布局 | `sessions.ts`（文件名候选 session.v3/legacy + 目录转义两版 + 全盘扫描） | test/sessions.test.mjs 6 断言 + 真机选会话读取 | 会话输入节点返回空 |
| runtime 缓存目录 | `runtime.ts` + `scripts/download-runtime.mjs`（DSH_HOME 副本） | test/runtime.test.mjs + 首跑 python 节点 | 降级 bundled→system |
| 旧 workflows.db 迁移 | `storage.ts` migrateLegacySqlite | node:sqlite 不可用时静默跳过 | 仅影响旧库迁移 |

## D. client 契约层（dsh web 端变化时）

| 依赖点 | 单点位置 | 验证方法 | 失守表现 |
|---|---|---|---|
| `window.__ModuleLoader__` 协议（CJS + apply/inject） | `scripts/build-client.mjs` banner/footer | 真机 GUI 侧栏出现工作流入口 | 客户端整体不加载（host 侧不受影响） |
| `slots` 服务（settings.section 注入） | `client/index.tsx`（逐项 try/catch） | 设置页出现「画布主题」分区 | 设置页分区消失 |
| 侧栏 DOM 选择器（data-pane=sidebar / newSession / logoRow） | `client/sidebar.ts`（双候选+自愈） | 真机侧栏出现入口按钮 | 入口按钮不出现（可用 /workflow 工具替代） |
| **宿主 React 版本注入** | external react（勿改自打包，防 dual-React） | dsh web 升 React 19 时：面板渲染/FlowGram 拖拽/主题切换逐项点一遍 | 白屏或交互失效；处理：回归 styled-components@6 与 @flowgram.ai/* 的 peer 兼容（历史上需 `--legacy-peer-deps`，styled-components 必须显式安装，arborist isDescendantOf bug 需全删 node_modules 重装） |
| Node ≥22.13（zstd/sqlite） | engines + sessions.ts/sqlite 动态 import | 会话读取/旧库迁移可用 | 该两功能静默降级 |

## E. 远期触发点（dsh 侧出现以下能力时重构，当前不动作）

1. **dsh 提供公开 ctx LLM API**（现状：dsh-llm 是 TypertRemoteService 远程面，插件不可调）→ 删除 `subagent.ts` 的 settings.yaml 直读 + env 逃生舱退役，改走宿主；hostChat 探测已预埋在 callSubagent/callSubagentStream 入口。
2. **dsh 提供会话查询 API**（现状：无服务可用）→ `sessions.ts` 文件直读改走宿主 API。
3. **cordis patch schema 变化** → `cordis.patch.yml`（3 行）+ `package.json` dsh 字段同步；install-check.mjs 会拦。

## F. 版本记录

- 本清单基线：dsh 0.1.2-rc.1 / 2026-09-27（依赖降耦两轮 + 综合示例实测后，测试编号 192/全量 247 全绿）。
- **0.2.0-rc.2 适配（2026-10-01）**：A 层基线全绿后真机实测出 3 个断点并已修复+锁测试（测试编号 206/全量 277）：①settings.yaml 被 0.2.0 移除、配置迁入 `profiles/<p>/cordis.patch.yml` 顶层数组条目（llm-pi-ai 等）→ subagent.ts 发现链加 patch 源（settings.yaml 键级优先）+ yaml-lite 支持顶层数组，实测端点 0→15；②会话文件新增 `session.v4.jsonl.zstd` → 候选表三代兼容，实测 listSessions 6→7；③会话 zstd 文件为**多帧追加式**（2MB/640 帧实测）且行形状是**事件流** `{type:'user/message'|'assistant/message', data:{content:[{type:'text',text}]}}` 非直陈 {role,content} → 逐帧解压拼接（帧间补 \n）+ 事件行解析，实测 2MB/7MB 会话读出真实历史。边界：活跃会话消息未 flush 前 v4 文件只有元数据帧（读空属 dsh 写入策略非 bug）。
- **0.2.0-rc.2 续修（2026-10-01）——真机「新建工作流」404**：现象为面板弹窗输入 `test-folw` 后报 `创建失败: 请求失败（HTTP 404）:not found`。定位链：响应体 `not found` 只出自 dsh 共享 `/api` 兜底处理器（实测 `/api/dag-flow/*` 探针返回 401 `unauthorized`，说明 `admit()` 已执行、`/api` 前缀赢下了匹配）⇒ dag-flow 未注册任何路由 ⇒ 客户端 `workflow-picker.ts` 无责，根因在宿主侧入口。真因：cordis 0.2.0 `ReflectService.handler.get` 对未在 `inject` 声明的服务直接抛 `cannot get property "X" without inject`，而 dag-flow `inject: []`，导致 `detectApiDrift` 把 `tools.register`/`webServer.register` 判为漂移、safeMode 打开、`registerApiRoutes()` 提前 return（且裸 `ctx.webServer.register` 还在 try/catch 之外）。修复：`safety.ts` 新增 `hostService()` 统一走官方 `ctx.get(name)`（注释原文 "Read a service from the store without the inject requirement"，是 0.2.0 官方的 inject 绕过口），`api/cli/logger/storage/search/subagent` 全部改走它；两处 safeMode 总闸改为按能力 `disabledApis()` 判定（safeMode 降为纯信息量）；`index.ts` 把 12 条路由与 workflow 工具的 dispose 经 `ctx.effect` 绑定，修掉 `patchReload: live` 下重载残留路由导致 `webserver: duplicate ... route` 的隐性缺陷；同时 `createLogger()` 全量接管日志（此前优先 `ctx?.logger`，使文件双写从不执行）。锁定：新增 `test/apply-host.test.mjs`（44 断言，含 0.2.0 Proxy ctx 复现、live reload 二次 apply、缺 webServer/缺 tools/空 ctx 的 fail-soft、真实 node:http 挂载后回放 UI 的 `POST /workflows/save` 全链路），已接入 `npm run test:offline` 首位；全套 **编号 250 / 0 失败**。真机复验（重启 `dsh web` 后）待用户执行。
- **0.2.0-rc.2 三修（2026-10-01 下午）——真机日志推翻续修结论后的真修**：重启后 dag-flow-2026-10-01.log 13:06:34 仍报 `api skipped (webServer.register 不可用), safe mode active (drifted: tools.register, webServer.register, …)` ⇒ 续修的「hostService()→ctx.get」路线被证伪——cordis 4.x 的 fiber.store 只快照 inject 名单，`ctx.get` 读的也是这份快照，inject 为空时永远拿 undefined；reflect.ts 的 "Read a service from the store without the inject requirement" 只指绕过 strict/ACTIVE 门禁，绕不开快照本身。真修三件套：① `index.ts` 声明 `inject = ['webServer', 'tools']`（apply 等服务就绪才跑；只收有可用插件先例的服务名——webServer=dsh-auto-compact/dsh-versions、tools=dsh-vision-router；本版 cordis 无 optional inject，声明不存在的名字会让插件永不 apply）；② `safety.ts` hostService() 三层容错（strict get → 非严格 get `ctx.get(name,false)` → 属性访问）；③ 客户端「点创建没反应」独立 bug——`workflow-picker.ts` 主按钮初始 `disabled` 且从不随输入更新，新增 syncFoot()（空输入=禁用、精确匹配=「打开」、其余=「创建」，列表拉取失败不影响创建）。锁定：apply-host 首两项断言由「inject 保持为空」（错误结论）反转为「inject 必含 webServer+tools」。A 层基线复跑全绿：编号 250 / 0 失败 + E2E（真调 bing 6 条、python/bash 真实 spawn、10 探针全对；img_log 在 run_media=0 下引用 skipped 节点报 DATAFLOW_REF 属示例既有数据流语义，非回归）。真机复验（重启 `dsh web` 后）待用户执行：侧栏入口 → picker 应列出工作流且无 404；输入新名称 → 主按钮变「创建」可点；日志应现 `api registered` 且不再有 safe mode active。侧栏入口按钮已按宿主权威样式对齐（复刻断言 7/7），用户真机确认完美。
- **工作流中文名（2026-10-01 傍晚）**：新建/重命名/导入/AI 生成均支持中文命名。规则唯一源 `src/name-rule.ts`（首字符须字母/数字 Unicode 含中文，其余字母/数字/下划线/连字符，≤64；规范化=trim→ASCII 小写→非法字符与空白折叠'-'→去首尾'-'），五处旧内联 kebab 正则全部收敛引用：picker、FlowPanel 导入(L368)/重命名(L437)、api.ts save 规范化（AI_SYSTEM_PROMPT 的 name schema 说明同步允许中文）、storage.ts safeName（防穿越闸门不变，`../` 等仍拒）+ 旧库迁移过滤。锁定：offline E1b、storage-json [7]、api-e2e 中文保存/读取/列表 +3 断言；全套 **编号 255 / 0 失败**。旧 kebab 名完全兼容（是其子集）。
- **存储锚定工作区 + 弹窗偏大不遮挡（2026-10-01 晚）**：用户实测创建的工作流"不知道放哪去了"——落在了 `~/.dsh/workflows`（user-dir-fallback 兜底，host 的 cwd 非工作区）。修复：inject 增声明宿主 `workspaceRegistry` 服务（dsh-workspace，经 cordis_inspect 查证 `Workspace={id,path,title,updatedAt,sessionIds}`），storage 探测链插入 workspace-registry 步（`list()` → 过滤磁盘存在的 path → **取 updatedAt 最新 = 最近使用的当前工作区**）→ 落 `<当前工作区>/.dag-flow/workflow/`；旧兜底目录 `~/.dsh/workflows` 的既有文件**一次性复制迁入**新根（fail-soft、只补缺、含 versions/ 子树）。inject 断言更新为三服务（webServer+tools+workspaceRegistry）。picker：宽 560→**680**（偏大）；下拉列表由 absolute 覆盖式改**文档流内**（max-height 170px=行高 34px×5 行），展开时把 footer 推下去不再遮盖按钮；列表数据晚到补刷（fetch .then 补 renderList）；列表拉取失败时创建前先 GET 探测、已存在直接打开（防最小模板覆盖同名工作流）。锁定：新增 test/storage-workspace.test.mjs（7 断言：单一工作区锚定/多工作区取最新/无 registry 回退/候选不存在回退/落盘位置），全套 **编号 262 / 0 失败**。真机复验待用户：重启 dsh web → picker 应列出旧工作流（自动迁来）→ 管理视图核对 storage.dir=`<当前工作区>/.dag-flow/workflow`。
- 依赖全景权威记录：记忆 fact 0mui2s5ux（依赖全景）/ topic 0muidt80（降耦始末）；代码侧单点索引见项目记忆 structure 条目。
