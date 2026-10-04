# 执行模型合并：两套语义 → 一套 DAG（进行中）

> 2026-10-04 用户拍板立项。起因：右侧面板的「失败策略」在原逻辑里对画布工作流**从不生效**
> （DAG 执行器不读 `onError`），用户问「这两个配置有什么区别」→ 追到"项目里有两套并行执行语义"。
> 用户决策：**不考虑已有工作流的兼容负担，直接把顺序模式合并进 DAG**，并兼容顺序模式的三种失败策略。

## 目标

dag-flow 只有**一套**执行语义：`def.edges` 是唯一连接表示，一切定义（画布 / 手写 JSON / AI 生成 /
旧文件 / 单节点测试）都先归一到 edges，再走同一个 `runDag`。

## 现状（合并前）

入口分派在 `src/executor/run.ts`：

| def 形态 | 执行器 | 特点 |
|---|---|---|
| 有 `edges` | `runDag()` | 拓扑分层 + 同层并行 + 条件分支激活 + 判环 + 节点预算 |
| 无 `edges` | 旧 `advance()` 递归 | 单链游标；`onError` 只在这里生效；**不判环、无预算** |

## 轮次计划与决策

| 轮次 | 内容 | 状态 |
|---|---|---|
| 轮 1 | `nextToEdges()` 归一化 + 入口切换（当时保留 legacy 代码与 `DAG_FLOW_LEGACY_EXEC=1` 回退开关，**轮 4 已撤除**）；`/run-node` 显式给 edges | **已完成** |
| 轮 2 | DAG 实现 `onError: 'stop' / 'continue'`（边激活语义）+ 面板两个失败配置**合并成一个下拉** | **已完成** |
| 轮 3 | DAG 实现 `onError: {goto}`（失败边，目标只执行一次）+ 面板补第 4 个选项 | **已完成** |
| 轮 4 | 删除 legacy 执行器（约 210 行）+ `PARALLEL_FAILED`/`连线断裂` 两个错误码退役 + 撤除 `DAG_FLOW_LEGACY_EXEC` 回退开关 | **已完成** |

已拍板的语义决策：

1. **DAG 下节点失败只停"该节点的下游"，其它分支继续**（不再是现状的"全图停"）。属行为变更，需在交付说明单列。
2. **`onError: 'continue'` 的呈现**：失败节点的出边失活 → 其下游标「跳过（未执行）」（legacy 是"结果里不出现"）。
3. **`goto` 目标只执行一次**（已执行过视为完成）；不做"可重复执行"，否则要引入迭代预算/结果覆盖一整套语义。
4. **`PARALLEL_FAILED` 与 `连线断裂: a → b` 退役**：失败原因统一由 DAG 的 `firstError`（指向具体节点）表达。

## 归一化映射表（轮 1，语义唯一源）

实现：`src/executor/normalize.ts`；**与客户端 `src/client/util/flowDef.ts` 的 `toRF()` 逐条对齐**。

| `node.next` | 生成的 edges |
|---|---|
| `'x'` | `{from, to:'x'}`（省略 `when`） |
| `['a','b']` | 两条普通边（并行扇出） |
| `{true:'a', false:'b'}` | `when:'true'` / `when:'false'` |
| `{case:'a', '*':'b'}` | `when:case` / `when:'*'` |
| 空目标（`''`） | 跳过不建边（与客户端 `if (!target) continue` 一致） |

**唯一例外**：`switch` 节点写了**非对象** next（字符串/数组）时，补出的边带 `when:'*'`。
原因：legacy 对字符串 next 是"无条件跟随"，而 DAG 里 switch 的缺键边会被判为未激活 → 目标被跳过；
标成 `'*'`（无精确 case 命中时激活）等价复现旧行为。`if` 不需要这个处理（DAG 对 if 的缺键边本就恒激活）。

## 轮 2 实现（失败策略进 DAG + 面板合并）

### 引擎：把"跳过"从逐源累加改成**全局死边判定 + 传播**

新增 `deadEdges`（这次运行不走的边）与 `propagateSkips()`（`src/executor/run.ts` 的 runDag）：

| 判定 | 规则 |
|---|---|
| 边作废 | ① 条件分支未命中的边；② **失败节点的全部出边**（策略为 ignore 时除外）；③ **被跳过节点的全部出边**（传递性） |
| 节点跳过 | 有入边、且**所有入边都作废** → skipped（无入边的入口节点永不跳过） |
| 计数 | 策略 `ignore`(tolerate) 或 `skip`(onError:'continue') → `tolerated=true`，不计 failedCount/firstError；其余 → failedCount + firstError |
| 中断 | **不再因 failedCount>0 而 break**（只停下游）；取消（abort）仍立刻中断后续层 |

