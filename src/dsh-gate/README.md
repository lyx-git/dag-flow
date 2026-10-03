# dsh-gate — dag-flow 防腐层（Anti-Corruption Layer）

> **铁律：整个 dag-flow 只有本目录允许直接接触 DSH。**
> DSH 升版（服务改名/契约变更/目录迁移/配置 schema 变化/会话格式演进）时，
> **只修改本目录**；adapter / registry / executor / client 等业务代码不感知 DSH 版本。

## 为什么要有防腐层

dag-flow 是 DSH 的插件，天然依赖宿主的：服务注入（cordis inject）、HTTP 路由注册、
工具注册、LLM 服务、文件系统布局、配置 schema、会话存储格式、客户端挂载协议。
DSH 处于 0.x 快速迭代期，破坏性变更频繁。防腐层把这些「外部事实」收敛到一处，
让 dag-flow 的业务逻辑建立在自己定义的稳定词汇表上。

## 目录索引（每类 DSH 事实一个文件）

| 文件 | 收敛的 DSH 事实 | 上游变化时的改法 |
|---|---|---|
| `host.ts` | 服务访问（inject 名单、ctx.get 三层容错、DshHost） | 服务改名/访问语义变化 → 改 `HOST_INJECT` / `hostService` |
| `paths.ts` | 文件系统布局（`~/.dsh`、sessions、profiles、settings、credentials） | 目录迁移/改名 → 改对应函数 |
| `llm.ts` | 宿主 llm 服务形状（listProviders/listModels/stream/chunk） | llm API 变化 → 改 `HostLlmRuntime` |
| `registrar.ts` | webServer 路由 / tools 工具的注册契约（含 duplicate-route 热重载问题） | 注册 API 变化 → 改对应函数 |
| `llm-config.ts` | settings.yaml / cordis.patch.yml / .credentials.yaml 的 LLM schema | 配置结构变化 → 改本文件（锁定：test/llm-config.test.mjs） |
| `session-format.ts` | 会话文件格式（v3/v4 zstd 多帧、消息形状、session/title 事件、目录转义） | 会话格式演进 → 改本文件（锁定：test/sessions.test.mjs） |
| `index.ts` | 桶出口（外部浏览用；业务代码建议按模块 import） | — |

客户端侧防腐层：`src/client/dsh-gate.ts`（挂载协议、slots/layout 服务形状、
宿主侧栏 DOM 锚点）。构建期协议（ModuleLoader banner/footer、react external 清单）
在 `scripts/build-client.mjs`，属构建防腐点，同样只在那一处修改。

## 规约

1. **新增 DSH 触点必须先进本目录**：业务代码里出现 `hostService(...)`、`dshHome()`、
   `settings.yaml`、`session.v4` 等字样即违规（转发导出的兼容壳除外）。
2. **防腐层不写业务**：本目录只做「翻译」（DSH 形状 ↔ dag-flow 稳定形状），
   不含工作流语义；漂移探测/安全模式策略（drift/safe-mode）留在 `adapter/safety.ts`。
3. **fail-soft**：宿主能力缺失时折叠成 undefined/null/`{registered:false, reason}`，
   防腐层函数不允许因宿主升版抛错。
4. **测试契约优先**：`llm-config.test.mjs` 直接打包 `src/adapter/subagent.ts` 与
   `src/adapter/dsh-home.ts`（兼容壳保留文件路径与导出），并依赖
   「模块顶层固化路径、import 前设 DSH_HOME」语义——移动代码时必须保持。
5. **兼容壳**：`adapter/safety.ts`（转发 host 访问 + 保留 drift 策略）、
   `adapter/dsh-home.ts`（纯转发）。壳文件不得新增逻辑。
6. `yaml-lite.ts`（`src/adapter/`）是通用 YAML 解析器，**非 DSH 触点**，且被
   测试锁定路径，故留在 adapter/（防腐层可 import）。

## 变更流程（DSH 升版时）

1. 跑 `npm run test:offline` —— schema/格式锁定的测试先报警（llm-config / sessions /
   apply-host 的 inject 断言）。
2. 按报警定位到本目录对应文件，修适配。
3. 补/改对应锁定测试的 fixture（新 schema 形态进 A/B/C…组）。
4. 全量回归：`npm run test:offline` + `node tmp-test/cdp/run-all.mjs`。
