// src/client/param-meta.ts — 节点参数的**中文元数据表（唯一源）**
// 2026-10-19 用户拍板 A：「图片生成和视频生成节点的参数既在右侧面板、又在参数与试跑弹窗里，感觉多余；
//   只想保留弹窗那份，最好对每个参数加个中文名称或释义」
// ⇒ 这两个节点的参数统一收进「🧪 参数与试跑」弹窗，弹窗每行显示「中文名 (参数名) ?」；
//   释义走问号气泡（静态说明不进平铺文案），面板不再重复渲染一份。
//
// 口径：**只登记"没有专用控件需求"的节点**（image_generate / video_generate）。
//   模型下拉、选图按钮、两段式文件来源、python/bash 代码编辑器这类必须有专用控件的参数留在右侧面板 ——
//   塞进通用键值编辑器会退化成裸文本框，反而更难用。
export interface ParamMeta {
  /** 中文名（弹窗里显示在参数名左侧） */
  label?: string;
  /** 静态释义 → 进参数名右侧的小问号（不要写进平铺文案） */
  desc?: string;
  /** 值输入框的 placeholder（只留示例值，解释性文字进 desc） */
  placeholder?: string;
  /** 默认用富文本框（多行）——长文本 / JSON 对象这类参数 */
  multi?: boolean;
}

