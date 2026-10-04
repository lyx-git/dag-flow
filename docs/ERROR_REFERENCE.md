# dag-flow 错误码与提示信息对照表

> 约定：**错误码（code）为英文大写**（机器标识，前端逻辑与测试断言依赖），**提示消息（message）一律中文**。
> 更新提示文案时同步本表。最后更新：2026-10-03（新增 `MANUAL_CANCELLED` 与 run/status、run/resume 的 202/404/409）。

## 一、参数与结构校验（执行前）

| 错误码 | 触发条件 | 中文提示（示例） |
|---|---|---|
| `NODE_PARAMS_INVALID` | 任一节点缺必填参数（运行前集中预检） | 节点 h(http): url 为空——填写请求地址；…（逐节点聚合） |
| `WorkflowParseError`（无 code） | JSON 结构不符 schema | 工作流结构校验未通过: /nodes 缺少必填字段 "name" |
| 同上 | 节点 id 重复 | 节点 id 重复: xxx |
| 同上 | start/end 数量不对 | start 节点必须恰好 1 个（当前 2 个）／缺少 end 节点（至少需要 1 个） |
| 同上 | next 引用不存在 | 节点 "a" 引用了不存在的 id "b" |

### 必填参数预检范围（params-check.ts）

python/bash（code 纯空白）、http（url）、if（condition）、switch（value + cases 非空）、log（message）、manual（prompt）、set_var（vars 非空对象）、subflow（workflowName）、file_save（filename）。

**不在预检范围**（有专属错误码，见下表）：subagent、web_search、web_fetch、image_generate、video_generate、session_input、merge、loop。

## 二、数据流校验

| 错误码 | 触发条件 | 中文提示 |
|---|---|---|
| `DATAFLOW_REF` | 模板引用解析失败 | 节点 "b" 引用了 "a"：该节点尚未执行或不存在／状态为 failed 没有可用输出／路径 "out.list.0" 的 "x" 处需要数字数组下标／下标 3 超出数组范围（长度 2）／路径不可达 |
| `DATAFLOW_SELF_REF` | 节点引用自己（DAG 预检） | 节点 "a" 引用了自己（{{a.out}}） |
| `DATAFLOW_UNKNOWN` | 引用不存在的节点 | 节点 "a" 引用了不存在的节点 "b" |
| `DATAFLOW_ORDER` | 引用拓扑序在后的节点 | 节点 "a" 引用了排在它之后才执行的 "b"（数据流倒挂） |

## 三、执行器

| 错误码 | 触发条件 | 中文提示 |
|---|---|---|
| `UNKNOWN_NODE_TYPE` | 节点类型未注册 | 节点类型 "csv_parse" 未注册（提供该节点的插件是否已安装？） |
| `RUN_CANCELLED` | 用户取消 | 运行已由用户取消／搜索期间运行被取消／抓取期间运行被取消／视频轮询期间运行被取消 |
| `MANUAL_CANCELLED` | manual（人工确认）节点挂起期间用户点了「✕ 取消本次运行」 | 人工确认未完成：运行已由用户取消／人工确认未完成：用户取消了等待中的人工确认 |
| `BUDGET_EXCEEDED` | 执行数超预算 | 节点执行数超出预算（100000）——检查是否存在失控循环 |
| `DAG_CYCLE` | 工作流成环 | 工作流存在环路: a → b → a |

★ 2026-10-04 轮 4（合并执行模型）**退役两个错误码**：`PARALLEL_FAILED`（并行分支失败）与「连线断裂：a → b」
（连线指向不存在节点／没有匹配的分支）——两者都只存在于已删除的 legacy next 递归执行器里。
现在：①并行分支失败由 `firstError.nodeId` 指向**那个具体失败节点**；②连线指向不存在的节点在
结构校验阶段就被拒（`WorkflowParseError`，见「节点引用了不存在的 id」），轮不到执行期；
③switch/if 没有匹配分支时按"未激活的边 → 目标 skipped"处理，不再抛错。

## 四、节点错误码（builtin）