### 面板：唯一一个下拉，三项互斥（零数据迁移，底层仍是两个旧字段）

| 选项 | 写入 | 下游 | 计入运行失败 |
|---|---|---|---|
| ⛔ 停止这条支路（默认） | `onError:'stop'` + 删 `tolerate` | 不执行（skipped） | 是（有错因） |
| ⏭ 跳过这条支路，不算运行失败 | `onError:'continue'` + 删 `tolerate` | 不执行（skipped） | 否（toleratedCount） |
| 🛟 忽略失败，下游照常执行 | `tolerate:true` + 删 `onError` | 照常执行 | 否（toleratedCount） |
| ↪ 失败后跳转（轮 3） | `onError:{goto}` | — | 本轮按 stop 处理；旧数据显示为只读当前项 |

## 轮 3 实现（goto 失败边 + 面板第 4 项）

**引擎**：节点失败且未容错、策略为 `goto` 时——
1. 它的全部出边照旧作废（跳过本节点的下游）；
2. 目标被放进 `gotoTargets`（**指定必跑**），于是 `recomputeSkipped()` 会豁免它 → 它在本层照常执行；
   - 目标只对**尚未到达的层**生效（`layerIndexOf(target) > 当前层`）；
   - 目标已执行过 / 已过层 / 同层 → **不重复执行**（"只执行一次"语义），把原因写进该节点的
     `error.message`（悬浮卡与失败详情能看到「未重复执行」），不静默；
3. 记账与 stop 一致：节点自身 `failed`、计入 `failedCount`、`firstError` 指向它。

**同时做的结构改进**：跳过判定由"增量累加 + 事后传播"改成**每层从零重算（不动点）**——
`hardDead`（分支未命中 + 失败节点出边）是唯一事实来源，`skipped` 每层重算。
这样 goto"复活"目标时不会留下级联残留（增量做法必须反向撤销）。

**面板**：第 4 项可选（`↪ 失败后跳转到指定节点`），选中即出现 `↪ 跳转目标` 下拉；
目标下拉里**排在本节点之前**的候选标注「⚠ 在本节点之前执行，跳转不会生效」。

## 轮 5（清尾：性能 / 便利性 / 老数据适配）

四轮合并本身完成后，把过程中发现的问题一次性收掉。

### 5.1 性能：DAG 跳过判定从 O(层数×节点数) 降到 O(1)/层

`runDag` 的"跳过判定"是每层全量重算不动点，链式/菱形图因此退化成 O(层数 × 节点数)。
两处**语义完全等价**的优化（`src/executor/run.ts`）：

1. **内容版本号短路** `deadGen`：`hardDead`/`gotoTargets` 只增不减，任一新增就 +1；版本号没变
   说明重算输入没变 → 结果必然相同 → 整轮重算直接跳过。
2. **预计算入/出边键**：不再每轮对每节点做 `outEdges.filter(...)` 分配，改成建一次表 + Set 查表。

基准（`tmp-test/bench-executor.mjs`，节点全是 set_var，排除节点自身耗时）：

| 形状 | 节点数 | 优化前引擎耗时 | 优化后 | 提速 |
|---|---|---|---|---|
| 链式 | 2002 | 772ms | **24ms** | ~32× |
| 菱形 | 4002 | 4356ms | **45ms** | ~97× |
| 失败传播链 | 2002 | 5003ms | **48ms** | ~104× |
| 宽扇出+merge | 2003 | 153ms | 67ms | ~2.3× |

### 5.2 便利性：问题面板提前报「回跳不生效」

`computeProblems` 新增一条 warn：`onError.goto` 的目标若是**本节点的祖先**（必然在更早的层）或是它自己，
提示「跳转只在目标还没跑到时生效（目标只执行一次），这里不会生效、会按『停止这条支路』处理」，
并指向循环区（loop 循环体）作为"失败后回跳重试"的正路。
新增 CDP 用例 `goto-warn`（夹具参数 `?goto=1`）。

### 5.3 修 bug：画布往返会静默丢掉 `tolerate`

