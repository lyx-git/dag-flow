// @ts-nocheck
// src/client/index.tsx
// DSH 客户端入口：暴露 apply(ctx)。
//
// bundle 协议：window.__ModuleLoader__.load({ id, factory: (require) => ... })
// factory 返回 module.exports，DSH loader 自动调 module.exports.apply(ctx)。
// （协议 banner/footer 在 scripts/build-client.mjs——客户端防腐点清单见 src/client/dsh-gate.ts）
//
// v20261004-sched-cleanup：**定时任务弹窗交互改造**（2026-10-04 用户原话：「定时任务弹窗里面，修改cron表达式
//   是自动生效的，增加一个保存，修改按钮，手动确认生效，启用按钮不要使用勾选的方式，一些我能筛选的方案，让我自己选」）。
//   ① **cron 改手动确认**：敲键只改**草稿**（输入框描黄边 + 行内「● cron 已修改，点「保存」才生效」+「保存」高亮），
//      点行内「保存」（或回车）才落盘；非法表达式时「保存」禁用并显示红字原因；预览按草稿算（所见即所存）。
//      原来的 1.2s 防抖自动保存**不再用于 cron**（patchScheduleLocal 的 debounce 能力保留备用）。
//   ② **启用/停用不再用勾选框**：改成单按钮切换（用户从两轮候选里选定图标 **● 启用中 / ○ 已停用**），
//      点一下即生效（用户同轮确认：它本身就是明确动作，不需要再点保存）。
//   ③ **未保存就关弹窗 → 直接放弃 + 浮层提示**（用户当天改口：「未保存关闭直接放弃，给个提示就行，不用弹窗处理，
//      上轮做的弹窗，是因为我点错了，删掉就行」）——关闭即丢弃草稿并关窗，只在底部浮层提示「未保存的 cron 改动已丢弃」；
//      ★当天早些时候那版「二次确认弹窗」已**整体删除**（不弹窗、也不用 window.confirm）。草稿不跨次保留。
//   ④ **清掉随之变成死代码的防抖保存**（用户 2026-10-04 拍板"删掉"）：`patchScheduleLocal` 的 `opts.debounce`
//      参数 + `if (!opts.debounce)` 分支 + `schedTimers` ref 一并删除，它现在只做"立即落盘"；
//      顺带把已不使用的 `schedItems` 从 useCallback 依赖里去掉（函数体只读 `schedItemsRef`）。
//      删它的理由：无调用方、无用例覆盖、且它正是那个"开关闪回"竞态的载体（快照在注册防抖时取、1.2s 后才发）。
//      将来若真要防抖，必须**在触发时**重读 `schedItemsRef.current`。
//
// v20261004-nosettings：**删掉设置页「工作流配置」分区**（2026-10-04 用户原话：「工作流配置设置页面，
//   直接删掉吧，已经没啥用了」）。该分区自 09-25 模型/密钥配置移除后只剩「🎨 画布主题」下拉 + 一行说明，
//   是旧功能的残壳。删除：registerSettingsSection 调用 + src/client/SettingsPage.tsx + 它的 re-export + 死 CSS。
//   ★副作用（已 ask_user_question 讲清并获确认后执行）：画布主题从此**没有界面入口**，固定在 localStorage
//   里已保存的值（默认 nodeflow 深空蓝）；theme.ts 与启动时的 applyTheme(getThemeMode()) 保留不动。
//   ★防腐层 dsh-gate.ts 的 registerSettingsSection 能力**保留**（不再被调用，作为 ACL 能力位备用）。
// v20261004-text-width：**纯文本星号 + 弹窗宽度规则失效**（2026-10-04，用户：「顺手发现、按红线没动手的
//   两件事，这两件事都统一修掉」）。
//   ① 用户可见文案里的 Markdown `**` 会被**原样渲染**（同一坑第三次复发）：FlowPanel 的 ⏰ 弹窗底部
//      「cron 为**本机时区**的」、loop 面板「**不会重复执行下游节点**」，以及 host 侧 selfcheck.ts 的
//      SOURCE_SKIP_SILENT 消息「整轮却仍显示**成功**」——全部去掉 `**`（强调改用「」）。
//      回归锁：selfcheck.test.mjs N6b（消息不含 `**`）+ CDP 三处（定时弹窗/版本弹窗/loop 面板的可见文案不含 `**`）。
//   ② 弹窗宽度规则**集体失效**：`.dag-flow-picker { width: 680px }` 由 workflow-picker.ts 的 PICKER_CSS
//      **运行时注入**（位置在 styles.css 之后），与 `.dsh-wf-sched` 这类规则**同权重（0,1,0）**→ 后到者胜
//      → 定时 720 / 确认 460 / 自检 620 / 日志 920 四条宽度全部被压成 680。修法=提权成
//      `.dag-flow-picker.dsh-wf-xxx`（0,2,0）。回归锁：CDP 四处实测宽度（720 / 460 / 620 / 920）
//      + 版本弹窗仍 680（确认没有外溢）。
//
// v20261004-verpos：🕘 历史版本弹窗落点与 ⏰ 定时任务弹窗对齐（2026-10-04 用户：「历史版本按钮的弹窗，
//   有点偏中下部了，最好弹窗和定时任务弹窗保持一致」）——删掉 overlay 上的内联底部锚定
//   （alignItems:'flex-end' + paddingBottom:'8vh'），改用 overlay 默认的顶部锚定 14vh；
//   「拖上边缘时顶边跟随光标」的手感由新增的 verOff 偏移保留（marginTop:-verOff，每次打开归零）。
//
// v20261004-selfcheck1：**运行前自检（轮 1）**（2026-10-04 用户拍板：「分多轮实现，每轮实现不同的自检，
//   不用输出报告，运行前自动检查，自检出问题，给出报错提示和解决办法并拦工作流做人工确认」）。
//   ① 判据唯一真源：新增 `src/executor/selfcheck.ts`（纯函数，永不抛）。轮 1 查四类：结构/引用
//      （复用 parseAndValidate 转成分级项）、**模板引用前缀指向不存在的节点**（REF_UNKNOWN）、
//      从 start 不可达（UNREACHABLE，warn 不拦）、环路（CYCLE，提示"要回跳重试用 loop 循环体"）。
//      每条都带 `fix`＝**解决办法**（用户明确要求）。
//   ② host `/run` 执行前自动跑：有 error → **409 { blocked:true, selfcheck }** 拦下（warn 不拦）；
//      带 `skipSelfcheck:true` 重发即放行（= 人工确认）。★契约变更：非法 def 以前 500，现在 409+问题清单。
//   ③ 客户端：「⚠ 运行前自检未通过（N 项）」弹窗，逐条 报错提示 +「👉 解决办法」、可点击定位节点，
//      底部**只有「✕ 去修改」**（★2026-10-08 用户收严：不提供"仍然运行"旁路，自检不通过就必须去改）。
//   后续轮次：轮 2 参数必填/分支键/switch 一致性/goto；轮 3 loop 边界/merge/subflow 依赖/模型存在性；轮 4 建议类。
// v20261004-failchip-drag：两项"可选增强"落地（2026-10-04 用户：「可选的增强（fail 边显形、拖拽 CDP 用例
//   做稳），处理下」）。
//   ① **fail 策略显形**：失败策略此前只在右侧面板的下拉里（goto 更是个"看不见的跳转"）。现在
//      FlowPanel 把 def 里的策略同步进 `flowgram/failPolicyStore`，画布卡片底部显示一枚小 chip：
//      ⏭ 跳过支路（青）/ 🛟 忽略失败（绿）/ ↪ 失败→<目标名>（紫）；**默认「停止这条支路」不显示**（不制造噪音）；
//      chip 的 title 写明确切语义。★没做"一条红色虚线 fail 边"：goto 是执行器的**失败边**、不在 def.edges 里，
//      真写进 edges 会被当普通边无条件激活（改变语义），自绘非文档边则要自己跟随缩放/平移，风险远大于收益。
//   ② **拖拽 CDP 用例做稳**：三个长期间歇失败的用例改用 **CDP 真实鼠标输入**（`Input.dispatchMouseEvent`，
//      driver 新增 mouseMove/mouseHover/mouseDown/mouseUp/dragMouse）——旧写法在页面里合成 MouseEvent，
//      与 playground 的 hover/拖拽状态机时序对不上（"hover 没起线"）；dragMouse 还**从旁边接近端口**再按下
//      （同坐标重复移动可能被合并成 no-op）。`branch-labels` 不是拖拽用例，它的抖动来自"点标签后编辑器没开
//      就抛错" → 改成容忍落空 + 整体重试一轮。实测三案各连续 3 次全过。
// v20261004-sched-inline：⏰ 定时任务弹窗两处交互修正（2026-10-04 用户原话：「定时任务的立即运行一次，
//   是 windows 弹窗，给出修改；另外立即运行一次按钮不要放在第二行，放在 corn 表达式右边」）。
//   ① 二次确认从 `window.confirm`（Windows 原生弹窗）改成**应用内确认弹窗**：与其它弹窗同一套约定
//      （右上 ✕、hint 小字浅色、底部左「✕ 取消」右「▶ 确认运行」），写明费用提醒 / 执行期间不等人确认 /
//      「不影响定时档期，下次仍按 <cron 中文预览> 触发」；**确认前不发请求**。
//   ②「▶ 立即运行一次」从独立的第二行（.dsh-wf-sched-actions）挪进 cron 那一行、紧贴输入框右侧
//      （紧凑次级按钮 .dsh-wf-sched-run）。
// v20261004-sweep：**轮 5 清尾**（2026-10-04）——四轮合并的收尾：性能 / 便利性 / 老数据适配。
//   ① 性能：DAG 跳过判定加"内容版本号"短路 + 预计算入/出边键 → 2000 节点链 772ms→24ms、
//      4002 节点菱形 4356ms→45ms、失败传播链 5003ms→48ms（基准脚本 tmp-test/bench-executor.mjs）。
//   ② 便利性：问题面板新增「失败后跳转的目标在本节点之前 → 不会生效」warn（goto 只对还没跑到的层生效）。
//   ③ 修 bug：画布 util/flowDef 的 fromRF 原来**按字段白名单**重建节点 → `tolerate`（面板「忽略失败」）
//      会在任何一次画布编辑后被静默丢掉；改成"以模板节点为基础覆盖"，未登记字段也保留。
//   ④ 老工作流适配：数字节点 id 规范化、回跳 goto/cfg:continue 等死配置清理、switch cases 与出边对齐
//      （数据修正，不涉及插件代码）。
// v20261004-goto-edge：**失败后跳转（onError.goto）进 DAG**（2026-10-04 轮 3）——失败策略四档补齐。
//   ① 引擎：节点失败且未容错、策略为 goto 时，跳过本节点的下游 → 跳到目标节点继续（**失败边**）。
//      ★ 目标**只执行一次**：目标若排在源节点之前（已执行/已过它那一层），跳转不生效、按「停止这条支路」
//      处理，并把原因写进该节点的错误消息（悬浮卡/失败详情能看到「未重复执行」，不静默）。
//      实现上把"跳过判定"改成**每层从零重算**（hardDead 是唯一事实来源），goto 只要把目标放进
//      gotoTargets 就能"复活"一个本来会被跳过的节点，级联自动重算干净（增量累加做不到这点）。
//   ② 面板：「🛟 本节点失败后」补第 4 项「↪ 失败后跳转到指定节点」（选中即出现「↪ 跳转目标」行）；
//      目标下拉里**排在本节点之前**的候选会标注「⚠ 在本节点之前执行，跳转不会生效」。
// v20261004-fail-policy：**失败策略合一 + 引擎侧真生效**（2026-10-04 轮 2，用户原话：「开始轮 2 实现，
//   画布右侧编辑页面的失败策略和失败后不影响流程，这两个配置要合并到一起，避免歧义」）。
//   ① 面板：两个入口（🛟 失败策略 select + 🛟 失败不影响流程 checkbox）合并成**唯一一个**「🛟 本节点失败后」下拉，
//      三项互斥、写入时清掉另一个字段（零数据迁移，底层仍是 onError / tolerate 两个旧字段）：
//        ⛔ 停止这条支路（默认，算运行失败）= onError:'stop'
//        ⏭ 跳过这条支路，不算运行失败       = onError:'continue'（下游不走 + 不计失败）
//        🛟 忽略失败，下游照常执行           = tolerate:true（下游照常 + 不计失败）
//      旧数据若已设 goto，显示为只读的当前项（引擎支持待轮 3）。
//   ② 引擎：DAG 执行器开始读失败策略，语义 = **只停该节点的下游，其它分支继续**（旧实现是全图停）。
// v20261003-autopass-visible：**非交互运行下 manual 节点被自动放行，这件事要显形**（用户真机反馈原话：
//   「定时任务自动触发的运行，手动确认节点自动跳过」）。核实结论：这是**设计如此**（非交互 = 没人能确认，
//   定时触发 / 「立即运行一次」/ CLI / 子工作流内部一律自动通过，out.autoPassed=true + 宿主 warning 日志），
//   但此前界面上完全看不出来——节点卡只看得出「成功」，用户会以为有人确认过。
//   用户拍板 **A 方案：保持自动通过，但把它「显形」**（否掉 B 挡住不跑 / C 改成真暂停等待）。
//   落地（纯客户端，宿主未改）：①节点悬浮卡徽标加青色「⏭ 自动通过」（.is-auto）；②悬浮卡加一行说明
//   「这次是非交互运行，没人能确认，manual 节点被直接放行——不是失败，也不代表有人确认过」；
//   ③⏰ 定时任务弹窗在「本工作流含 N 个手动确认节点」时加一行提示，说明定时跑时会自动通过。
// v20261003-sched-visible：定时运行的**界面可见性**（用户真机反馈原话：「定时任务执行，工作流的状态不会变化」）。
//   根因：逐节点状态轮询只挂在「手动点运行」那条路径上，而定时触发是宿主调度器直接调 runWorkflow ——
//   既没登记进 /run/status 的表，客户端也无从知道，于是画布不点亮、头部无运行态。
//   修法（两层）：①宿主把定时运行登记到与手动运行**同一张表**（src/adapter/runRegistry.ts，带 origin:'schedule'），
//   运行结束后按工作流名保留「最近一次完成」，让 /run/status?name= 能回退给客户端收敛终态；
//   ②客户端加**后台监视器**：面板挂载期间轮询 /run/status?name=<当前工作流>（空闲 2.5s / 检测到在跑切 600ms），
//   任何来源的运行都点亮画布与头部运行态，跑完自动收敛；手动运行期间让位（manualRunRef）避免两套轮询互抢；
//   ⏰ 弹窗开着时，跑完顺手刷新「上次/下次」。附带：定时运行现在也能被「⏹ 取消」（走同一张表）。
// v20261003-scheduler：定时任务弹窗（用户原话：「之前的定时任务方案，实行了」；方案见 docs/SCHEDULE-PLAN.md，
//   5 项决策此前已全部拍板）。客户端只做配置 UI + 状态显示：头部 ⏰ 按钮 → 「⏰ 定时任务」弹窗（黄色费用提示 /
//   调度器心跳 / 每条 cron 输入 + 中文预览 + 启用开关 + 行尾删除 + 上次·下次时间 + ▶ 立即运行一次 / 底部虚线 ＋ 添加）。
//   cron 校验与中文预览直接复用宿主同一个纯模块 src/adapter/cron.ts（面板预览与宿主执行同一套语义）；
//   改动即自动保存（cron 输入 1.2s 防抖；非法 cron 本地就不发请求、只显示红字）；「立即运行一次」二次确认。
// v20261003-copy-toast：变量复制反馈改浮窗（用户 2026-10-03 原话：「画布的右侧编辑画板里面，上游变量复制和输出变量复制，
//   提示信息，改为浮窗提示：已复制xxxx」）——原实现是在面板底部补一行行内小字（`.dsh-wf-panel-hint`「已复制：xxx」），
//   面板一长就得往下找、还占版面。现在：Portal 到 document.body 的 fixed 浮窗 `.dsh-wf-copy-toast`（底部居中、
//   入场轻微上浮、约 1.6s 自动消失、`pointer-events:none` 不挡操作），文案「📋 已复制 <复制到的变量引用>」。
//   状态用 `{text,n}` 记次数：连点同一个 chip 也能重新弹出（只存字符串时 React 不重渲染、计时器不重置）。
//   作用范围仅「上游变量 / 本节点输出 / 全局变量」三组 chip 的复制反馈；节点悬浮卡的复制按钮（nodes.tsx 的
//   「✓ 已复制」）与失败详情弹窗的复制提示不在本次范围内，未改。
// v20261003-view-zoom：画布视图控件（用户 2026-10-03 原话：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，
//   画布上的节点太小了，无法看清，最好可以一键放大缩小，方便修改」）——根因：onAllLayersRendered 里**每次渲染都
//   fitView**，大图被硬塞进视口（~30%），节点看不清；而且「适应画布」按钮与这个自动行为重复，所以"没啥用"。
//   ①进画布只设一次初始视图：自适应但夹在 [75%,100%]，**取景保持原样 = 整图内容居中**，此后不再自动改视图
//     （用户自己缩放/拖动后不会被抢回去）；
//   ②「⤢ 适应画布」只由点击触发，缩放下限 50%（大图仍能一键看全貌）；
//   ③「−/＋」按档位一键放大缩小（25/50/75/100/125/150/200%），百分比读数可点 = 「1:1」= 一键回 100%；
//     缩放围绕**当前视口中心**，视觉上不跳。
//   ★ 2026-10-03 用户指示「70%挡位改为75%」：可读下限与档位表一起改（否则进画布那一刻的缩放不在档位上）。
//   ★ 踩坑（真机回归）：初版把居中目标写成起始节点（nodeBounds(start)），等于把整张图往右推——右半边被插件
//     自己的右侧检查器面板（.dsh-wf-right，absolute 浮层）盖住，端口点 elementFromPoint 命中面板，连拖线都
//     起不来（CDP switch-chips 3/3 挂）。改为整图内容居中后恢复。
// v20261003-switch-chips：switch 分支键改「横排 chips」（用户 2026-10-03 反馈：截图里 quick/full/video/image/
//   其他 五个键在卡内**逐行竖着堆**，「很别扭，也会遮挡」→ 原型三选一后拍板 A）。三档策略（端口位置与连线
//   行为一律不变，全部出自同一个 `switchLayout()`）：
//     ≤3 个 case：`labels` 逐行标签（保持原行为，行数少不别扭）
//     4~6 个    ：`chips` 端口行只留极淡序号 ①②③…（右侧与端口同高），分支键**横排成一行 chips** 贴在
//                卡片底部做图例（`1·quick` `2·full` … `★其他`），悬停 chip → 对应行序号高亮放大，拖线不认错；
//                 行距 30→16px、端口起点仍是 22px，5 个 case 卡高 166→**136px**
//     ≥7 个     ：`tight` 行距 12px + 卡内不留字（20 个 case 时 chips 会换很多行，故不启用）
//   ★ 为什么 chips 在底部而不是标题下：实测卡片头部（图标+标题+类型+副标题）本身 ~80px，chips 若放标题下、
//     端口就得整体下移到 112px 起，卡片反而从 166px 涨到 192px（「优化」把节点撑更高，被否）。放底部做图例后
//     端口仍从 22px 起，卡片反而更矮。
// v20261003-loop-jump：子工作流跳转（用户 2026-10-03 原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点
//   可以直接跳到子工作流里面，子工作流也可以一键切回到父工作流的循环节点」）——用户拍板：返回入口用
//   **header 返回胶囊 + 面包屑**（变体 A），适用范围 **loop（循环体）+ subflow（引用的子工作流）**。
//   ① 双击节点 → FlowGramCanvas 的原生 dblclick（此前双击无绑定）→ FlowPanel 判定：
//      loop 取 `params.body.workflowName`、subflow 取 `params.workflowName`，为空则提示「还没选」；
//   ② 跳转前先把当前工作流 flush 一次（重挂载会清掉 2s 防抖计时器，不 flush 会丢盘上最新状态）；
//   ③ 导航栈/守卫/错误提示在 src/client/navStack.ts（**与 CDP 夹具共用同一份逻辑**，夹具只模拟「换 def」）；
//      栈里存**父 def 快照**（含未保存编辑）+ 来源节点 id，返回时原样恢复并**重新选中那个循环节点**；
//   ④ 守卫：未选子工作流 / 子工作流不存在（404）/ 自引用 / 会成环 → 只出提示不跳转。
// v20261003-model-label-top：模型下拉「重进就定位到已选模型」+「已选项带选中标记」（用户 2026-10-03 反馈：
//   重进下拉选没有自动定位到已选择的模型；补充口径：点开下拉时已选中的那条要有一个选中状态标记它，
//   没有已选模型时则任何项都不带标记）——①已选中的那条**挪到列表最前**（紧跟占位项），原生 select 展开即在
//   最上面，不用翻几十条；只调顺序、不复制、不改 value；②当前已选那条的文案前加 **`✓ `**（含「存值不在当前
//   列表」的 `✓ ⚠ …（当前值）` 那条）——原生 option 不能设背景/图标，只能用文案前缀，且它在展开列表与收起
//   显示里都会出现；未选任何模型时（selectedModel===''）任何一项都不带 ✓；③同一个节点被换掉 def 时（换工作流/
//   撤销/别处编辑）用一个 effect 把下拉 value 同步回 def（组件按 node.id 加了 key，切节点会重挂载，换 def 不会）。
// v20261003-model-label：AI 节点模型下拉显示**显示名**（用户 2026-10-03 原话：「ai子代理节点里面的选择模型，
//   最好是改成下拉选显示名称改成模型显示名称，不用模型id，不容易分辨，代码里面可以用模型id确定调用的模型」）。
//   option 文案 = 宿主 llm listModels 给的显示名（deepseek-flash → DeepSeek-V41-Flash），同名时补 provider
//   显示名消歧，宿主没给显示名时回退 model id；**option 的 value 仍是 id**（存值/执行不变），下拉下方细字
//   始终给出「执行 id」便于对照 JSON。旧工作流存了列表里没有的 id 时仍按原样显式列出（行为不变）。
// v20261003-loop-body：循环体 = 子工作流（用户拍板方案 A：能复用就复用，不自研）——loop 节点新增
//   `body:{workflowName, inputs}`，每轮按 `{{vars.loopItem}}`（当轮的项/轮次序号）与 `{{vars.loopIndex}}`
//   解析 inputs 后调用该子工作流，**子工作流 end 节点的输出依次收进 `loop.out.items`**——下游写法与无 body 时
//   完全一致（`{{loop1.out.items}}` / `{{loop1.out.items.0.field}}` / `{{loop1.out.count}}`）。
//   `onIterationError:'continue'` 时失败轮写占位继续跑，默认 stop 则整节点失败但已完成轮次保留在 items 便于排查。
//   引擎侧：run.ts 对 loop 的 body **延迟解析**（body.inputs 里引用了每轮才存在的 loopItem/loopIndex，
//   运行前解析必 DATAFLOW_REF）；面板侧：右侧「🔁 循环设置」新增循环体下拉 + 输入映射 + 失败策略。
//   实现只扩 loop 的 run、复用 subflow 调用机制，不动 topoSort/DAG、不需要画布回边。
// v20261003-switch-compact：switch 分支过多把节点撑大、把流程拉散（用户 2026-10-03 反馈）——自适应紧凑
//   （用户拍板 A+A+）：case ≥ 7 时端口行距 30→12px、**卡内标签隐藏**（每条连线中点本来就有分支键标签，
//   信息不丢）、副标题显示「N 个分支」。端口是连线锚点不能隐藏，所以只压行距与卡内标签。
//   实测 20 个 case：卡片 646px → 286px（-56%），8 case 夹具 286→142px；≤6 个 case 行为完全不变（行距 30）。
// v20261003-loop-visible：loop 循环可见化（用户拍板 P1+P2+P3）——loop 此前在画布上「存在感缺失」
//   （卡片副标题只认 count，配了 over/while 就显示错的 `count=?`；出边与普通线无差别；参数只能去 JSON 改）。
//   P1 卡片副标题按**实际生效边界**显示（引擎优先级 over > count > while）：`循环 3 次` / `遍历 5 项` /
//      `遍历 {{上游.out.数组}}` / `while: 表达式` / `⚠ 无循环边界`，并带上 `· 上限 N`；count/while/over 全缺
//      时问题面板同时报 error（运行必 LOOP_NO_BOUND）。
//   P2 右侧面板新增「🔁 循环设置」区（对齐 switch「🔀 分支设置」）：边界类型下拉 + 对应输入框 + 最大迭代
//      次数 + while 的 dangerouslyAllowInfinite 开关；切换类型时清掉其余两种边界（避免"以为生效其实没生效"）。
//   P3 画布循环标记：loop 出边中点挂紫色「循环」小标（明示下游只执行一次），运行后节点徽标追加
//      `· 循环 N 次`（取自 out.count，落 runStatusStore 的 count 字段）。
// v20261003-branch-fix：修「switch 在线上改分支键：切不回原 case、切换很慢」——根因是改键走
//   DefSync 整文档 fromJSON 重建，而 FlowGram 对被替换掉的线回收不完整：每次编辑都在画布上留一条
//   带旧分支键的幽灵线（实测 8→9→10），看着像"没切过去"，线越积越多还越来越慢。修法：
//   ①改键主路径改为**就地改线**（line.updateInfo → rebindLinePorts + fireChange，官方拖线重连内部走它），
//     并把新 sig 标记为「画布自己产生的变更」让 DefSync 跳过重建 → def 1-6ms、画布标签 3-60ms、无残留；
//   ②DefSync 重建前先 dispose「不在目标边集合里」的现存线——兜住新建 case 等仍走重建的路径，
//     也顺带修掉历史上任何结构变更残留的幽灵线。
// v20261003-branch-edit：分支键就地编辑（方案 C）+ 微调——连线中点的分支标签可点击，在锚点处
//   弹出小面板直接选/改/清空分支键（switch 输入新 case 名会同时写进节点 params.cases 并指向本线目标）；
//   if/switch 的出边若没有分支键 → 琥珀虚线「未设分支」告警 + 问题面板同时列出（执行器对这种线按恒激活，
//   即所有分支都会跑）；标签文案改口语「真/假/其他」（原始键名放 title）；switch 卡随分支数自动增高。
// v20261003-branch-labels：分支条件在画布上显形（用户需求 B）——连线中点显示分支键标签
//   （if: true/false，switch: case 名，'*' → 其他）+ true 绿 / false 红描边（走 free-lines-plugin
//   的 renderInsideLine / customLineProps，singleton 覆盖预设空实例）；节点卡右侧给每个输出
//   端口加同高标签（top = 22 + i*30，与 formMeta 的 locationConfig 对齐）。
// v20261003-picker-path：「打开/新建工作流」下拉里，每个工作流名称后置灰显示它的落盘路径
//   （GET /workflows 每项新增 path 字段；路径跟随目录分隔符、单行省略、完整值放 title；
//    复制出的新行也按 storage.dir 推算路径）。
// v20261003-manual-confirm：manual（手动确认）节点从 v0.1 空壳改为真暂停 + 恢复——
//   POST /run 撞上 manual → 202 { status:'awaiting', runId, awaiting }（不 hold 连接），
//   客户端头部 ⏸ 徽标 + 确认弹窗（底部左「✕ 取消本次运行」右「✓ 确认并继续」，右上 ✕ 只关弹窗），
//   备注经 POST /run/resume 进入 out.value 供下游 {{节点id.out.value}} 取用；
//   GET /run/status 支持刷新后恢复等待态；非交互路径（CLI 工具/subflow 内部）自动通过 + warning。
// v20261002-next-map：分支键 next（if 的 {true,false} / switch 的 { case值: 目标 }）收编为
//   WORKFLOW_SCHEMA.next.oneOf 的单个 object 分支——原来 host schema 只认 {true,false}，
//   画布 fromRF 每次保存都在产 case 映射 → 保存过的 switch 工作流全部报「结构校验未通过」。
//   客户端 JsonView 的精简 schema 同步对齐；校验报错折叠成一条并带「显示名_id(类型)」。
// v20261002-acl1：slots/layout 宿主形状假设收编 src/client/dsh-gate.ts（客户端防腐层）——
//   DSH 客户端升版改 slots/layout API 时只改那边；本文件只做业务编排。
//   之前版本在这里吃过的亏：inject 了宿主没有的服务 → 抛错被 mountContribution
//   路径 catch 不住 → 整个插件静默失败（v0.3→v0.4 教训，已固化为防腐层探测）。

