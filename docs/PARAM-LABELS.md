# 参数中文名 / 释义总表（自动生成，勿手改）

> 参数弹窗里每行「中文名 + 问号释义」的唯一来源是 `src/client/param-meta.ts`。本表由 `node tmp-test/export-param-labels.mjs` 从中导出，用于逐条校对措辞。
> 要改词 → 改 `param-meta.ts` 后重跑本脚本；不要直接改这个文件。

## 图片生成 · `image_generate`（9 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `prompt` | 画面描述 | 想生成什么画面，支持 {{上游节点.out.字段}} 引用；必填。运行后图片直接落盘到 <DSH_HOME>/.dag-flow/ 目录，节点输出含相对路径。 |
| `baseURL` | API 地址 | OpenAI images/generations 兼容接口的根地址（必填）。填好后在底部点「▶ 试跑本节点」跑一遍，就知道地址 + Key + 模型这组配置通不通（真跑会生成 1 张图并落盘）。 |
| `model` | 模型 | 该 API 服务支持的图片模型名；配错时「▶ 试跑本节点」会直接失败并给出接口返回的原文。 |
| `size` | 尺寸 | 如 1024*1024；不同模型支持的尺寸不同。 |
| `n` | 张数 | 一次生成几张（1~4）。 |
| `apiKey` | API Key（明文） | 直接填 Key；留空则改用下面的「Key 环境变量名」。 |
| `apiKeyEnv` | Key 环境变量名 | 从环境变量读 Key 的变量名，例如 DASHSCOPE_API_KEY；和「API Key（明文）」二选一。 |
| `filenamePrefix` | 文件名前缀 | 落盘文件名的前缀，便于区分同工作流的多批产物。 |
| `timeoutMs` | 超时（毫秒） | 单次生成请求的超时时间。 |

## 视频生成 · `video_generate`（15 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `submitUrl` | 任务提交地址 | 异步视频任务的提交地址（必填，POST）。流程：提交 → 按「轮询间隔」查「任务查询地址」→ 等「取视频地址的字段」有值就算完成 → 视频下载到 <DSH_HOME>/.dag-flow/。 |
| `pollUrl` | 任务查询地址 | 轮询任务状态的地址（必填）。支持 {taskId} 占位符，会被替换成提交返回的任务 id。 |
| `submitMethod` | 提交方法 | 提交时用的 HTTP 方法，默认 POST。 |
| `submitHeaders` | 提交请求头 | JSON 对象：{"Authorization":"Bearer …"}。 |
| `submitBody` | 提交请求体 | JSON 对象，会原样作为提交请求体；其中可以写 {{上游.out.字段}} 引用。 |
| `taskIdPath` | 取任务 id 的字段路径 | 从提交响应里取任务 id 的路径，如 output.task_id。 |
| `pollHeaders` | 查询请求头 | JSON 对象，轮询时带上（通常和提交一致）。 |
| `pollIntervalMs` | 轮询间隔（毫秒） | 两次查询之间等多久，默认 5000。 |
| `maxWaitMs` | 最长等待（毫秒） | 超时后节点失败并给出最后一次任务状态，默认 600000（10 分钟）。 |
| `statusPath` | 取状态的字段路径 | 从查询响应里取任务状态的路径，如 output.task_status。 |
| `doneValue` | 完成状态值 | 状态等于这个值就认为任务完成，如 SUCCEEDED。 |
| `videoUrlPath` | 取视频地址的字段路径 | 从查询响应里取视频下载地址的路径，如 output.video_url。 |
| `filename` | 保存文件名 | 落盘用的文件名（可含子目录）。 |
| `apiKey` | API Key（明文） | 直接填 Key；留空则用下面的环境变量名。 |
| `apiKeyEnv` | Key 环境变量名 | 从环境变量读 Key 的变量名，例如 DASHSCOPE_API_KEY。 |

## 结束 · `end`（1 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `outputs` | 结束输出 | 结束节点的输出对象（写 JSON）。子工作流里它就是「本轮输出」——loop 的 items、subflow 的 out 都取自它；写 {"break": true} 可让循环在跑完这一轮后停下。 |

## 设置变量 · `set_var`（1 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `vars` | 写入的变量 | 要写入的全局变量（JSON 对象，键＝变量名）：下游用 {{vars.名称}} 引用；值里可以写 {{上游.out.字段}} 模板。 |

## 条件分支 · `if`（1 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `condition` | 条件表达式 | 布尔表达式，决定走 true 还是 false 分支：节点输出按「节点id.字段」拍平（如 web_search1.count > 0）。写错按 false 处理、不报错；and / or / not 可用。 |

