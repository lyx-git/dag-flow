# dag-flow 公共开发规范

> **效力**：本文件是 dag-flow 的**公共开发规范**（2026-10-18 从历轮对话、记忆与既有约定抽取整理）。
> **每次修改都必须遵循**——动手前对照第 10 节的检查清单，收口时逐条给出证据。
> **与其他文档的关系**：`docs/CLIENT-VERSION-NOTES.md`＝客户端版本变更记录（按轮追加，**新条目写最上面**）；
> `docs/ERROR_REFERENCE.md`＝错误码权威表；`docs/DATAFLOW.md` / `docs/EXEC-MODEL-MERGE.md` / `docs/SCHEDULE-PLAN.md`＝
> 各专题设计；`README.md`＝用户文档（中英双语）。本文件只写"怎么做"，不重复它们的细节。

## 0. 总则与红线（违反即返工）

1. **任何修改都不能影响现有功能**；不得引入新 bug。发现原逻辑自带 bug ⇒ **先报告影响面与修法、等用户确认再动手**，不"顺手修"。
2. **不可避免的行为变更必须单列**：交付说明里写清"改了哪条语义 + 为什么必须改 + 触发条件"，让用户能自己复核。
3. **新功能走加法**：新字段 / 新分支 / 新节点；不重写既有路径。
4. **最小影响面**：修一个节点就收在该节点内部；交付要给"结构未动"的可验证证据（节点数/边数不变 + 自检全绿），不是"我觉得没影响"。
5. **一个修复 = 一轮独立验证窗口**，不混轮；用户推翻上一轮选择时**立即照新要求改并把上一版净掉**，不要反驳。
6. **改动由用户提交**；收尾给**一行可直接粘进 commit 的总结**（说清"改了什么 + 为什么"），总结里不夹待办与提问。

## 1. 架构与分层

**host**（`dist/index.js`）：`src/index.ts`（cordis 入口，inject 名单唯一来源＝`src/dsh-gate/host.ts` 的 `HOST_INJECT`）
→ `src/adapter/`（`routes/` 承载全部 HTTP 路由；storage＝存储根/迁移/版本；subagent → llm-endpoints / llm-modality / image-inputs；search → web-fetch；assets / fetch-errors / runtime / ocr / image-library；cron + schedules + scheduler）
→ `src/registry/`（`nodes/` ＝各节点实现；params-check / expr / doc-extract / doc-pdf / doc-image-pdf / name-rule）
→ `src/executor/`（normalize / topo / run / dataflow / selfcheck / record / awaiting）
→ `src/dsh-gate/`（**防腐层**：host / paths / llm / 注册契约 / settings schema / 会话格式）。

**client**（`dist/client.js`，React18）：`index.tsx`（壳：panel-mount / dock / window-frame）
→ `FlowPanel.tsx`（核心编排体）→ `flowgram/`（画布）／`dialogs/`（弹窗，hook+View 对）／`panel-utils.ts` / `inspector-fields.tsx` / `NodeInspector.tsx` / `params-editor.tsx` + `params-value.ts` / `info-tip.tsx` / `undo-stack.ts` + `undo-wiring.ts` / `util/`（纯函数）。

**规矩**：不造跨层捷径；`src/client/` 不得 import 宿主模块（R3 零依赖，契约用"结构化最小接口 + 双向断言"看住）。

## 2. 目录与命名

| 落位 | 放什么 |
|---|---|
| `src/client/` | 面板与组件（PascalCase 且**文件同名**） |
| `src/client/flowgram/` | 画布相关（`dsh-wf-fg-*` 类名） |
| `src/client/dialogs/` | 弹窗（每个弹窗＝独立文件，hook+View） |
| `src/client/util/` | 纯函数（不 import React / 不碰 DOM） |
| `src/adapter/` `src/registry/` `src/executor/` `src/dsh-gate/` | host 侧（见上表） |
| `test/` | **进 `test:offline` 链的正式契约测试** |
| `tmp-test/` | 一次性探针 / 夹具 / CDP / 构建产物（gitignore，**会静默说谎**） |
| `docs/` | 正式文档 |