import { Component, createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlowPanel } from './FlowPanel';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';
import { applyTheme, getThemeMode } from './theme';
import { mountSidebarEntry } from './sidebar';
import { openWorkflowPicker } from './workflow-picker';
// 子工作流导航（2026-10-03 用户需求）：栈/守卫在 navStack.ts，与 CDP 夹具共用同一份逻辑
import { bindNavSwap, backToParentWorkflow, enterSubWorkflow, navCrumbs, navCurrentName, navFocusNodeId, setNavCurrent } from './navStack';
import {
  CLIENT_INJECT,
  registerMainPanel,
  dumpMainPanelKeys,
  selectPanel as gateSelectPanel,
  type ClientHost,
} from './dsh-gate';
import './styles.css'; // ★ 注入插件独立主题样式（esbuild dsh-css-inject 转运行时 <style>）

let activeRoot: Root | null = null;
let activeEl: HTMLElement | null = null;

// ==================== 窗口化面板（legacy，2026-10-01 起默认停靠模式，入口不再调用） ====================
// 缓存键：停靠模式的「内容缓存」（切换回会话保留，重开继续编辑）
const WF_CACHE_KEY = 'dag-flow:def-cache';

interface WinState {
  el: HTMLElement;
  titleBar: HTMLElement;
  body: HTMLElement;
  mode: 'normal' | 'max' | 'min';
  pos: { x: number; y: number };
  size: { w: number; h: number };
}
let win: WinState | null = null;