| 节点 | 错误码 | 中文提示 |
|---|---|---|
| python | `PYTHON_NO_CODE` | code/codePath 为空——填写要执行的 Python 代码 |
| python | `PYTHON_UNAVAILABLE` | Python 运行时未找到（含安装指引） |
| python | `PYTHON_TIMEOUT` / `PYTHON_SPAWN` / `PYTHON_EXIT` | 执行超时／启动失败／退出码非 0（附输出） |
| bash | `BASH_NO_CODE` | code/codePath 为空——填写要执行的 Bash 脚本 |
| bash | `BASH_DESTRUCTIVE` | 检测到高危命令——如确认要执行，请设置 dangerouslyAllowDestructive: true |
| bash | `BASH_UNAVAILABLE` / `BASH_TIMEOUT` / `BASH_SPAWN` / `BASH_EXIT` | 同 python 系列 |
| subagent | `MODEL_REQUIRED` | 未选择执行模型——在节点配置的「选择模型」中选择 dsh 已配置的模型后重试 |
| subagent | `SUBAGENT_EMPTY_PROMPT` | prompt 为空——AI 节点未执行，流程已在此中断 |
| subagent | `SUBAGENT_EMPTY_OUTPUT` | AI 节点返回空内容（模型没有输出）——不再按成功处理，请换可用模型或检查上游数据 |
| subagent | `SUBAGENT_UNAVAILABLE` | AI 节点超时（Xms）／AI 节点调用失败: …／dsh settings.yaml 中没有配置可用的 LLM 端点 |
| subagent | `MODEL_MODALITY_MISMATCH` | 所选模型 &lt;显示名，缺失时回退 providerName/model&gt; 不支持图片输入（能力: text）——prompt 中引用了图片文件。请换支持对应模态的模型（如 kimi-k3），或在 dsh settings.yaml 标注 input: [text, image] |
| session_input | `SESSION_INPUT_NO_ID` / `SESSION_INPUT_NOT_FOUND` / `SESSION_INPUT_READ` | sessionId 为空／会话不存在: xxx／读取失败 |
| http | `HTTP_TIMEOUT` / `HTTP_ERROR` | 超时（Xms）／请求失败（附原因） |
| web_search | `SEARCH_EMPTY_QUERY` | query 为空——搜索节点未执行，流程已在此中断 |
| web_search | `SEARCH_FAILED` | 所有搜索引擎均失败：bing: …；或 宿主 web_search 工具不可用（未安装 dsh-free-search 插件或调用失败） |
| web_fetch | `FETCH_NO_URL` / `FETCH_TIMEOUT` / `FETCH_FAILED` | url 为空——…／网页抓取超时（Xms）／HTTP 404（…）等原始原因 |
| if / switch | （表达式错误经 ExprError） | 表达式解析失败／表达式求值失败：… |
| loop | `LOOP_NO_BOUND` / `LOOP_MAX_ITER` / `LOOP_BODY_FAILED` | 缺少循环边界——count / while / over 至少配置一个／达到 maxIterations=1000 上限／第 N/M 轮循环体（子工作流）以 failed 结束（已完成轮次保留在 out.items；要跳过失败轮设 onIterationError: "continue"） |
| merge | `MERGE_NO_UPSTREAM` | merge 需要至少 2 条上游连线（当前 0 条）——把多个分支的输出连入 merge 节点 |
| subflow | `SUBFLOW_DEPTH` / `WORKFLOW_NOT_FOUND` / `SUBFLOW_FAILED` | 嵌套超过 5 层／工作流不存在: xxx（先在面板保存）／子工作流以 failed 结束 |
| image_generate | `IMAGE_NO_PROMPT` / `IMAGE_NO_BASEURL` / `IMAGE_NO_KEY` / `IMAGE_API_ERROR` / `IMAGE_EMPTY` / `IMAGE_SAVE_FAILED` / `IMAGE_TIMEOUT` | prompt 为空／baseURL 为空／缺少 API Key／HTTP 错误（附响应）／API 未返回图片／图片无法落盘／超时 |
| video_generate | `VIDEO_NO_SUBMIT` / `VIDEO_NO_POLL` / `VIDEO_SUBMIT_ERROR` / `VIDEO_NO_TASK` / `VIDEO_NOT_READY` / `VIDEO_ERROR` | submitUrl 为空／pollUrl 为空／HTTP 错误／未找到任务 ID／轮询超时（附最后状态）／其他错误 |
| file_save | `FILE_NO_URL` / `FILE_NO_CONTENT` / `FILE_SAVE_ERROR` | url 为空／content 为空／保存失败（检查文件名非法字符） |