命名：组件 PascalCase、hooks `useXxx`、工具 camelCase；CSS 前缀统一 `dsh-wf-*`（画布内 `dsh-wf-fg-*`）、弹窗壳 `dag-flow-picker*`，**禁止第二套前缀**；布尔 `is/has/can/should` 开头；常量 `SCREAMING_SNAKE`。

## 3. 代码规范

1. 单文件**软上限 500 行**（硬 600），按**逻辑边界**拆；**逻辑统一性优先于字数**（FlowPanel 核心编排体 / NodeInspector 按此豁免）。
2. **新文件禁止 `@ts-nocheck`**（src 目前零旗）；`any` 仅限 dsh-gate 防腐层与 `renderBody` 的过渡点。
3. 渲染只做编排，复杂计算下沉 `useMemo` / 模块级纯函数；状态放**最小需要它的组件**，禁止新全局可变变量。
4. 监听器 / 定时器集中到专管模块，`useEffect` 卸载必须清理；竞速 / 超时走统一 helper（内部 `clearTimeout`），不裸写 `setTimeout` 造超时。
5. **"两份必须同步"的东西必须有唯一源或自动闸门**（ajv 中文映射 → `src/ajv-zh.ts`；两份 schema → `schema-parity.test.mjs`；标识生成 → `util/flowDef.ts`；客户端版本标记 → `CLIENT_VERSION` 常量）。
6. 新 UI 元素的样式**走 CSS 类**，不用内联 style（内联无法双主题适配、也无法用类名断言）。
7. **CSS 注释只能用块注释**（`//` 会被 esbuild 打进产物并让紧随其后的规则失效）；CSS 拆包必须用**多条 import 按级联序**（`@import` 不被 dsh-css-inject 处理）。
8. 高频事件（mousemove / scroll / wheel）委托 + 节流；列表 key 稳定；render 里不建正则 / 大常量 / 新函数引用。
9. 遇到无效 / 无用 / 过时文件：核实引用（零引用审计 / 实跑 / 产物比对）后**直接删**，别留半套。
10. 源码文件头只留 3-5 行「职责 + 关联文件 + 当前版本标记」；变更历史进 `docs/CLIENT-VERSION-NOTES.md`。

## 4. UI 与交互口径

1. **弹窗统一模式**：关闭一律右上角 ✕（`.dag-flow-picker-close`），**不设底部关闭 / 取消按钮行**；标题 15-16px、hint 小字 11-12px 浅色；**一律顶部锚定**（overlay `align-items:flex-start` + `padding-top:14vh`）；确认 / 提示**一律应用内弹窗，禁用 `window.confirm/alert`**。
2. **弹窗宽度**：默认由运行时注入的 `.dag-flow-picker{width:680px}` 决定 ⇒ 自定义宽度**必须写两段选择器** `.dag-flow-picker.<自己的类>`（只写 `.dsh-wf-xxx` 会同权重被静默压回）。
3. **说明文字**：静态解释（字段语义 / 限制 / 帮助段落 / placeholder 里的解释句）**收进小问号**（`InfoTip`，问号紧跟它解释的标签 / 标题右侧）；**动态内容必须平铺**（⚠ 警告、空态引导、运行 / 测试结果、当前值回显、计数）；**失败策略每个选项的语义说明保持平铺**。
   ★ **关键提示一律平铺在显眼位置，绝不进小问号**（2026-10-18 用户纠正原话：「改动即自动保存，还是要在明显地方提示的，不能放到小问号里面，这个提示信息属于关键提示」；同轮定稿：「恢复成这样，并且放到小问号后面，字体颜色大小，状态统一成"3 个参数"一样的」）。判据：**用户看不到它就会做出错误判断**的句子＝关键提示——数据会不会丢、会不会真的生效、会不会产生费用、是否不可逆（例：「改动即自动保存」「手动保存生成版本、自动保存不计入」「回载会覆盖当前内容」）。落位优先级：①**标题行紧跟说明问号之后**（本项目定稿形态：`🧪 参数与试跑（…）[?] 3 个参数 · 改动即自动保存`）；②紧贴它描述的对象。**样式跟随所在行的既有样式**（同字号 / 同色 / 同字体），不刻意加粗或换亮色——"位置显眼"就够了，不要自己发明强调方式。只有**纯操作说明**（语法 / 快捷键 / 怎么切成多行框）才进问号。★改这类提示的位置 / 归属要写**能失败的断言**（CDP 断"在问号之后且同一行 + 样式与同行计数同款 + 不贴右内边 + 问号里没有它"）。
