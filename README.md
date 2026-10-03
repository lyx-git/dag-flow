# dag-flow

> DSH 通用工作流搭建器 — **装上插件就能搭工作流**，DSH 怎么升版都不崩。

## 卖点
- **Python / Bash / AI 子代理**作为一等公民节点（Windows 内置运行时，开箱即用）
- **FlowGram 可视化画布**（字节开源引擎，Coze Studio 同款）：拖拽连线、minimap、对齐吸附、运行状态徽标回放、问题面板实时校验
- **20 个内置节点**：控制流（if/switch/merge/loop/subflow）+ 脚本（Python/Bash）+ AI（子代理/会话输入）+ IO（HTTP/网页搜索/网页抓取）+ 多模态（图片生成/视频生成/文件保存）
- **架构级版本韧性**：5 个 adapter + drift 控测 + safe-mode 降级
- **工作区 JSON 存储**：工作流存 `<工作区>/.dag-flow-workflows/`，可读可携带可进 git，自带 20 份历史版本快照
- **统一落盘布局**：全部运行数据收拢 `<工作区>/.dag-flow/`——工作流定义 `workflow/`、运行记录 `runs/`、临时文件 `tmp/`、按天日志 `logs/`；最终产出（图片/视频/文件）直接放 `.dag-flow/` 根下（不建专门子目录）；目录不存在自动创建，旧 `.dag-flow-workflows/` 不迁移不删除
- **零配置搜索节点**：内置 5 个免 key 引擎（Bing/DDG/SearXNG/AnySearch）+ 宿主优先自动回落
- **模型/密钥统一来自 dsh**：插件不存储任何模型或密钥，AI 节点模型必选（自动发现 dsh 已配置模型）

## 内置节点（20 个）

| Type | 用途 | 关键参数 |
|---|---|---|
| `start` | 工作流入口（恰好 1 个） | `params` 即输出 |
| `end` | 工作流出口（≥1 个） | `outputs?` |
| `python` | 跑 Python 3.12 脚本 | `code\|codePath`, `timeoutMs?`, `cwd?` |
| `bash` | 跑 bash 脚本 | `code\|codePath`, `timeoutMs?`, `dangerouslyAllowDestructive?` |
| `subagent` | 调 DSH 子代理（**模型必选**） | `prompt`, `model`（必填）, `timeoutMs?` |
| `session_input` | 读取会话上下文 | `sessionId`, `limit?` |
| `http` | HTTP 请求 | `method?`, `url`, `headers?`, `body?` |
| `web_search` | 网页搜索（5 免 key 引擎 + 宿主优先） | `query`, `provider?=auto`, `count?`, `timeRange?` |
| `web_fetch` | 网页抓取（剥 HTML/解析 JSON） | `url`, `maxChars?`, `raw?` |
| `set_var` | 写变量到 ctx | `vars` |
| `if` | 条件分支（true/false 双端口） | `condition` |
| `switch` | 多分支（case 端口动态生成） | `value`, `cases` |
| `merge` | 并行分支合流（≥2 上游） | `keys?` |
| `loop` | 循环/迭代 | `count?` / `while?` / `over?` |
| `subflow` | 调用已保存的子工作流 | `workflowName`, `inputs?` |
| `log` | 写日志 | `level?`, `message` |
| `manual` | 等待用户输入 | `prompt`, `schema?` |
| `image_generate` | 图片生成（OpenAI images 兼容） | `prompt`, `baseURL`, `apiKey/apiKeyEnv` |
| `video_generate` | 视频生成（异步任务轮询） | `submitUrl`, `pollUrl`, `maxWaitMs?` |
| `file_save` | 内容/URL 落盘到工作区 | `source?`, `content/url`, `filename` |

数据引用语法：`{{nodeId.out}}` / `{{nodeId.out.field}}` / `{{nodeId.out.list.0}}`（支持数组下标）/ `{{vars.x}}` / `{{inputs.x}}`。

## 安装

```bash
# 1. 装依赖 + 编译
npm install
npm run build

# 2. 下载运行时（Windows 已内置，可跳过）
npm run fetch:runtime

# 3. 安装到 DSH
dsh plugin add <dag-flow 目录>

# 4. 重启 DSH
```

## UI 6 视图

- **🎨 画布**（默认，FlowGram 拖拽 + minimap + 问题面板 + 状态栏）
- **🖼 缩略图**（BFS 分层布局）
- **📝 表单**（左节点列表 + 中参数 + 右运行记录）
- **{ } JSON**（Monaco Editor + ajv 校验）
- **🤖 AI 生成**（调 DSH subagent，SSE 流式）
- **🗂 管理**（工作流列表：过滤/重命名/复制/删除 + 版本历史 + 导入导出）

## 自定义节点

```ts
import { registerNode } from 'dag-flow';

registerNode({
  type: 'my_op',
  schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
  run: async (ctx, params) => ({
    status: 'success', out: params.text.toUpperCase(),
    durationMs: 0, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
  }),
});
```

## 版本韧性

DSH 升版可能让内部 API 改名/缺失（`tools.register` / `llm.chat` / `webServer.register` / `fs.resolve` 等）。
本插件在 `apply(ctx)` 时自动 `detectApiDrift()`，drift 时进入 **safe mode**。

**修复 drift 只需改 5 个 adapter 文件**：
- `src/adapter/safety.ts`（CAPABILITY_PATHS + probe）
- `src/adapter/cli.ts`、`storage.ts`、`logger.ts`、`subagent.ts`

业务代码（registry/executor/builtin）**不需要改**。

## 平台运行时

| 平台 | Python | Bash | uv |
|---|---|---|---|
| Windows x64 | **内置** 3.12.14（解压后 ~60MB） | **内置** 2.55.0.5 MinGit（解压后 ~90MB） | **内置** 0.12.10（~40MB） |
| macOS arm64/x64 | 首次启动下载 | 系统自带 | 首次启动下载 |
| Linux x64/arm64/musl | 首次启动下载 | 系统自带 | 首次启动下载 |

Windows 运行时已内置于 `runtime/`（解压形态共 ~190MB，随 npm 包发布）；
macOS/Linux 首次运行 python 节点时自动下载到 `~/.dsh/runtime/<tool>/<version>/<platform>/<binary>`。

## 测试

```bash
npm run typecheck        # TypeScript 类型检查
npm run build            # esbuild 双包构建（host ESM + client CJS）
npm run test:offline     # 5 套离线测试：offline 30 + runtime 24 + storage-json 6 + api-e2e 46 + search 24
node test/node-matrix.test.mjs   # 20 节点逐个真实执行矩阵（27 断言）
node test/install-check.mjs      # 构建产物 + 插件清单自检（21 断言）
```

## 路线图

- **v0.2**（当前）：FlowGram 画布 + 20 节点 + 6 视图 + 工作区 JSON 存储 + 版本管理 + 搜索/多模态节点
- **v0.3**：定时调度（cron）、工作流市场
- **v0.4**：远程 worker 进程、画布内搜索

## License

MIT