function clearCache(): void {
  try { localStorage.removeItem(WF_CACHE_KEY); } catch { /* 忽略 */ }
}

function makeWinBtn(text: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `dsh-wf-win-btn${cls ? ' ' + cls : ''}`;
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function applyWinLayout(): void {
  if (!win) return;
  const { el, body, mode, pos, size } = win;
  if (mode === 'min') {
    // 最小化：左下角小标签，只留标题栏
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;width:220px;height:38px;z-index:9999;min-width:0;min-height:0;';
    body.style.display = 'none';
    el.classList.add('dsh-wf-win-min');
  } else if (mode === 'max') {
    el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;';
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  } else {
    el.style.cssText = `position:fixed;left:${pos.x}px;top:${pos.y}px;width:${size.w}px;height:${size.h}px;z-index:9999;`;
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  }
}

function minimizeWin(): void { if (win) { win.mode = 'min'; applyWinLayout(); } }
function toggleMaxWin(): void {
  if (!win) return;
  win.mode = win.mode === 'max' ? 'normal' : 'max';
  applyWinLayout();
}
function restoreFromMin(): void { if (win && win.mode === 'min') { win.mode = 'normal'; applyWinLayout(); } }

function closeWin(): void {
  if (!win) return;
  // 关闭面板即清空未保存数据（重新打开需重新做工作流再保存）
  clearCache();
  unmount();
  win.el.remove();
  win = null;
}

function openWorkflowWindow(initialDef?: WorkflowDef): void {
  // 已打开 → 恢复（最小化时回到正常）；若带 initialDef 则切换面板内容为新工作流
  if (win) {
    if (win.mode === 'min') restoreFromMin();
    win.el.style.zIndex = '9999';
    if (initialDef) mountWorkflowPanel(win.body, { workflow: initialDef });
    return;
  }
  const el = document.createElement('div');
  el.id = 'dag-flow-win';
  el.className = 'dsh-wf-win';

  // 标题栏（可拖拽）
  const titleBar = document.createElement('div');
  titleBar.className = 'dsh-wf-win-titlebar';
  const title = document.createElement('span');
  title.className = 'dsh-wf-win-title';
  title.textContent = '⚡ 自定义工作流';
  const btns = document.createElement('div');
  btns.className = 'dsh-wf-win-btns';
  btns.appendChild(makeWinBtn('—', '最小化', minimizeWin));
  btns.appendChild(makeWinBtn('▢', '最大化 / 还原', toggleMaxWin));
  btns.appendChild(makeWinBtn('✕', '关闭（清缓存）', closeWin, 'dsh-wf-win-btn-close'));
  titleBar.appendChild(title);
  titleBar.appendChild(btns);

  // 内容区（React 挂载 FlowPanel）
  const body = document.createElement('div');
  body.className = 'dsh-wf-win-body';

  el.appendChild(titleBar);
  el.appendChild(body);
  document.body.appendChild(el);

  // 中等大小：居中 780×560
  const W = Math.min(780, window.innerWidth - 60);
  const H = Math.min(560, window.innerHeight - 80);
  win = {
    el, titleBar, body,
    mode: 'normal',
    pos: { x: Math.max(8, Math.round((window.innerWidth - W) / 2)), y: Math.max(8, Math.round((window.innerHeight - H) / 2)) },
    size: { w: W, h: H },
  };
  applyWinLayout();

  // 标题栏拖拽移动
  let dragging = false;
  let offX = 0; let offY = 0;
  titleBar.addEventListener('mousedown', (e: MouseEvent) => {
    if (win!.mode === 'max' || win!.mode === 'min') return;
    dragging = true;
    offX = e.clientX - win!.pos.x;
    offY = e.clientY - win!.pos.y;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging || !win || win.mode !== 'normal') return;
    win.pos.x = Math.max(0, e.clientX - offX);
    win.pos.y = Math.max(0, e.clientY - offY);
    applyWinLayout();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  // 双击标题栏最大化
  titleBar.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dsh-wf-win-btns')) return;
    toggleMaxWin();
  });

  // 挂载 FlowPanel（带 initialDef = 从弹窗选定的/新建的工作流；无则用默认工作流）
  mountWorkflowPanel(body, { workflow: initialDef });
}

