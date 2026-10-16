// src/client/undo-stack.ts
// 画布撤销/重做：**自建业务级快照栈**（2026-10-16 用户拍板方案 B）。
//
// 为什么不用 FlowGram 自带的 history（2026-10-16 只读排查结论，两条根因都绕不开）：
//   ① **位移不进历史**：FlowGram 只在 `operationService.onNodePostionUpdate` 事件里记 `dragNodes`
//      （`@flowgram.ai/free-history-plugin` dist/esm/index.js:665-679）；而本项目的节点拖拽是 2026-10-01
//      起自建的原生事件引擎（直接 `node.transform.update`）⇒ 完全绕过该通道。
//   ② **每次 def 同步都清空历史**：`document.onReload → historyService.clear()`（同文件 632-634），
//      而 DefSync 每次 `ctx.document.fromJSON(...)`（FlowGramCanvas.tsx:253 附近）都触发 reload。
//   ⇒ `canUndo()` 恒 false ⇒ 工具条那两个按钮**从进画布起就一直是灰的**（用户报「撤销和重做按钮没反应」）。
//
// 方案：在 def（**唯一事实来源**）层记快照，撤销/重做 = 回退 def。覆盖位移 / 参数 / 增删节点连线等
//   全部编辑，且不受 FlowGram `clear()` 影响。
//
// 契约：
//   · 快照 = def 的 JSON 字符串；栈上限 MAX_STEPS（超出丢最旧）；redo 分支在产生新编辑时丢弃。
//   · `observeDef(def)`：def 与「当前所处快照」相同 ⇒ 直接忽略（撤销/重做的回放不会被记成新历史）；
//     否则按 `diffKeyOf` 归类，**同一连续编辑动作**（同 key 且间隔 < COALESCE_MS）只记一条
//     —— 连续打字/拖动补写不会把栈撑爆。
//   · `undo()/redo()` 只负责**定位目标快照**并交给已注册的 applier（FlowPanel 在那里 setDef +
//     回退画布位移）；本模块不碰 React 与 FlowGram。
//   · 纯逻辑、无 IO、无 React ⇒ 单测见 `test/undo-stack.test.mjs`。

/** 栈上限：60 步（超出的最旧快照丢弃；def 单份通常几十 KB） */
export const MAX_STEPS = 60;
/** 同一连续编辑动作的合并窗口：窗口内的同 key 变更只记一条（打字的每键上抛靠它收敛） */
export const COALESCE_MS = 700;
/** 位移（`pos:`）的合并窗口：放宽到 5s —— "拖一下、停一下、接着拖"在用户眼里仍是一次拖动 */
export const POS_COALESCE_MS = 5000;
/** 回放静默期：撤销/重做之后画布会回抛一次（位置直改触发的落定 + edges/nodes 归一化），
 *  这段时间内的差异只**吸收进当前条目**，不许当新编辑（否则会切掉 redo 分支、重做按钮变灰）。
 *  ★2026-10-17 调参记录：曾按独立审查建议缩到 400ms（怕把撤销后 1 秒内的**真实编辑**也吸收掉），
 *  但 CDP 实测（慢环境每步往返远超真机）涟漪会 >400ms 才到 ⇒ 被当新编辑、切掉 redo 分支，
 *  复现"撤销后重做按钮还是灰的"（正是用户最初报的症状）⇒ 回到 1200ms 兜底，
 *  并**只吸收不含位移的差异**（见 observeDef）：撤销后立刻拖动属真实编辑，照常记条。 */
export const APPLY_QUIET_MS = 1200;

let applyingUntil = 0;

/** 栈条目：快照 + 记录时的变化类型（undo 回退与诊断都要看它） */
type Entry = { snap: string; key: string };
let stack: Entry[] = [];
let index = -1;
/** 最近一次记录：变化类型 + 时间（合并判据） */
let lastKey = '';
let lastAt = 0;
/** 上一次观察到的 def（供 diffKeyOf 用，省一次 JSON.parse） */
let lastDef: unknown = null;
let applier: ((def: unknown) => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) { try { fn(); } catch { /* 监听者自己兜错 */ } }
}

/** 订阅栈状态变化（Toolbar 用它刷新按钮可用态） */
export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 注册"把某个 def 应用回去"的动作（FlowPanel 提供：setDef + 回退画布位移） */
export function setUndoApplier(fn: ((def: unknown) => void) | null): void {
  applier = fn;
}