4. **操作区与说明区分离**：功能按钮放进**它所服务的控件工具栏**（如「🖼 选图」进富文本框工具栏），不挂在说明文字后面。
5. **同区按钮一致性**：同高 / 同宽 / 同风格 / 同配色；图标要么全 emoji 要么全线条 SVG（14×14 / viewBox 24 / strokeWidth 2 / `currentColor`）；纯图标按钮钉同一宽，会变文字的用 `min-width`；**框内图标按钮规格＝22×22、圆角 6、透明底、hover 才出色**（抄 `.dsh-wf-params-grow`），不与文字按钮同排。
6. **反馈浮窗统一在顶部**（`fixed; top:14vh`）：成功 / 完成约 2.6s 自动消失，失败**常驻且可点开详情**；不用面板内行内小字。
7. **动效只用来消除硬切感**：有几何依赖的元素（弹窗 / 菜单）**只做 opacity 淡入**（`transform: scale` 会让 `getBoundingClientRect` 量错）；不做位移 / 退场动画 / 不碰画布；支持 `prefers-reduced-motion`；别用 `transition: all`；时长 弹窗 140ms / 导出菜单 120ms / 顶部浮窗 160ms。
8. **同一功能只留一个入口**（重复语义必须合并，优先零数据迁移）；按用户指定的那处收敛，删的一侧连壳清干净、保留的一侧一行不动。

## 5. 文案与一致性

1. **错误消息全中文**，错误码（`code`）保留英文大写；新增 / 改错误码必须同步 `docs/ERROR_REFERENCE.md`；网络类错误必须经 `humanizeFetchError()`，禁止直接透出 `e.message`。
2. **用户可见文案禁用 Markdown `**`**（会渲染成裸星号，用户极敏感、已复发多次）；强调用「」或加粗元素。
3. **不要「老行为 / 旧行为 / 原行为」这类新旧对照括注**，直接描述当前行为。
4. **节点显示名是双表**：client `NODE_PALETTE` + server `describe()`，改名同步（专名保留 Python / Bash / HTTP）。
5. 工作流名规则唯一源 `src/name-rule.ts`；`WORKFLOW_SCHEMA` 与 client `JsonView.tsx` 副本同步（闸门 `schema-parity.test.mjs`）。
6. 节点配置文件放 `workflow/config/<name>.json`（直接放 `workflow/` 会被 `listJsonNames()` 当成一个工作流列出来）。

## 6. 节点参数设计（新参数 / 新输入格式）

1. **可加性**：新参数默认不填时**行为与改动前完全一致**（纯加法）；顶层 schema 的 `node.params` 是 `additionalProperties` ⇒ 加参数不用改 schema。
2. **格式必须自带可复制示例**：示例做进控件本身（placeholder / 示例值），否则用户真机一用就卡在"格式怎么区分"。★ 示例要能**在当前控件宽度里完整显示**（本轮两段式把输入框压到一百多像素，旧 placeholder 被截成半句话）；长示例 / 多种形态（绝对路径、`{{}}` 引用等）写进问号气泡。
3. **同义输入合并成一个控件**（2026-10-18 用户要求）：同一件事的互斥输入（如"本地路径 or 下载地址"）**不并列成两个输入框**，而是**一个输入框分两段——前段选类型、后段填值**；切换类型时清掉另一侧（传 `null` 走删键语义）。判据：并行两个框会让用户不确定填哪个、也会出现两个都填的歧义。
4. **默认值要给最常用的那档**（2026-10-18 用户要求：OCR 默认「自动」）；改默认值属于**行为变更**，必须单列并说清影响面（含对既有工作流的影响、对测试的影响）。
   ★**改默认值必须同时改 client 的 `NODE_PALETTE.defaultParams`**（`src/client/types.ts`）：拖拽 / 插入 / AI 生成新节点都读它，只改引擎侧缺省值 ⇒ 新建节点仍带旧默认、面板显示旧值，等于没改（本轮实测漏过这一处，最后靠截图 + 复看源码才发现）；并且必须补一条**能失败的断言**锁住"新节点默认值"（范例：CDP `doc-parse-panel` 断言面板值与 `params.ocr` 都是 auto，已用夹具注入 A/B 反证）。