function mountWorkflowPanel(target: HTMLElement, opts: any = {}): void {
  if (activeRoot) unmount();
  activeEl = target;
  activeRoot = createRoot(target);
  // 兜底：opts 为空对象时注入默认工作流，避免 FlowPanel 白屏
  const ctx = { ...opts, workflow: opts.workflow ?? DEFAULT_WORKFLOW };
  activeRoot.render(
    createElement(FlowPanel, {
      ctx,
      onMount: () => {},
      onClose: opts.onClose ?? (() => closeWin()),
      onCache: opts.onCache,
    })
  );
}

function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeEl) {
    activeEl.innerHTML = '';
    activeEl = null;
  }
}

// inject 名单唯一来源 = 客户端防腐层（slots=设置页分区/主区面板；layout=面板切换）
export const inject: string[] = CLIENT_INJECT;

// ==================== 停靠模式（2026-10-01）：画布进驻 DSH 中央面板 ====================
// 依据 live Slots 树：`main` 是 keyed slot（"Central panel selected by sidebar entry id"，
// 已占用 key: conversation，开放域可注册新 key）——注册 key='dag-flow' 的面板，点击
// 侧栏入口（sidebar.ts 自愈注入）即在会话区域位置展示画布。槽位注册/面板切换的
// DSH 形状假设全在 src/client/dsh-gate.ts（客户端防腐层）。