`src/client/util/flowDef.ts` 的 `fromRF` 原来**按字段白名单**重建节点
（只带 id/type/params/next/onError/label）→ 面板上勾的「🛟 忽略失败」（`tolerate:true`）
会在**任何一次画布编辑**（拖节点/改连线）后被静默抹掉，下次保存就从工作流里消失。
改成"**以模板节点为基础覆盖**"，未登记字段一律保留。
回归锁：`test/flow-def.test.mjs`（12 断言，含"A 往返不丢 tolerate"、"B 未登记的新字段也保留"、
"C 结构变更仍然生效"，避免把"保留"写成"变粘"）。

### 5.4 老工作流适配（数据修正，非插件代码）

`tmp-test/audit-workflows.mjs` 只读体检 → `tmp-test/fix-workflows-round5.mjs` 修正（备份在
`tmp-test/backup-round5/`），合计 8 个文件 21 处：

| 类别 | 内容 |
|---|---|
| 非法节点 id | 6 个老文件的**数字 id**（如 `192850`）规范化为 `<type>_<原id>`（`merge_192850`），并同步 next / edges / layout / onError.goto / params 模板引用 / switch cases 值 → 这些文件此前**根本无法执行** |
| 死配置 | 「全节点演示」两处**回跳 goto**（L6→L3、L7→L6，永不生效）删键回默认 stop；「金融政策日报」的 `cfg:continue`（数据源失败却记成功）删键 |
| switch 对齐 | 「全节点演示」switch_mode：以 `params.cases` 为准（该文件 description 明确写了四档语义：quick 默认 / full=图片 / video=视频 / image 与 quick 同路）修正 3 条出边（full 从 video_gen 改回 image_gen、image 从 image_gen 改回 log_mode、补 video→video_gen）；「演示-你好dagflow」的 route 反向（cases 是历史说明文字）以 edges 为准重建 |

复检：`audit-workflows.mjs` 待修项 **42 → 0**；全部工作流过结构校验与模板引用检查。
**仍残留（未擅动，需用户确认意图）**：6 个老演示/测试文件里有一批**从没填过参数**的占位节点
（python/bash code 为空、http url 为空、log message 为空），以及 `测试-copy.json` 有 3 个 start 节点
（结构残缺）——补内容等于替用户造工作流，故只报告。

## 已知行为变更（轮 3 引入）

| # | 场景 | legacy 的 goto | 轮 3 的 goto |
|---|---|---|---|
| 11 | 目标在**后面的层** | 跳过去执行 | 跳过去执行（一致） |
| 12 | 目标在**前面的层/已执行** | **重新执行一次**（等价循环回跳） | **不重复执行**（按"只执行一次"），并按 stop 处理 + 错误消息写明原因 |
| 13 | 记账 | `failedCount++` 但**不写 firstError** | `failedCount++` **且写 firstError**（能在失败详情里看到是哪个节点、什么错） |
| 14 | 跳转发生但目标不适用的情形 | 无感 | 节点错误消息显式说明（可观测） |

★ 实测：用户现有工作流里两处 goto（`全节点演示-技术简报.json` 的 `if_has_search(L6)→web_fetch1(L3)`、
`file_save_report(L7)→if_has_search(L6)`）**都是回跳**，因此在新语义下**不会生效**（按 stop 处理）。
"失败后回跳重试"若确实需要，属于**回边/循环区**能力（v0.5 议题），不要在 goto 上悄悄实现。
排查工具：`node tmp-test/check-goto-order.mjs`（按客户端/引擎同一套分层，打印每条 goto 的源/目标层与是否生效）。

## 已知行为变更（轮 1 引入，均已声明）

| # | 场景 | 合并前（next-only 定义） | 合并后 |
|---|---|---|---|
| 1 | 并行扇出（`next: ['a','b']`）分支自身的 next | **不跟随**（`Promise.all` 之后不推进，merge 永不执行） | 跟随 → merge 真正合流（**修复**） |
| 2 | 孤立节点（不被任何边连接） | 不执行（仅 `end` 节点会被收尾补跑） | 像 DAG 一样在第 0 层被当成入口执行 |
| 3 | 未激活/未走到的节点 | 结果里不出现 | 标 `skipped`（`skippedCount` 计数） |
| 4 | 失败停止范围 | 该链停 | **只停该节点的下游，其它分支继续**（轮 2 落地） |
| 5 | 数据流倒挂 | 不检查 | DAG 预检 `DATAFLOW_ORDER` 直接拒绝（更早暴露"漏连线"） |
| 6 | 安全性 | 无判环、无预算 | `DAG_CYCLE` + `BUDGET_EXCEEDED` 兜底（**收益**） |