## 多路分支 · `switch`（2 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `value` | 取值表达式 | 要匹配的表达式（如 prep_vars.mode）：它的值会去「分支表」里找同名的键。 |
| `cases` | 分支表 | JSON 对象：{"分支键":"目标节点id"}。键写 * 是兜底分支（其它键都没命中时走它）；没写 * 又没命中会告警 SWITCH_EDGE_NOT_IN_CASES。 |

## 循环 · `loop`（6 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `count` | 跑几次 | 固定跑多少轮（留空且不填「遍历数组」时，节点无边界、会被拦下）。 |
| `over` | 遍历数组 | 上游数组引用（整串），如 {{list1.out.items}}；填了它按数组长度跑（优先级高于「跑几次」）。 |
| `roundIf` | 每轮条件 | 可选门禁：为真才执行这一轮的循环体，为假跳过该轮（跳过数记在 out.skipped），不影响后面几轮。 |
| `maxIterations` | 最大迭代次数 | 上限：留空＝不限（只受引擎 10 万硬上限保护）；填了超过就截断，并在 out 里带 truncated / requested / processed。 |
| `body` | 循环体 | 每轮调用的子工作流：{"workflowName":"…","inputs":{…}}，inputs 里可用 {{vars.loopItem}} / {{vars.loopIndex}} / {{vars.lastOutput.字段}}。弹窗下方「🔁 循环设置」里可以选子工作流并配传参。 |
| `onIterationError` | 某轮失败怎么办 | stop＝这一轮失败就整节点失败；continue＝记下失败、继续跑后面几轮。 |

## 日志 · `log`（2 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `level` | 级别 | info / warn / error：只影响日志的图标与颜色，不影响流程走向。 |
| `message` | 日志内容 | 写进运行日志的文本，可用 {{上游.out.字段}} 展示上游数据。 |

## 手动确认 · `manual`（2 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `prompt` | 确认提示 | 挂起时给操作人看的问题，可用 {{上游.out.字段}} 把待确认的数据摆出来。 |
| `schema` | 确认表单 | 可选：JSON Schema，描述需要人工填写的字段（运行到这里会弹表单）。 |

## 合流 · `merge`（1 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `keys` | 输出键名 | 可选：按上游连线顺序给合流输出起键名（数组）。留空＝直接用上游节点 id 当键。 |

## 子工作流 · `subflow`（2 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `workflowName` | 子工作流名 | 要调用的工作流名称（必须是已保存的工作流）。能传什么由子工作流自己的「工作流参数」决定。 |
| `inputs` | 传给子工作流的参数 | JSON 对象：键＝子工作流声明的工作流参数名；值可写 {{上游.out.字段}}。 |

## 会话输入 · `session_input`（3 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `sessionId` | 会话 | 要读取的 dsh 会话 id（右侧面板有下拉可选）。 |
| `limit` | 读取条数 | 最多取最近多少条消息，默认 10。 |
| `workspace` | 工作区 | 会话所在工作区（多工作区时用来筛选）；留空＝当前工作区。 |

## HTTP · `http`（5 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `method` | 方法 | GET / POST / PUT / PATCH / DELETE。 |
| `url` | 请求地址 | 完整 URL，可引用上游数据（如 {{u.out.url}}）。 |
| `headers` | 请求头 | JSON 对象：{"Authorization":"Bearer …"}。 |
| `body` | 请求体 | JSON 对象或字符串，作为请求体发送（method=GET 时通常留空）。 |
| `timeoutMs` | 超时（毫秒） | 单次请求超时，默认 30000。 |

## 文件保存 · `file_save`（4 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `source` | 内容来源 | text＝保存一段文本；base64＝把 Base64 字符串解码成二进制；url＝先下载再保存。 |
| `content` | 文本内容 | source=text 时要保存的文本，可引用上游数据。 |
| `url` | 文件地址 | source=url 时要下载的地址。 |
| `filename` | 保存文件名 | 相对 <DSH_HOME>/.dag-flow/ 的文件名，可含子目录（如 reports/周报.md）。 |

## 网页搜索 · `web_search`（6 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `query` | 搜索关键词 | 要搜什么，可引用上游数据。 |
| `provider` | 搜索引擎 | auto＝按内置引擎链自动挑（Bing → AnySearch → DuckDuckGo → DuckDuckGo Lite → SearXNG，谁先出结果用谁；前两个在国内网络下最稳，2026-10-19 按真机实测重排）；也可指定具体引擎（下拉里每项带说明）。只走内置免 key 引擎，不依赖任何外部搜索插件。 |
| `count` | 结果条数 | 取多少条（1~20），默认 8。 |
| `lang` | 语言/地区 | 如 zh-cn；部分引擎支持，留空用引擎默认。 |
| `timeRange` | 时间范围 | day / week / month / year：只看该时间段内的结果。 |
| `searxngInstances` | SearXNG 实例 | 可选：自定义 SearXNG 实例地址数组（provider=searxng 时使用）。 |