let hostCtx: ClientHost = null;
let dockOpenRequest: (() => void) | null = null;

// 停靠画布的 def 外置存储：FlowPanel onCache 静默同步（不触发重挂，保住内部编辑态）；
// 选择/新建/入口点击时 bump 版本号，让 DockedMainPanel 以新 def 重挂载。
let dockDef: WorkflowDef | null = null;
/** 从子工作流返回父工作流时要重新选中的节点（navStack 通过 bindNavSwap 回传） */
let dockFocusNodeId: string | null = null;
let dockVersion = 0;
const dockListeners = new Set<() => void>();

function readCacheDef(): WorkflowDef | null {
  try {
    const raw = localStorage.getItem(WF_CACHE_KEY);
    return raw ? (JSON.parse(raw) as WorkflowDef) : null;
  } catch { return null; }
}

function setDockDef(def: WorkflowDef, bump: boolean): void {
  dockDef = def;
  try { localStorage.setItem(WF_CACHE_KEY, JSON.stringify(def)); } catch { /* 忽略 */ }
  if (bump) { dockVersion++; dockListeners.forEach((l) => l()); }
}

function subscribeDock(listener: () => void): () => void {
  dockListeners.add(listener);
  return () => { dockListeners.delete(listener); };
}

// ================= 子工作流导航（2026-10-03 用户需求）=================
// 需求原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，
//          子工作流也可以一键切回到父工作流的循环节点」→ 用户拍板返回入口用「header 返回胶囊 + 面包屑」，
//          适用范围 loop（循环体）+ subflow（引用的子工作流）。
// 栈与守卫在 src/client/navStack.ts（与 CDP 夹具共用同一份真实逻辑）；这里只提供「换 def」能力：
// 停靠面板 bump 版本号重挂载 FlowPanel（与「打开已有工作流」同一条通路）。
bindNavSwap((def, focus) => {
  dockFocusNodeId = focus;
  setDockDef(def, true);
});