5. 参数形态：单行框 / 富文本框按内容自动判（长文本 / 含换行 / `code` 行默认多行）；值类型**自动推断**（数字样 / true / false / JSON ⇒ 对应类型，其余按原文字符串），要强制字符串时走「JSON 视图」加引号。
6. 输出字段、错误码、面板说明三者要一致；新增可选参数要检查：面板行 / 示例 / 自检 / 文档 / markers。

## 7. 测试与闸门

1. 三产物缺一不可：`node scripts/build-host.mjs`、`build-client.mjs`、`tmp-test/build-fixture.mjs`（夹具加载 `tmp-test/grab-test.js`，漏第三步＝新功能"完全没反应"）。
2. 新增测试**必须同轮注册进 `package.json#test:offline`**，并核对输出横幅计数确认它真的跑了（漏加＝假绿）。
3. 纯逻辑优先做**离线单测**（esbuild 即时打包 → `import()` → 断言；范本：`undo-stack.test.mjs` / `params-value.test.mjs`）；UI 行为走 CDP。
4. **断言只做正向锚定**（断"新特征存在"）；例外＝自有源码串可断"已消失"。中文在产物里是 `\uXXXX` ⇒ 用解码后的 `cTxt/hTxt` 断言。
5. **断言要定界到目标对象**：别用 `[^@]*` 这类会兜到下一个分隔符的字符类（会把别处的合法改动判成回归）。
6. **写完"锁 bug"的断言要做 A/B 反证**：临时还原修复 ⇒ 断言必须精确变红；不变红＝假锁，要撑开窗口或如实降级口径。
7. **改字符串的内容 / 位置 / 拼法（抽常量、改措辞、挪行）前**，除了 grep 名字，还要 grep **会被正则或字符串匹配的片段** —— 尤其 `test/` 与闸门文件；改完先单独跑那道闸门。
8. 收口顺序：`tsc` → 三产物 → `verify-build-markers` → `test:offline` → CDP 子集；**大面积 UI 行为改动收口必跑全量 CDP**。
9. CDP 成片 / 单点失败先分三类：真回归 / 断言过宽（假阳性）/ 夹具偶发（重跑一次即过）；夹具超时先清端口 34177 残留再判定。
10. **改完立刻复核落盘结果**（`git diff` 看那一段 / `node --check` / `tsc`）：文本替换可能只落下部分字符——实测一次字符串引号被吃掉 ⇒ 测试文件语法错误、整条链在最尾部炸掉，白跑一轮。
11. **文档里的"数字事实"（文件数 / 节点数 / 计数）要么不写、要么配闸门**：README 的「离线回归套件（N 个文件）」曾漂到 46（实际 52），现已由 `check-readme.test.mjs` 第 ⑥ 项与 `package.json#test:offline` 自动比对（A/B 反证过：链里删一个文件 ⇒ 中英两处同时报错）。
12. **把"只服务单文件"的闸门脚本扩用到别的文件之前，先看它有没有隐含假设**：`check-readme.test.mjs` 原先那条「围栏总数是奇数 ⇒ 报错」实际拿**块数**判奇偶 ⇒ 任何**只有 1 个代码块**的文档都假红（README 恰好 16 块＝偶数才没暴露），一拿去校验 `RUNTIME_SETUP.md`（1 块）就现形。已删该判据（配平由"扫完仍在围栏内"兜住），并 A/B 反证：造一个未闭合围栏的文件 ⇒ 仍精确报错。

## 8. 交付流程