export const PARAM_META: Record<string, Record<string, ParamMeta>> = {
  image_generate: {
    prompt: {
      label: '画面描述',
      desc: '想生成什么画面，支持 {{上游节点.out.字段}} 引用；必填。运行后图片直接落盘到 <DSH_HOME>/.dag-flow/ 目录，节点输出含相对路径。',
      placeholder: '描述想生成的画面…',
      multi: true,
    },
    baseURL: {
      label: 'API 地址',
      desc: 'OpenAI images/generations 兼容接口的根地址（必填）。填好后在底部点「▶ 试跑本节点」跑一遍，就知道地址 + Key + 模型这组配置通不通（真跑会生成 1 张图并落盘）。',
      placeholder: 'https://…/compatible-mode/v1',
    },
    model: { label: '模型', desc: '该 API 服务支持的图片模型名；配错时「▶ 试跑本节点」会直接失败并给出接口返回的原文。', placeholder: 'wanx-v1' },
    size: { label: '尺寸', desc: '如 1024*1024；不同模型支持的尺寸不同。', placeholder: '1024*1024' },
    n: { label: '张数', desc: '一次生成几张（1~4）。', placeholder: '1' },
    apiKey: { label: 'API Key（明文）', desc: '直接填 Key；留空则改用下面的「Key 环境变量名」。', placeholder: 'sk-…' },
    apiKeyEnv: { label: 'Key 环境变量名', desc: '从环境变量读 Key 的变量名，例如 DASHSCOPE_API_KEY；和「API Key（明文）」二选一。', placeholder: 'DASHSCOPE_API_KEY' },
    filenamePrefix: { label: '文件名前缀', desc: '落盘文件名的前缀，便于区分同工作流的多批产物。', placeholder: 'report' },
    timeoutMs: { label: '超时（毫秒）', desc: '单次生成请求的超时时间。', placeholder: '60000' },
  },
  video_generate: {
    submitUrl: {
      label: '任务提交地址',
      desc: '异步视频任务的提交地址（必填，POST）。流程：提交 → 按「轮询间隔」查「任务查询地址」→ 等「取视频地址的字段」有值就算完成 → 视频下载到 <DSH_HOME>/.dag-flow/。',
      placeholder: 'https://…/video/generation',
    },
    pollUrl: { label: '任务查询地址', desc: '轮询任务状态的地址（必填）。支持 {taskId} 占位符，会被替换成提交返回的任务 id。', placeholder: 'https://…/video/task?taskId={taskId}' },
    submitMethod: { label: '提交方法', desc: '提交时用的 HTTP 方法，默认 POST。', placeholder: 'POST' },
    submitHeaders: { label: '提交请求头', desc: 'JSON 对象：{"Authorization":"Bearer …"}。', multi: true, placeholder: '{"Authorization":"Bearer sk-…"}' },
    submitBody: { label: '提交请求体', desc: 'JSON 对象，会原样作为提交请求体；其中可以写 {{上游.out.字段}} 引用。', multi: true, placeholder: '{"model":"…","input":{"prompt":"{{img_filled.out.prompt}}"}}' },
    taskIdPath: { label: '取任务 id 的字段路径', desc: '从提交响应里取任务 id 的路径，如 output.task_id。', placeholder: 'output.task_id' },
    pollHeaders: { label: '查询请求头', desc: 'JSON 对象，轮询时带上（通常和提交一致）。', multi: true, placeholder: '{"Authorization":"Bearer sk-…"}' },
    pollIntervalMs: { label: '轮询间隔（毫秒）', desc: '两次查询之间等多久，默认 5000。', placeholder: '5000' },
    maxWaitMs: { label: '最长等待（毫秒）', desc: '超时后节点失败并给出最后一次任务状态，默认 600000（10 分钟）。', placeholder: '600000' },
    statusPath: { label: '取状态的字段路径', desc: '从查询响应里取任务状态的路径，如 output.task_status。', placeholder: 'output.task_status' },
    doneValue: { label: '完成状态值', desc: '状态等于这个值就认为任务完成，如 SUCCEEDED。', placeholder: 'SUCCEEDED' },
    videoUrlPath: { label: '取视频地址的字段路径', desc: '从查询响应里取视频下载地址的路径，如 output.video_url。', placeholder: 'output.video_url' },
    filename: { label: '保存文件名', desc: '落盘用的文件名（可含子目录）。', placeholder: 'clip.mp4' },
    apiKey: { label: 'API Key（明文）', desc: '直接填 Key；留空则用下面的环境变量名。', placeholder: 'sk-…' },
    apiKeyEnv: { label: 'Key 环境变量名', desc: '从环境变量读 Key 的变量名，例如 DASHSCOPE_API_KEY。', placeholder: 'DASHSCOPE_API_KEY' },
  },
  // ===== 2026-10-19（用户要求「弹窗里面参数的形式，也都要改成和图片生成的样式一样」）：把中文名 + 问号释义
  //   扩到**其余全部节点**，让每一行都是「中文名在上、参数名注脚在下」的两行式。
  //   ★ 只登记「会出现在参数弹窗里」的键；file_save / web_* / doc_parse / session_input 的键目前由
  //     弹窗里的专属表单渲染（`handledKeys` 过滤掉了通用行），登记它们是为等专属表单也接上元数据时直接可用。
  end: {
    outputs: {
      label: '结束输出',
      desc: '结束节点的输出对象（写 JSON）。子工作流里它就是「本轮输出」——loop 的 items、subflow 的 out 都取自它；写 {"break": true} 可让循环在跑完这一轮后停下。',
      multi: true,
      placeholder: '{"summary":"…"}',
    },
  },
  set_var: {
    vars: {
      label: '写入的变量',
      desc: '要写入的全局变量（JSON 对象，键＝变量名）：下游用 {{vars.名称}} 引用；值里可以写 {{上游.out.字段}} 模板。',
      multi: true,
      placeholder: '{"city":"上海"}',
    },
  },
  if: {
    condition: {
      label: '条件表达式',
      desc: '布尔表达式，决定走 true 还是 false 分支：节点输出按「节点id.字段」拍平（如 web_search1.count > 0）。写错按 false 处理、不报错；and / or / not 可用。',
      placeholder: 'web_search1.count > 0',
    },
  },
  switch: {
    value: { label: '取值表达式', desc: '要匹配的表达式（如 prep_vars.mode）：它的值会去「分支表」里找同名的键。', placeholder: 'prep_vars.mode' },
    cases: {
      label: '分支表',
      desc: 'JSON 对象：{"分支键":"目标节点id"}。键写 * 是兜底分支（其它键都没命中时走它）；没写 * 又没命中会告警 SWITCH_EDGE_NOT_IN_CASES。',
      multi: true,
      placeholder: '{"quick":"log_a","*":"log_other"}',
    },
  },
  loop: {
    count: { label: '跑几次', desc: '固定跑多少轮（留空且不填「遍历数组」时，节点无边界、会被拦下）。', placeholder: '3' },
    over: { label: '遍历数组', desc: '上游数组引用（整串），如 {{list1.out.items}}；填了它按数组长度跑（优先级高于「跑几次」）。', placeholder: '{{list1.out.items}}' },
    roundIf: { label: '每轮条件', desc: '可选门禁：为真才执行这一轮的循环体，为假跳过该轮（跳过数记在 out.skipped），不影响后面几轮。', placeholder: 'loopIndex < 3' },
    maxIterations: { label: '最大迭代次数', desc: '上限：留空＝不限（只受引擎 10 万硬上限保护）；填了超过就截断，并在 out 里带 truncated / requested / processed。' },
    body: {
      label: '循环体',
      desc: '每轮调用的子工作流：{"workflowName":"…","inputs":{…}}，inputs 里可用 {{vars.loopItem}} / {{vars.loopIndex}} / {{vars.lastOutput.字段}}。弹窗下方「🔁 循环设置」里可以选子工作流并配传参。',
      multi: true,
      placeholder: '{"workflowName":"子工作流-采集","inputs":{}}',
    },
    onIterationError: { label: '某轮失败怎么办', desc: 'stop＝这一轮失败就整节点失败；continue＝记下失败、继续跑后面几轮。', placeholder: 'continue' },
  },
  log: {
    level: { label: '级别', desc: 'info / warn / error：只影响日志的图标与颜色，不影响流程走向。', placeholder: 'info' },
    message: { label: '日志内容', desc: '写进运行日志的文本，可用 {{上游.out.字段}} 展示上游数据。', multi: true },
  },
  manual: {
    prompt: { label: '确认提示', desc: '挂起时给操作人看的问题，可用 {{上游.out.字段}} 把待确认的数据摆出来。', multi: true },
    schema: { label: '确认表单', desc: '可选：JSON Schema，描述需要人工填写的字段（运行到这里会弹表单）。', multi: true },
  },
  merge: {
    keys: { label: '输出键名', desc: '可选：按上游连线顺序给合流输出起键名（数组）。留空＝直接用上游节点 id 当键。', placeholder: '["a","b"]' },
  },
  subflow: {
    workflowName: { label: '子工作流名', desc: '要调用的工作流名称（必须是已保存的工作流）。能传什么由子工作流自己的「工作流参数」决定。', placeholder: '子工作流-采集' },
    inputs: { label: '传给子工作流的参数', desc: 'JSON 对象：键＝子工作流声明的工作流参数名；值可写 {{上游.out.字段}}。', multi: true },
  },
  session_input: {
    sessionId: { label: '会话', desc: '要读取的 dsh 会话 id（右侧面板有下拉可选）。' },
    limit: { label: '读取条数', desc: '最多取最近多少条消息，默认 10。', placeholder: '10' },
    workspace: { label: '工作区', desc: '会话所在工作区（多工作区时用来筛选）；留空＝当前工作区。' },
  },
  http: {
    method: { label: '方法', desc: 'GET / POST / PUT / PATCH / DELETE。', placeholder: 'GET' },
    url: { label: '请求地址', desc: '完整 URL，可引用上游数据（如 {{u.out.url}}）。', placeholder: 'https://…' },
    headers: { label: '请求头', desc: 'JSON 对象：{"Authorization":"Bearer …"}。', multi: true },
    body: { label: '请求体', desc: 'JSON 对象或字符串，作为请求体发送（method=GET 时通常留空）。', multi: true },
    timeoutMs: { label: '超时（毫秒）', desc: '单次请求超时，默认 30000。', placeholder: '30000' },
  },
  file_save: {
    source: { label: '内容来源', desc: 'text＝保存一段文本；base64＝把 Base64 字符串解码成二进制；url＝先下载再保存。', placeholder: 'text' },
    content: { label: '文本内容', desc: 'source=text 时要保存的文本，可引用上游数据。', multi: true },
    url: { label: '文件地址', desc: 'source=url 时要下载的地址。', placeholder: 'https://…' },
    filename: { label: '保存文件名', desc: '相对 <DSH_HOME>/.dag-flow/ 的文件名，可含子目录（如 reports/周报.md）。', placeholder: 'output.txt' },
  },
  web_search: {
    query: { label: '搜索关键词', desc: '要搜什么，可引用上游数据。', multi: true },
    provider: { label: '搜索引擎', desc: 'auto＝按内置引擎链自动挑（Bing → AnySearch → DuckDuckGo → DuckDuckGo Lite → SearXNG，谁先出结果用谁；前两个在国内网络下最稳，2026-10-19 按真机实测重排）；也可指定具体引擎（下拉里每项带说明）。只走内置免 key 引擎，不依赖任何外部搜索插件。', placeholder: 'auto' },
    count: { label: '结果条数', desc: '取多少条（1~20），默认 8。', placeholder: '8' },
    lang: { label: '语言/地区', desc: '如 zh-cn；部分引擎支持，留空用引擎默认。', placeholder: 'zh-cn' },
    timeRange: { label: '时间范围', desc: 'day / week / month / year：只看该时间段内的结果。' },
    searxngInstances: { label: 'SearXNG 实例', desc: '可选：自定义 SearXNG 实例地址数组（provider=searxng 时使用）。', placeholder: '["https://searx.example.com"]' },
  },
  web_fetch: {
    url: { label: '抓取地址', desc: '要抓的网页地址，可引用上游（如 {{search1.out.results.0.url}}）。', placeholder: 'https://…' },
    maxChars: { label: '正文上限（字符）', desc: '超出会截断并把 out.truncated 置真，默认 8000。', placeholder: '8000' },
    timeoutMs: { label: '超时（毫秒）', desc: '单次抓取超时。', placeholder: '30000' },
    raw: { label: '原样返回', desc: 'true＝不剥离 HTML 标签、返回原始内容；false＝提取正文文本（JSON 会自动解析成对象）。', placeholder: 'false' },
  },
  python: {
    code: { label: 'Python 代码', desc: '内联脚本源码。{{inputs.x}} / {{上游.out.字段}} 是裸文本替换（不会自动加引号），所以在字符串里用要自己写引号。', multi: true, placeholder: 'print("hi")' },
    codePath: { label: '代码文件路径', desc: '可选：约定路径 scripts/<工作流名>/xxx.py（相对 .dag-flow/，也支持绝对路径）。★填了文件时优先于内联代码。', placeholder: 'scripts/我的工作流/run.py' },
    timeoutMs: { label: '超时（毫秒）', desc: '脚本运行超时，默认 30000。', placeholder: '30000' },
    cwd: { label: '工作目录', desc: '脚本进程的当前目录；留空＝工作流数据根。' },
    requirements: { label: 'pip 依赖', desc: '运行时需要安装的依赖（数组，每项一行）；装过会缓存。', placeholder: '["requests"]' },
    packages: { label: 'pip 依赖（另一种写法）', desc: '同 requirements 的数组写法，二者等价。', placeholder: '["requests"]' },
  },
  bash: {
    code: { label: 'Bash 代码', desc: '内联脚本（用内置 MinGit bash 执行）；模板替换同样不自动加引号。', multi: true },
    codePath: { label: '代码文件路径', desc: '可选：约定路径 scripts/<工作流名>/xxx.sh（相对 .dag-flow/，也支持绝对路径）。★填了文件时优先于内联代码。', placeholder: 'scripts/我的工作流/run.sh' },
    timeoutMs: { label: '超时（毫秒）', desc: '脚本运行超时，默认 30000。', placeholder: '30000' },
    cwd: { label: '工作目录', desc: '脚本进程的当前目录；留空＝工作流数据根。' },
    dangerouslyAllowDestructive: { label: '允许危险命令', desc: '默认关：检测到 rm -rf / 格式化 / dd 这类命令会直接拒绝执行；确实要执行才打开。', placeholder: 'false' },
  },
  doc_parse: {
    path: { label: '本地路径', desc: '要解析的本地文件（相对 .dag-flow/；支持 pdf / docx / pptx / xlsx / 图片等）。和「下载地址」二选一。' },
    url: { label: '下载地址', desc: '下载后再解析的地址（与本地路径二选一，执行时 url 优先）。' },
    maxChars: { label: '文本上限（字符）', desc: '默认 20 万；超出截断并把 out.truncated 置真。', placeholder: '200000' },
    timeoutMs: { label: '超时（毫秒）', desc: '下载 + 解析的总超时。' },
    ocr: { label: 'OCR 识别', desc: 'auto＝图片/扫描版 PDF 自动 OCR（默认）；off＝不跑 OCR（遇到纯图会明确报错）；force＝连有文本层的 PDF 也重新识别。', placeholder: 'auto' },
    ocrMaxPages: { label: 'OCR 最多页数', desc: '限制 PDF 的 OCR 页数，避免大文件跑太久。' },
    ocrTimeoutMs: { label: 'OCR 超时（毫秒）', desc: '整次 OCR 的时间上限。' },
    extractImages: { label: '抽取内嵌图片', desc: 'auto＝把文档里的图片抽到本工作流的图片目录（.dag-flow/images/<工作流名>/）并在文本里标出位置；off＝只解析文本。', placeholder: 'auto' },
  },
  subagent: {
    prompt: { label: '提示词', desc: '发给模型的内容，可引用上游数据；模型不支持图片时，引用图片会提前失败（不会静默丢图）。', multi: true },
    model: { label: '执行模型', desc: '用哪个 dsh 已配置的模型；下拉里带「📷 图片」的才支持传图。' },
    images: { label: '图片输入', desc: '每行一个本地路径或 http(s) 图片地址；只写文件名＝到本工作流的图片目录 .dag-flow/images/<工作流名>/ 里找（文档解析节点抽出的图片也落这里，各工作流互不干扰）。只支持 png / jpg / jpeg / webp / gif，最多 20 张、单张不超 20MB。★只有走 dsh 宿主模型（下拉里带「📷 图片」的）才会真把图片发给模型；留空＝纯文本调用。', multi: true, placeholder: '每行一个：\nchart.png\nC:\\图片\\a.jpg\nhttps://x.png' },
    system: { label: '系统提示词', desc: '可选的 system 指令，用来约束模型行为。', multi: true },
    isolated: { label: '独立会话', desc: 'true＝不继承当前会话上下文，每次干净调用。', placeholder: 'false' },
    agentPreset: { label: '智能体预设', desc: '可选：使用哪个 agent 预设（填预设名称）。' },
    timeoutMs: { label: '超时（毫秒）', desc: '单次模型调用超时。', placeholder: '120000' },
  },
};

/** 按节点类型取参数元数据（未登记的节点返回 undefined ⇒ 弹窗保持原来的"只有参数名"的样子） */
export function paramMetaOf(type?: string): Record<string, ParamMeta> | undefined {
  return type ? PARAM_META[type] : undefined;
}