/** 回到会话面板（防腐层 selectPanel；layout 不可用时静默）。 */
function backToConversation(): void {
  gateSelectPanel(hostCtx, 'conversation');
}

/** 渲染错误的可视化边界：停靠面板出错时显示错误详情而非空白（方便真机排障） */
class DockErrorBoundary extends Component<{ children: any }, { error: Error | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[dag-flow] dock render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return createElement('div', { style: { padding: 20, color: '#f87171', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } },
        createElement('div', null, `停靠面板渲染失败：${String(this.state.error?.message ?? this.state.error)}`),
        createElement('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 10 } }, String(this.state.error?.stack ?? '')),
      );
    }
    return this.props.children;
  }
}

/** main 区的停靠面板：头部工具行 + 独立 React root 承载 FlowPanel。
 *  ★ 与 legacy 窗口模式同款挂载方式（createRoot 独立挂载，真机验证过）——
 *  在宿主 React 树内直接渲染 FlowPanel/FlowGram 会触发打包内 TDZ 崩溃
 *  （Cannot access 'o' before initialization，2026-10-01 真机实测）；
 *  dockVersion 变化时重挂以切换工作流。 */
function DockedMainPanel(): any {
  const bodyRef = useRef(null);
  useSyncExternalStore(subscribeDock, () => dockVersion);
  useEffect(() => {
    if (!bodyRef.current) return;
    const def = dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW;
    console.log('[dag-flow] dock mount v' + dockVersion, 'def=' + (def?.name ?? '(null)'));
    mountWorkflowPanel(bodyRef.current, {
      workflow: def,
      onCache: (d: WorkflowDef) => {
        setNavCurrent(d);              // 让导航栈知道当前 def（进入子工作流时要压「父 def 快照」）
        setDockDef(d, false);
      },
      onClose: () => backToConversation(),
      // 子工作流导航（loop 循环体 / subflow 目标）：进入 + 一键返回父工作流的来源节点
      nav: {
        crumbs: navCrumbs(),           // 从外到内的父链（不含当前）
        current: navCurrentName() || def.name || '',
        enter: enterSubWorkflow,
        back: backToParentWorkflow,
      },
      // 返回父工作流时要重新选中的节点（来源循环节点）；进入子工作流时为 null
      focusNodeId: navFocusNodeId(),
    });
    return () => { unmount(); };
  }, [dockVersion]);
  return createElement('div', { className: 'dsh-wf-dock' },
    createElement('div', { className: 'dsh-wf-dock-head' },
      createElement('span', { className: 'dsh-wf-dock-title' }, '⚡ 自定义工作流'),
      createElement('span', { className: 'dsh-wf-dock-sub' }, '停靠在会话区域 · 数据落 <工作区>/.dag-flow/'),
      createElement('div', { className: 'dsh-wf-dock-actions' },
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => {
            // 打开当前工作区的工作流数据文件夹（<工作区>/.dag-flow/，系统文件管理器）
            fetch('/api/dag-flow/open-folder', { method: 'POST', credentials: 'include' })
              .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); })
              .catch((e) => { console.error('[dag-flow] open folder failed:', e); alert('打开文件夹失败：' + (e as Error).message); });
          },
          title: '打开工作流数据文件夹（<工作区>/.dag-flow/）',
        }, '📁 工作流文件夹'),
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => dockOpenRequest?.(), title: '选择历史工作流或新建',
        }, '➕ 打开 / 新建'),
        createElement('button', {
          className: 'dsh-wf-dock-btn dsh-wf-dock-btn-primary', type: 'button',
          onClick: () => backToConversation(), title: '回到会话（画布内容保留，可随时回来）',
        }, '返回会话'),
      ),
    ),
    createElement('div', { className: 'dsh-wf-dock-body', ref: bodyRef }),
  );
}