/** 载入/切换工作流、或面板重挂载时重置：当前 def 作为基线，清空历史 */
export function resetUndo(def: unknown): void {
  const snap = JSON.stringify(def ?? null);
  stack = [{ snap, key: '' }];
  index = 0;
  lastKey = '';
  lastAt = 0;
  lastDef = def ?? null;
  applyingUntil = 0;                         // 新基线：不处于回放静默期
  notify();
}

/** 载入/导入新工作流、但**拿不到最终 def** 时用（如导入要经 canonicalize 归一化）：
 *  清栈并把**下一条**观察到的 def 当作新基线（observeDef 见 index=-1 会直接建基线）。
 *  ★为什么不用它判断"换工作流"：打开/新建、进入子工作流都走 dock 的 bump 重挂载，挂载时
 *  `resetUndo(def)` 就是准确基线；这里只服务"同实例换 def"的导入路径。 */
export function resetUndoPending(): void {
  stack = [];
  index = -1;
  lastKey = '';
  lastAt = 0;
  lastDef = null;
  applyingUntil = 0;
  notify();
}

/**
 * 归类一次 def 变化（**决定能否与上一条合并**）：
 *   · `'pos'`            = 只有 `layout`（节点位置）变了 ⇒ 连续拖动/补写合成一条
 *   · `'node:<节点 id>'` = 只有一个节点的内容变了 ⇒ 连续打字合成一条
 *   · `''`               = 结构性变化（增删节点/连线、多个位置同时变…）⇒ 每次都独立记一条
 */