## 五、HTTP API（/api/dag-flow/*）

| 状态 | 触发 | 中文提示 |
|---|---|---|
| 400 | ai-generate 无 prompt | 缺少 prompt |
| 400/流式 | AI 输出结构不合法 | AI 输出结构不合法：需要 name(string) + nodes(array>=2) |
| 400/流式 | 生成结果缺必填参数 | 生成的节点缺少必填参数（请修正后重试）：节点 x(type): … |
| 400 | run 无 def | 缺少 def（工作流定义） |
| 202 | run 撞上 manual 节点（挂起等人工确认） | 响应 `{ ok:true, status:'awaiting', runId, awaiting:{ nodeId, prompt } }`（不是错误，是「等你确认」） |
| 409 | 同名工作流运行中 | 工作流「x」正在运行中——等它结束，或点运行按钮旁的取消 |
| 404 | run/status 未知 runId | 查无此运行——可能已结束，或 dsh 重启导致暂停中的运行丢失 |
| 404 | run/resume 未知 runId | 查无此运行——dsh 重启会丢失暂停中的运行，请重新运行工作流 |
| 409 | run/resume 状态不符 | 该运行已结束／该运行当前不在等待人工确认 |
| 400 | run-node 缺 nodeType | 缺少 nodeType（且不能是 start/end）／unknown node type（未知节点类型） |
| 400 | 保存缺 name/def | 缺少 name 或 def |
| 404 | 读取不存在的工作流 | 工作流不存在: xxx |
| 404 | 版本不存在 | 版本不存在: xxx@ts |
| 404 | 取消无运行实例 | 工作流「x」没有正在运行的实例 |
| 400/404 | 会话路由 | 缺少会话 id／会话不存在 |
| 200 | test-image-api | ok:true（已生成 1 张测试图）／ok:false + 401→Key 无效、404→路径或模型不存在、400→参数不支持（均附 detail） |

## 六、适配层内部错误（经节点错误透出）

- **fetch 底层错误人性化**（fetch-errors.ts，http/image/video/web_fetch/subagent 全部接入）：`fetch failed`/`ENOTFOUND`/`ECONNREFUSED` 等 → 「网络连接失败（无法访问目标地址——检查 URL 是否正确、网络/代理/防火墙是否放行、目标服务是否在线）」；`Failed to parse URL` → 「URL 格式不合法」；未命中模式 → 「请求异常: 原文」。**新增网络类错误提示必须经 humanizeFetchError**，禁止直接透出 e.message。
- assets：`文件名非法（路径越界）`／`下载失败（HTTP X）`／`下载超时（Xms）`
- sessions：`无法读取会话文件`／`需要 Node >= 22.13 才支持 zstd 解压`／`zstd 解压失败`
- storage：`工作流名称不合法（需小写字母开头…）`
- search 引擎层：`连接失败`／`HTTP X（url）`／`空响应（N 字节）`／`DuckDuckGo 触发反爬验证`／`所有 SearXNG 实例均失败`／`AnySearch 请求失败`／`AnySearch API 错误`
- expr：`表达式解析失败`／`表达式求值失败`／`作用域 X 中的函数引用不被允许`
- external：`注册节点失败：缺少 def.type`／`def.run 必须是函数`／节点重复注册警告
- subagent 双协议探测：`chat/completions 接口返回 X: …`／`responses 接口返回 X（路径 …）`／`… 请求异常`（均接 humanizeFetchError）