## 已知行为变更（轮 2 引入）

| # | 场景 | 轮 2 之前 | 轮 2 之后 |
|---|---|---|---|
| 7 | 任一节点失败 | `failedCount>0 → break`：**后续所有层都不执行**，结果里没有它们 | 只有该节点的**下游**被标 `skipped`；其它分支/后续无关节点照常跑完 |
| 8 | 跨源入边（目标同时被失败节点和成功节点喂入） | 逐源累加 → 只要有一条死边就把目标 `skipped`（**误跳过**） | 有任意一条活入边就执行（**修复**） |
| 9 | 被跳过节点的后代 | 不传播：跳过 `tb` 但 `tb` 的下游照跑（空输入） | 传播：`tb` 的出边也作废 → 后代全部 `skipped`（**修复**） |
| 10 | `onError:'continue'` 的记账 | legacy：`failedCount++` 但**不写 firstError**（运行标失败却无错因） | 计入 `toleratedCount`，运行判成功（去掉"无错因的失败"这个怪态） |

**轮 3**
- `test/goto-edge.test.mjs`（21 断言）：A 目标在后续层→执行（本来会被跳过）、B 目标已执行→不重复执行+写明原因、
  C 同层→不重复、D 目标的下游继续跑、E `tolerate` 优先于 `goto`。
- CDP `node-result-tip`：第 4 个选项 `goto` 可选、写入 `onError:{goto}`、`↪ 跳转目标` 行出现、提示写明"只执行一次"。
- 排查工具 `tmp-test/check-goto-order.mjs`：只读打印每条 goto 的源/目标层与"会不会生效"。

## 回归锁

**轮 1**
- `test/normalize.test.mjs`：映射表 / switch shim / `normalizeDef` 契约（不改入参、幂等）共 23 断言。
- `test/api-e2e.test.mjs` 第 8 节：真执行器端到端——归一化后扇出+merge、if 分支、switch case。
  （轮 1~3 期间该节的 `onError: goto` 曾用 `DAG_FLOW_LEGACY_EXEC=1` 做 legacy 对照；**轮 4 已改写为
  DAG 失败边版本**，flag 一并撤除。）
- `test/manual-await.test.mjs` D 段：next-only 定义"挂起 → 取消 → 收敛 failed"（轮 1~3 曾跑双模式对照，轮 4 收敛为单次）。

**轮 2**
- `test/fail-policy.test.mjs`（28 断言）：A 只停下游/其它分支继续、B skip 不计失败、C ignore 下游照跑、
  D 跨源必须执行、E 传递性、F 条件分支孙节点。
- `test/tolerate.test.mjs` ①②③④ 的断言同步到新语义（"下游未执行"→"下游标 skipped"）。
- CDP `node-result-tip`：面板只剩**一个**失败策略入口（断言 `.dsh-wf-tolerate-check` 已不存在）、
  三个选项值、写入互斥（选 ignore 写 tolerate 且删 onError；切回 stop 删 tolerate）。

**轮 4（删 legacy）**
- `src/executor/run.ts`：594 → 385 行（删 209 行 legacy 主体），入口只剩「normalizeDef → runDag」一条路径；
  一并删除只被 legacy 使用的 `isTolerated` / `upstreamMap` / `advance()`；`PARALLEL_FAILED` 与「连线断裂」随之消失。
- `test/api-e2e.test.mjs` 第 8 节：改写为**显式 edges 的失败边 goto**（fallback 只有一条会被作废的入边，
  只能靠失败边跑起来）+ 新增"并行分支失败 → `firstError.nodeId` 指向具体节点（不再是 `PARALLEL_FAILED`）"。
- `test/offline.test.mjs`：删除针对**测试内桩函数** `advance()` 的 3 条 onError 决策表断言（31 → 28）。
- `test/manual-await.test.mjs` D 段：双模式对照收敛为单次运行（20 → 24 → 20+4 见文件内编号）。
- `test/tolerate.test.mjs`：④ 段与文件头契约文案同步到新语义，工作流名 `tol-legacy-*` → `tol-nextonly-*`。
- `docs/ERROR_REFERENCE.md`：两个退役错误码移出表格，附退役说明与替代行为。
- 自检手段：`tmp-test/cut-legacy.mjs`（一次性手术脚本，带"切错就退出"的四道自检 + 与备份逐字节重建比对）。