export function diffKeyOf(prev: unknown, next: unknown): string {
  const a = (prev ?? {}) as Record<string, unknown>;
  const b = (next ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differing = [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  if (differing.length === 0) return '';
  if (differing.length === 1 && differing[0] === 'layout') {
    // ★ 位移要带上"动了哪些节点"：同一次拖动（含中途多次补写）⇒ 同一个 `pos:<id>` ⇒ 合并成一条；
    //   换节点再拖 ⇒ key 变了 ⇒ 独立成条（撤销不会跳着退回两次拖动）。
    const la = (a.layout ?? {}) as Record<string, { x: number; y: number }>;
    const lb = (b.layout ?? {}) as Record<string, { x: number; y: number }>;
    const ids = [...new Set([...Object.keys(la), ...Object.keys(lb)])]
      .filter((id) => JSON.stringify(la[id]) !== JSON.stringify(lb[id]))
      .sort();
    return `pos:${ids.join(',')}`;
  }
  if (differing.length === 1 && differing[0] === 'nodes') {
    const an = (a.nodes ?? []) as { id?: unknown }[];
    const bn = (b.nodes ?? []) as { id?: unknown }[];
    if (an.length !== bn.length) return '';
    const changed = an
      .map((n, i) => (JSON.stringify(n) === JSON.stringify(bn[i]) ? null : String(bn[i]?.id ?? '')))
      .filter((id): id is string => !!id && id !== 'null');
    if (changed.length === 1) return `node:${changed[0]}`;
  }
  // 兜底：把"哪些顶层键变了"编进 key（便于诊断"一次拖动为什么记成好几条"；
  // 它不会与 `pos:` 类互相合并 —— 只有 pos: 享有无时间窗合并）
  return `struct:${differing.slice().sort().join(',')}`;
}

/** ★ 待落栈的 def（2026-10-17 修"刚编辑完立刻撤销没反应"）：记录本身是在观察者那里**去抖 220ms**
 *  才落的，若用户在这之前就按 Ctrl+Z / 点了 ↶，栈里还没有这次编辑 ⇒ 表现为"点了没反应"或"多撤一步"
 *  （独立审查报的第 ② 条）。⇒ 观察者在 def 一变化时就 `markPending(def)`（同步、不入栈），
 *  `undo()/redo()` 开头先 `flushPending()` 把它补成一条。 */
let pendingDef: unknown = null;

/** 登记"当前 def 还没落栈"（观察者在 def 变化时立刻调用） */
export function markPending(def: unknown): void { pendingDef = def; }

/** 把待落栈的 def 立刻入栈（幂等：与栈顶相同会被 observeDef 忽略；静默期内的回放涟漪仍会被吸收） */
export function flushPending(): void {
  const d = pendingDef;
  pendingDef = null;
  if (d !== null && d !== undefined) observeDef(d);
}

/** 观察一次 def（FlowPanel 在 def 变化处调用）。相同快照 = 回放，直接返回 */
export function observeDef(def: unknown): void {
  const snap = JSON.stringify(def ?? null);
  if (index >= 0 && stack[index]?.snap === snap) { lastDef = def ?? null; return; }
  const now = Date.now();
  const key = lastDef === null ? '' : diffKeyOf(lastDef, def);
  lastDef = def ?? null;
  // ★ 回放涟漪（2026-10-16 CDP 实测）：撤销/重做之后，画布回抛的 def 与目标快照**不完全相同**
  //   （edges/nodes 会被归一化，key 形如 `struct:nodes`）⇒ 若当新编辑记，`slice(0, index+1)`
  //   会**切掉 redo 分支**（表现为"撤销后重做按钮还是灰的、位置也回不去"）。
  //   这段时间里只把这版快照**并进当前条目**（不动 index），涟漪过去后一切照旧。
  //   ★ 只吸收"**不含位移**"的差异（涟漪＝edges/nodes 归一化；位移是 pos: 开头）⇒ 撤销后立刻拖动属
  //   真实编辑、照常记条：既不切掉 redo 分支，也不吞掉用户的拖动。
  if (now < applyingUntil && index >= 0 && !key.startsWith('pos:')) {
    stack[index] = { snap, key: stack[index].key };
    notify();
    return;
  }
  // 合并：同一连续编辑动作只记一条 —— 覆盖"当前态"，不新增历史。
  // ★ 位移（`pos:<同一批节点>`）**用更宽的窗口**（5s）：拖动中的多次落定、以及"拖一下停一下接着拖"
  //   都算一次拖动；换节点拖（key 里的 id 集合不同）仍独立成条。
  const posWindow = key.startsWith('pos:') ? POS_COALESCE_MS : COALESCE_MS;
  if (key && key === lastKey && now - lastAt < posWindow && index >= 1) {
    stack[index] = { snap, key: stack[index].key };   // 保留原 key：这一条仍代表同一个连续动作
    lastAt = now;
    notify();
    return;
  }
  stack = stack.slice(0, index + 1);        // 有新编辑 ⇒ 丢掉 redo 分支
  stack.push({ snap, key });
  if (stack.length > MAX_STEPS) stack.shift();
  index = stack.length - 1;
  lastKey = key;
  lastAt = now;
  notify();
}

/** 还能撤销吗（index > 0；index = 0 是基线） */
export function undoCan(): boolean { return index > 0; }
/** 还能重做吗 */
export function redoCan(): boolean { return index >= 0 && index < stack.length - 1; }

/** 撤销：把上一个快照交给 applier。返回是否真的动了 */
export function undo(): boolean {
  flushPending();                            // ★ 先把"还没落栈的最新编辑"补进来（否则立刻撤销会没反应）
  if (!undoCan()) return false;
  index -= 1;
  lastKey = '';                              // 回放期间不与后续编辑合并
  lastAt = 0;
  applyingUntil = Date.now() + APPLY_QUIET_MS;   // 挡住回放涟漪（见 observeDef 注释）
  const target: unknown = JSON.parse(stack[index].snap);
  lastDef = target;
  applier?.(target);
  notify();
  return true;
}

/** 重做：把下一个快照交给 applier。返回是否真的动了 */
export function redo(): boolean {
  flushPending();                            // 同上：先补落栈，避免"刚编辑完就重做"退错步
  if (!redoCan()) return false;
  index += 1;
  lastKey = '';
  lastAt = 0;
  applyingUntil = Date.now() + APPLY_QUIET_MS;   // 同上：重做后的涟漪也不许切掉撤销分支
  const target: unknown = JSON.parse(stack[index].snap);
  lastDef = target;
  applier?.(target);
  notify();
  return true;
}

/** 诊断（CDP 用）：每条记录的 key + 其中的 layout（看清"撤销到底会退到哪一版位置"） */
export function undoDump(): { key: string; layout: Record<string, { x: number; y: number }> }[] {
  return stack.map((e) => {
    let layout: Record<string, { x: number; y: number }> = {};
    try { layout = (JSON.parse(e.snap) as { layout?: Record<string, { x: number; y: number }> }).layout ?? {}; } catch { /* 忽略 */ }
    return { key: e.key, layout };
  });
}

/** 诊断（CDP/单测用）：当前所处位置与栈深 */
export function undoStats(): { index: number; size: number; canUndo: boolean; canRedo: boolean } {
  return { index, size: stack.length, canUndo: undoCan(), canRedo: redoCan() };
}