## 网页抓取 · `web_fetch`（4 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `url` | 抓取地址 | 要抓的网页地址，可引用上游（如 {{search1.out.results.0.url}}）。 |
| `maxChars` | 正文上限（字符） | 超出会截断并把 out.truncated 置真，默认 8000。 |
| `timeoutMs` | 超时（毫秒） | 单次抓取超时。 |
| `raw` | 原样返回 | true＝不剥离 HTML 标签、返回原始内容；false＝提取正文文本（JSON 会自动解析成对象）。 |

## Python · `python`（6 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `code` | Python 代码 | 内联脚本源码。{{inputs.x}} / {{上游.out.字段}} 是裸文本替换（不会自动加引号），所以在字符串里用要自己写引号。 |
| `codePath` | 代码文件路径 | 可选：约定路径 scripts/<工作流名>/xxx.py（相对 .dag-flow/，也支持绝对路径）。★填了文件时优先于内联代码。 |
| `timeoutMs` | 超时（毫秒） | 脚本运行超时，默认 30000。 |
| `cwd` | 工作目录 | 脚本进程的当前目录；留空＝工作流数据根。 |
| `requirements` | pip 依赖 | 运行时需要安装的依赖（数组，每项一行）；装过会缓存。 |
| `packages` | pip 依赖（另一种写法） | 同 requirements 的数组写法，二者等价。 |

## Bash · `bash`（5 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `code` | Bash 代码 | 内联脚本（用内置 MinGit bash 执行）；模板替换同样不自动加引号。 |
| `codePath` | 代码文件路径 | 可选：约定路径 scripts/<工作流名>/xxx.sh（相对 .dag-flow/，也支持绝对路径）。★填了文件时优先于内联代码。 |
| `timeoutMs` | 超时（毫秒） | 脚本运行超时，默认 30000。 |
| `cwd` | 工作目录 | 脚本进程的当前目录；留空＝工作流数据根。 |
| `dangerouslyAllowDestructive` | 允许危险命令 | 默认关：检测到 rm -rf / 格式化 / dd 这类命令会直接拒绝执行；确实要执行才打开。 |

## 文档解析 · `doc_parse`（8 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `path` | 本地路径 | 要解析的本地文件（相对 .dag-flow/；支持 pdf / docx / pptx / xlsx / 图片等）。和「下载地址」二选一。 |
| `url` | 下载地址 | 下载后再解析的地址（与本地路径二选一，执行时 url 优先）。 |
| `maxChars` | 文本上限（字符） | 默认 20 万；超出截断并把 out.truncated 置真。 |
| `timeoutMs` | 超时（毫秒） | 下载 + 解析的总超时。 |
| `ocr` | OCR 识别 | auto＝图片/扫描版 PDF 自动 OCR（默认）；off＝不跑 OCR（遇到纯图会明确报错）；force＝连有文本层的 PDF 也重新识别。 |
| `ocrMaxPages` | OCR 最多页数 | 限制 PDF 的 OCR 页数，避免大文件跑太久。 |
| `ocrTimeoutMs` | OCR 超时（毫秒） | 整次 OCR 的时间上限。 |
| `extractImages` | 抽取内嵌图片 | auto＝把文档里的图片抽到统一图片目录并在文本里标出位置；off＝只解析文本。 |

## AI 子代理 · `subagent`（7 项）

| 参数名 | 中文名 | 释义 |
| --- | --- | --- |
| `prompt` | 提示词 | 发给模型的内容，可引用上游数据；模型不支持图片时，引用图片会提前失败（不会静默丢图）。 |
| `model` | 执行模型 | 用哪个 dsh 已配置的模型；下拉里带「📷 图片」的才支持传图。 |
| `images` | 图片输入 | 每行一个本地路径或 http(s) 图片地址；只写文件名＝到统一图片目录 <DSH_HOME>/.dag-flow/images/ 里找（文档解析节点抽出的图片也放这里）。只支持 png / jpg / jpeg / webp / gif，最多 20 张、单张不超 20MB。★只有走 dsh 宿主模型（下拉里带「📷 图片」的）才会真把图片发给模型；留空＝纯文本调用。 |
| `system` | 系统提示词 | 可选的 system 指令，用来约束模型行为。 |
| `isolated` | 独立会话 | true＝不继承当前会话上下文，每次干净调用。 |
| `agentPreset` | 智能体预设 | 可选：使用哪个 agent 预设（填预设名称）。 |
| `timeoutMs` | 超时（毫秒） | 单次模型调用超时。 |

---

合计 **90** 条，覆盖 **20** 个节点类型。