1. **版本标记每轮升位**：宿主＝`src/index.ts` 的 `loaded (host v…)`；客户端＝`src/client/index.tsx` 的 `CLIENT_VERSION` 常量（唯一出处）。
2. **生效条件**：改宿主 ⇒ 重启 `dsh web`；只改客户端 ⇒ 硬刷新；只改文档 / 工作流 JSON / 运行时脚本 / 测试 ⇒ 都不用。`dist/` 不入库 ⇒ 回退 src 不会回退产物。
3. 每轮交付给齐：**版本标记 + 生效方式 + 「我已验证 / 需你真机验证」清单 + 附带变更单列**。
4. 交付说明区分「已修 / 建议未动（等拍板）/ 已核过但判定不算问题」三段；建议项要给**带推荐的结构化选项**（先核实事实 → 每项代价量化 → 推荐项排第一 → 一次问完让用户点选）。
5. 审查类任务：审查对象是**当前未提交的完整 diff**（这样"修复本身"也在审查面内）；修复后要有第二轮审查或自审。
6. **交付说明里凡涉及"机制断言"（会不会下载 / 写盘 / 联网 / 要不要重启）都要当场实测或读实现确认**，不许照抄注释、设计意图或旧文档。2026-10-18 实测教训：把 `ensureEngine()` 的设计意图（"引擎缺失时按需下载"）当成真机行为写进交付说明与版本注记，用户一句「不是已经放到 runtime 文件夹里了吗」就推翻——win-x64 的引擎（257MB / 3662 文件）其实**随包内置**（`package.json#files` 含 `runtime`），根本不会下载。★凡这类断言，交付前跑一次实测（本轮：内置 Python `import` 校验 + 真识别一张图，1.9s）。

## 9. 收工纪律（别弄脏用户的机器）

1. 手工跑内置解释器一律带 `PYTHONDONTWRITEBYTECODE=1`；自检脚本要有 `__main__` 守卫、`DSH_HOME` 指向临时目录。
2. 测试临时数据根走 `test/_tmp-root.mjs` 的 `tmpRoot(tag)`（退出即回收）；只查不删用 `npm run tmp:prune`（dry-run 默认）。
3. **收工必查**：`git status`、真实数据根 / TEMP 是否新生文件、残留无头浏览器（命令行含 `df-cdp-`）与 `$env:TEMP\df-cdp-*`（只清这些，别碰用户自己的浏览器）。
4. `tmp-test/` 是 gitignore 的：改它里面的文件**先留临时副本**（没有 git 回滚路径；批量替换要"写回前校验每个 old 命中数 ==1"）。
5. 真机 `runs/` 不擅自批量删；**改用户工作流**只走「盘点 → 带自检的 patch（默认 dry-run，`--apply` 才备份 → 写 → 读回 sha256）→ 彩排 → 单文件装 → 真机只读自检」。

## 10. 每次修改的检查清单

动手前：
- [ ] 读懂现有实现与它的契约（含 `@ts-nocheck` 文件——`tsc` 对它们零保护）
- [ ] **grep 出谁在用它**：类名 / 文案片段 / markers 与测试里的**字符串片段**／文档
- [ ] 判定这是"新功能（加法）"还是"行为变更（必须单列并说清影响面）"
- [ ] 需要新形态 / 新交互 ⇒ 先出原型或按用户给的形态做，不自行发挥

动手时：
- [ ] 收在最小范围（该节点 / 该组件内部）
- [ ] 纯逻辑下沉到 `util/` 或独立纯模块（可离线单测）
- [ ] 文案走第 5 节、UI 走第 4 节、参数设计走第 6 节
- [ ] 改的是**默认值** ⇒ 同步 `NODE_PALETTE.defaultParams`，并补一条"新节点默认值"断言
- [ ] 同一信息只有一处出处（没有"两份必须同步"的新增）

收口时：
- [ ] `tsc` 0 错 → 三产物重建 → `verify-build-markers` → `test:offline` → CDP（大面积改动跑全量）
- [ ] 新增 / 改动的行为都有**能失败的断言**，且新测试已进离线链
- [ ] 版本标记升位（宿主与客户端各自）
- [ ] 交付四件套：版本标记 + 生效方式 + 我已验证 / 需你真机验证 + 附带变更单列
- [ ] 一行 commit 总结 + 未跟踪新文件清单