export function apply(ctx: any): void {
  // 初始化主题（从 localStorage 恢复 data-wf-theme，默认跟随 DSH）
  try { applyTheme(getThemeMode()); } catch { /* 忽略 */ }
  // 顶层 try/catch：任何 inject 失败不影响其它
  try {
    hostCtx = ctx ?? null;

    // 1. 侧栏入口（左上方"新会话"按钮下方）：点击 = 直接切到主区域停靠画布
    //    （与"新会话"切到会话面板同款交互，不弹窗）。宿主 DOM 锚点/样式拷贝在 sidebar.ts（专职 DOM 防腐点）。
    try {
      mountSidebarEntry(() => {
        setDockDef(dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW, true);
        gateSelectPanel(hostCtx, 'dag-flow');
      });
    } catch (e) {
      console.warn('[dag-flow] sidebar entry mount failed:', e);
    }

    // 2. 主区域停靠面板（keyed main，与 conversation/plugins 同机制）。
    //    ★ generator + yield 注册形态与 selectPanel 的 key 校验假设都在防腐层
    //      （注册未生效时切换会抛 "main panel ... not registered"，2026-10-01 真机踩坑）。
    //    ★ 不注册 sidebar.panellist 行：入口按钮即切换，无需额外面板按钮（用户反馈）。
    if (!ctx?.layout || typeof ctx.layout.selectPanel !== 'function') {
      console.warn('[dag-flow] ctx.layout.selectPanel missing; dock switch disabled');
    }
    registerMainPanel(ctx, { key: 'dag-flow' }, DockedMainPanel);
    dumpMainPanelKeys(ctx, 'apply');
    setTimeout(() => dumpMainPanelKeys(ctx, 't+1.5s'), 1500);
    setTimeout(() => dumpMainPanelKeys(ctx, 't+5s'), 5000);

    // 选择/新建工作流 → 换 def 并切到停靠画布
    dockOpenRequest = () => openWorkflowPicker((def) => {
      setDockDef(def, true);
      gateSelectPanel(hostCtx, 'dag-flow');
    });

    // ★ bundle 版本标记：真机 DevTools 控制台可确认加载的是新构建（旧缓存 bundle 无此行）
    console.log('[dag-flow] client v20261011-cleanup · apply OK');
  } catch (e) {
    console.error('[dag-flow] client apply failed:', e);
  }
}

// 也保留 mount/unmount 给外部用
export { mountWorkflowPanel as mount, unmount };

// 默认导出 = { apply, inject, mount, unmount } —— DSH loader 看 .apply 自动调
export default { apply, inject, mount: mountWorkflowPanel, unmount };

// 辅助 re-export
export { FlowPanel } from './FlowPanel';
export { NODE_PALETTE } from './types';
export type { WorkflowDef, MountContext } from './types';
