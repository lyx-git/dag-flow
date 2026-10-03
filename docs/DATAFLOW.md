# dag-flow 数据传递架构

> DAG 工作流组件间数据向下传递的完整机制设计。
> 核心：**节点输出 → ctx.results → 下游节点 params 模板引用**。

---

## 1. 数据流模型

```
┌─────────┐    out     ┌─────────┐    out     ┌─────────┐
│  Python │ ────────→  │  HTTP   │ ────────→  │ Subagent│
│ (上游)  │  ctx.results│ (中游)  │ ctx.results │ (下游)  │
└─────────┘           └─────────┘           └─────────┘
     │                     │                     │
     └── out 存入 ─────────┘  └── 下游 params 用
         ctx.results[id].out      {{nodeId.out}} 引用
```

- 每个节点执行后把输出写入 `ctx.results[nodeId].out`（`NodeResult.out`）
- 下游节点的 `params` 可用 **模板引用** 声明式引用上游输出
- 执行下游节点前，运行时解析引用 → 注入实际值

## 2. 引用语法（交互方式）

| 语法 | 含义 | 示例 |
|---|---|---|
| `{{nodeId.out}}` | 上游节点完整输出 | `{{py.out}}` |
| `{{nodeId.out.field}}` | 输出字段（嵌套点路径） | `{{http.out.body.count}}` |
| `{{nodeId.out.list.0}}` | 数组元素（点路径数字段 = 数组下标） | `{{ws.out.results.0.url}}` |
| `{{nodeId}}` | 简写（等同 nodeId.out） | `{{py}}` |
| `{{vars.xxx}}` | 共享变量（set_var 写入） | `{{vars.threshold}}` |
| `{{inputs.xxx}}` | 工作流输入 | `{{inputs.url}}` |
| `{{results.nodeId}}` | 完整 NodeResult（含 status/durationMs） | `{{results.py}}` |

**语义**：
- **纯引用**（整个值就是 `{{...}}`）→ 直接替换为值，**保持类型**（number/boolean/object）
- **混合模板**（字符串中包含引用）→ 替换为字符串化值
- 引用失败（节点不存在/未执行/字段缺失）→ 严格模式抛 `DataflowError`

## 3. 运行时解析与注入（src/executor/dataflow.ts）

```
执行节点前:
  resolved = resolveParams(node.params, ctx, nodeId)
     ├─ 递归遍历 params（对象/数组/字符串）
     ├─ 字符串检测 {{...}} 引用
     ├─ resolveRefToken: inputs / vars / nodeId.out[.field] 解析
     └─ 纯引用保持类型 / 混合模板字符串化
  defReg.run(ctx, resolved)   ← 节点拿到解析后的真实参数
```

接入点：`run.ts` 的递归版 executeNode 与 `runDag` 的层内执行，都在 `defReg.run` 前调用 `resolveParams`。引用失败 → 节点返回 `DATAFLOW_REF` 失败（不崩溃）。

## 4. 数据校验（三重防护，保证高效无错）

### 4.1 运行前预检（runDag 拓扑排序后）
用 `extractRefs` 提取每个节点 params 引用的上游节点，检查：
| 错误码 | 条件 |
|---|---|
| `DATAFLOW_SELF_REF` | 节点引用自己（{{self.out}}） |
| `DATAFLOW_UNKNOWN` | 引用不存在的节点 |
| `DATAFLOW_ORDER` | 引用拓扑序**在其后**的节点（数据流倒挂） |

### 4.2 运行时解析校验
`resolveParams` strict 模式：引用目标未执行/非 success/字段路径不可达 → `DataflowError` → 节点失败。

### 4.3 拓扑判环（既有）
`topoSort` 检测 DAG 环 → `DAG_CYCLE` 拒绝。

## 5. 高效无错跑完的保障

| 机制 | 作用 |
|---|---|
| 拓扑分层并行 | 依赖就绪的节点同层并行，无依赖串行等待 |
| 预算防护 | MAX_NODES=10 万，防失控 |
| 条件分支激活 | if/switch 只执行激活分支（skipped 集合） |
| 失败中止/跳过 | onError 三态（stop/continue/goto） |
| dagFail 统一失败 | 预检失败返回结构化 RunSummary |

## 6. 节点 out 结构一览

| 节点 | out |
|---|---|
| start | 透传 inputs |
| python/bash | stdout 字符串（去尾换行） |
| http | `{ status, body }` |
| subagent | LLM 回复内容 |
| session_input | 会话内容 |
| set_var | 合并后的 vars |
| if | 条件求值结果 |
| switch | `{ matched, target }` |
| loop | `{ count }` |
| log | 消息内容 |

## 7. 客户端提示

NodeInspector 参数编辑区展示引用语法提示，帮助用户编写数据传递引用。
