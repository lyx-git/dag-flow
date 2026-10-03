# 示例工作流

复制 JSON 到管理视图「导入」，或保存为 `<工作区>/.dag-flow/workflow/<name>.json` 直接使用（09-26 布局统一后的现行路径）。

> 引用语法：`{{nodeId.out}}` / `{{nodeId.out.字段}}` / `{{nodeId.out.list.0}}`（数组下标）/ `{{vars.x}}` / `{{inputs.x}}`。
> 本地试跑：`node scripts/run-example.mjs examples/<file>.json [--inputs '{"k":"v"}'] [--probes]`（stub 宿主 + 本地 API，无需 DSH 真机；搜索/LLM 走真实网络）。

## 1. hello — 最小 hello world
```json
{
  "name": "hello",
  "version": 1,
  "nodes": [
    { "id": "start", "type": "start", "next": "say" },
    { "id": "say", "type": "log", "params": { "level": "info", "message": "hello from workflow" }, "next": "end" },
    { "id": "end", "type": "end" }
  ]
}
```

## 2. http-then-python — 拉数据 → 处理 → 落盘
```json
{
  "name": "http-then-python",
  "version": 1,
  "description": "GET 一个 JSON API，把结果交给 Python 处理",
  "nodes": [
    { "id": "start", "type": "start", "next": "fetch" },
    {
      "id": "fetch",
      "type": "http",
      "params": { "method": "GET", "url": "https://api.example.com/items", "timeoutMs": 10000 },
      "next": "process"
    },
    {
      "id": "process",
      "type": "python",
      "params": { "code": "import json\nraw = r'''{{fetch.out}}'''\nd = json.loads(raw)\nprint(json.dumps(d, ensure_ascii=False))", "timeoutMs": 5000 },
      "next": "save"
    },
    {
      "id": "save",
      "type": "bash",
      "params": { "code": "echo 'data saved'", "timeoutMs": 3000 },
      "next": "end"
    },
    { "id": "end", "type": "end" }
  ]
}
```
> ⚠️ python/bash 节点**没有 stdin**——上游数据用 `{{u.out}}` 模板内插进 code（如上 `r'''{{fetch.out}}'''`），不要写 `sys.stdin.read()`。

## 3. subagent-chain — 子代理接力
```json
{
  "name": "subagent-chain",
  "version": 1,
  "description": "研究 → 总结 → 翻译（model 必选：填 dsh 已配置的模型 id，可在 GUI /models 里查看）",
  "nodes": [
    { "id": "start", "type": "start", "next": "research" },
    { "id": "research", "type": "subagent", "params": { "prompt": "研究主题 X，给出 3 个关键发现", "model": "dsh:your-model", "timeoutMs": 60000 }, "next": "summarize" },
    { "id": "summarize", "type": "subagent", "params": { "prompt": "{{research.out}}", "model": "dsh:your-model", "timeoutMs": 30000 }, "next": "translate" },
    { "id": "translate", "type": "subagent", "params": { "prompt": "把上面总结翻译成中文", "model": "dsh:your-model", "timeoutMs": 30000 }, "next": "end" },
    { "id": "end", "type": "end" }
  ]
}
```

> ⚠️ subagent 节点 **model 必选**，未选模型时节点以 `MODEL_REQUIRED` 失败；prompt 留空时以 `SUBAGENT_EMPTY_PROMPT` 中断（不调 LLM）。

> ⚠️ **if/switch 表达式作用域**：节点输出两种写法等价——拍平式 `Number(py_gate)`（值即该节点 out）或命名空间式 `Number(results.py_gate)`（=`{{results.<id>}}`，09-27 起）；`inputs.*`/`vars.*` 用对象形式。**写模板式的 `py_gate.out` 会得 NaN**——09-27 起会 console.warn 提示并按 false 处理（不再静默）。

## 4. branch — 条件分支
```json
{
  "name": "branch",
  "version": 1,
  "description": "根据 inputs.score 走不同分支（> 60 走 pass，否则 fail）",
  "inputs": { "score": 75 },
  "nodes": [
    { "id": "start", "type": "start", "next": "cond" },
    { "id": "cond", "type": "if", "params": { "condition": "inputs.score > 60" }, "next": { "true": "pass", "false": "fail" } },
    { "id": "pass", "type": "log", "params": { "message": "PASS" }, "next": "end" },
    { "id": "fail", "type": "log", "params": { "level": "error", "message": "FAIL" }, "next": "end" },
    { "id": "end", "type": "end" }
  ]
}
```

## 5. search-fetch — 网页搜索 → 抓取正文
```json
{
  "name": "search-fetch",
  "version": 1,
  "description": "搜索关键词并抓取第一条结果的正文（内置 5 个免 key 引擎，零配置可用）",
  "nodes": [
    { "id": "start", "type": "start", "next": "ws" },
    { "id": "ws", "type": "web_search", "params": { "query": "FlowGram 工作流引擎", "provider": "auto", "count": 5 }, "next": "wf" },
    { "id": "wf", "type": "web_fetch", "params": { "url": "{{ws.out.results.0.url}}", "maxChars": 8000 }, "next": "end" },
    { "id": "end", "type": "end" }
  ],
  "edges": [
    { "from": "start", "to": "ws" },
    { "from": "ws", "to": "wf" },
    { "from": "wf", "to": "end" }
  ]
}
```

## 6. custom-node — 第三方自定义节点（先 register）
```json
{
  "name": "csv-demo",
  "version": 1,
  "description": "演示使用第三方节点 csv_parse（需先装提供该节点的插件）",
  "nodes": [
    { "id": "start", "type": "start", "next": "parse" },
    { "id": "parse", "type": "csv_parse", "params": { "path": "/tmp/data.csv", "delimiter": "," }, "next": "log_count" },
    { "id": "log_count", "type": "log", "params": { "message": "rows loaded" }, "next": "end" },
    { "id": "end", "type": "end" }
  ]
}
```

如果提供 `csv_parse` 的插件未装，校验时会警告但不会崩；运行时会返回 `UNKNOWN_NODE_TYPE` 错误。

## 7. daily-briefing — 复杂综合示例（搜索/脚本/AI/分支/合流/多模态/落盘）
见同目录 [daily-briefing.json](./daily-briefing.json)：18 节点、3 条并行支线、12 种节点类型。

- 数据流：`set_topic → (并行) web_search→python清洗 ∥ python环境采集→bash时间戳 ∥ 媒体开关 → merge合流 → AI 摘要 → 质量门（if）→ 落盘/告警`；
- 图片分支由 `inputs.run_media` 控制（`"1"` 开启；`img_baseURL` 填 `"MOCK"` 可在 run-example.mjs 里走本地 mock 零费用）；
- 覆盖能力：并行分层执行、merge 多上游合流、if 条件表达式（`Number(results.py_gate.out) > 0`）、模板引用跨节点传数据、中文 labels、双 end 出口。

本地实跑（含必填校验探针）：
```bash
node scripts/run-example.mjs examples/daily-briefing.json \
  --inputs '{"model":"dsh:custom-model:glm-5.3-flash","run_media":"1","img_baseURL":"MOCK"}' \
  --probes
```
