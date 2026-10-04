// tmp-test/cdp/driver.mjs — 零依赖 CDP 驱动（2026-10-01 夜 测试方式改造，替代旧内嵌 setTimeout 链）
// 旧方案痛点（用户指示换方式）：单文件巨型嵌套回调 → 括号配对一错全链静默死亡；
// --virtual-time-budget → CSS transition/异步管线伪影；截图读图 → 断言靠人眼。
// 新方案：Node 侧平铺 await 断言（一失败即抛）+ 真实时钟 + DOM/计算样式级断言。
// 依赖：Node ≥22 全局 WebSocket / fetch；Chrome 路径可用环境变量 CHROME_PATH 覆盖。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'D:\\AppInstallers\\Chrome\\App\\chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WebSocket JSON-RPC 连接（id 匹配请求/响应 + 事件分发） */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0;
    const pending = new Map();
    const handlers = new Map();
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('CDP websocket 连接失败: ' + url)));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of handlers.get(msg.method) ?? []) h(msg.params);
      }
    });
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(method, fn) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); },
      close() { try { ws.close(); } catch { /* */ } },
    };
  });
}

/** 启动 headless Chrome 并连接首个 page target（headless=new 失败自动回落旧 headless） */
export async function launchPage({ port = 9333 } = {}) {
  let lastErr = null;
  for (const flags of [['--headless=new'], ['--headless']]) {
    const dir = mkdtempSync(join(tmpdir(), 'df-cdp-'));
    const child = spawn(CHROME, [
      ...flags, '--disable-gpu',
      `--remote-debugging-port=${port}`,
      '--no-first-run', '--no-default-browser-check',
      '--window-size=1400,900',
      `--user-data-dir=${dir}`,
      'about:blank',
    ], { stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); up = true; } catch { await sleep(100); }
    }
    if (!up) {
      lastErr = new Error(`Chrome DevTools 端点未就绪（port=${port}, flags=${flags.join(' ')}）`);
      try { child.kill(); } catch { /* */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      continue;
    }
    // 取首个 page target（命令行 about:blank 自带）
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page') ?? null;
      } catch { /* */ }
      if (!target) await sleep(100);
    }
    if (!target) {
      lastErr = new Error('未找到 page target');
      try { child.kill(); } catch { /* */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      continue;
    }
    const cdp = await connect(target.webSocketDebuggerUrl);
    let closed = false;
    return {
      cdp,
      close() {
        if (closed) return;
        closed = true;
        try { cdp.close(); } catch { /* */ }
        try { child.kill(); } catch { /* */ }
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
      },
    };
  }
  throw lastErr ?? new Error('Chrome 启动失败');
}

// 页面异常收集：waitFor 超时时附上最后一条页面错误（避免「只有超时、不知死因」）
const pageErrors = [];
export function lastPageError() { return pageErrors[pageErrors.length - 1] ?? null; }

/** 导航并等 readyState=complete */
export async function goto(cdp, url) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (!cdp.__errHooked) {
    cdp.__errHooked = true;
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails ?? {};
      pageErrors.push(d.exception?.description ?? d.text ?? 'unknown');
    });
  }
  pageErrors.length = 0;
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  for (;;) {
    let ready = '';
    try { ready = (await evaluate(cdp, 'document.readyState')) ?? ''; } catch { /* 导航中上下文未就绪 */ }
    if (ready === 'complete') return;
    if (Date.now() - t0 > 15000) throw new Error('页面加载超时: ' + url);
    await sleep(80);
  }
}

/** 页面求值（awaitPromise + returnByValue；异常即抛） */
export async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('页面求值失败: ' + (d.exception?.description ?? d.text ?? '(unknown)'));
  }
  return r.result?.value;
}

/** 轮询等待表达式为真（真实时钟） */
export async function waitFor(cdp, expr, { timeout = 15000, interval = 100 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await evaluate(cdp, expr); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > timeout) {
      throw new Error('waitFor 超时: ' + expr + (lastPageError() ? '；页面异常: ' + lastPageError().split('\n')[0] : ''));
    }
    await sleep(interval);
  }
}

// —— 页面内交互助手（每次 goto 后由 installHelpers 注入；合成事件走真实 DOM 传播路径，
//    FlowGram/插件的原生监听与 window capture 监听都能收到）——
export const PAGE_HELPERS = `
window.__df_fire = (el, type, x, y) => {
  const r = el.getBoundingClientRect();
  const cx = x ?? r.left + r.width / 2, cy = y ?? r.top + r.height / 2;
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }));
  return { cx, cy };
};
window.__df_q = (sel) => document.querySelector(sel);
window.__df_qa = (sel) => [...document.querySelectorAll(sel)];
window.__df_byText = (sel, text) => window.__df_qa(sel).find((el) => (el.textContent || '').includes(text));
window.__df_clickNode = (i = 0) => {
  const hosts = window.__df_qa('.dsh-wf-fg-node-host');
  if (!hosts[i]) throw new Error('node host #' + i + ' 不存在，现有 ' + hosts.length);
  const el = hosts[i];
  window.__df_fire(el, 'mousedown');
  window.__df_fire(el, 'mouseup');
  window.__df_fire(el, 'click');
  return true;
};
window.__df_clickEmpty = () => {
  const editor = window.__df_q('.dsh-wf-fg-editor');
  if (!editor) throw new Error('编辑器不存在');
  const r = editor.getBoundingClientRect();
  return window.__df_fire(editor, 'mousedown', r.left + r.width * 0.75, r.top + r.height * 0.85)
    && window.__df_fire(editor, 'click', r.left + r.width * 0.75, r.top + r.height * 0.85);
};
window.__df_pressKey = (key, extra = {}) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
};
window.__df_clickBtn = (text) => {
  const b = window.__df_byText('.dsh-wf-btn', text);
  if (!b) throw new Error('按钮不存在: ' + text);
  b.click();
  return true;
};
// fetch 记录（诊断用：失败时随错误信息转储；body 另存 __df_bodies 供断言语义）
window.__df_reqs = [];
window.__df_bodies = [];
{
  const __of = window.fetch.bind(window);
  window.fetch = (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? String(args[0]));
    const method = args[1]?.method ?? 'GET';
    let bodyPreview = '';
    try {
      const b = args[1]?.body;
      if (typeof b === 'string') bodyPreview = b.length > 4000 ? b.slice(0, 4000) + '…' : b;
    } catch { /* 忽略 */ }
    return __of(...args).then((r) => {
      window.__df_reqs.push(url + ' ' + method + ' -> ' + r.status);
      if (bodyPreview) window.__df_bodies.push({ url, method, body: bodyPreview, status: r.status });
      return r;
    }).catch((e) => { window.__df_reqs.push(url + ' ERR ' + String(e)); throw e; });
  };
}

// ★ 运行前自检的人工确认是产品要求（点 ▶ → 自检 → 确认 → 才真跑）；但**被测对象不是自检**的用例
//   不该被这道闸门挡住。默认自动点「开始运行」/「仍然运行」；自检用例自己设
//   window.__df_autoConfirmSelfcheck = false 关掉它，从而测真实闸门。
if (window.__df_autoConfirmSelfcheck === undefined) window.__df_autoConfirmSelfcheck = true;
if (!window.__df_autoConfirmBound) {
  window.__df_autoConfirmBound = true;
  const obs = new MutationObserver(() => {
    if (window.__df_autoConfirmSelfcheck === false) return;
    const dlg = document.querySelector('.dsh-wf-selfcheck');
    if (!dlg) return;
    const btns = [...dlg.querySelectorAll('.dsh-wf-manual-acts button')];
    const go = btns.find((b) => /开始运行|仍然运行/.test(b.textContent));
    if (go) go.click();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}
true;
`;

export async function installHelpers(cdp) { await evaluate(cdp, PAGE_HELPERS); }

/** 越过「运行前自检」那道人工确认（2026-10-04 轮 2 起：点 ▶ 先自检 → 通过/有问题都要人工确认才真跑）。
 *  点完 ▶ 之后调用一次即可：自检弹窗出现就点「▶ 开始运行」/「▶ 仍然运行」；超时没弹就直接返回 false。 */
export async function confirmSelfcheck(cdp, { timeout = 6000 } = {}) {
  // 自动确认模式（默认）下助手里的 MutationObserver 会即时点掉；这里仍做一轮兜底轮询
  //   —— 有些用例自己又 goto 了新页面（助手没了、observer 也不在），这时必须靠这里点。
  const auto = await evaluate(cdp, `window.__df_autoConfirmSelfcheck !== false`).catch(() => true);
  const deadline = Date.now() + (auto ? 1200 : timeout);
  for (;;) {
    const state = await evaluate(cdp, `(() => {
      const d = document.querySelector('.dsh-wf-selfcheck');
      if (!d) return { clicked: false };
      const btns = [...d.querySelectorAll('.dsh-wf-manual-acts button')];
      const go = btns.find((b) => /开始运行|仍然运行/.test(b.textContent));
      if (go) { go.click(); return { clicked: true }; }
      return { clicked: false };
    })()`).catch(() => ({ clicked: false }));
    if (state.clicked) return true;
    if (Date.now() > deadline) return false;
    await sleep(60);
  }
}

// ================= 真实鼠标输入（2026-10-04 轮 7：拖拽类用例做稳）=================
// 为什么需要：三个拖拽用例（line-drop-panel / switch-chips / branch-labels）长期**间歇性失败**，
//   根因是它们靠页面里合成 `MouseEvent` 来模拟拖拽——合成事件绕过了浏览器的输入管线，
//   playground 的 hover 阈值/拖拽状态机（依赖真实 pointer 进入、按键状态、移动步数）经常来不及成立，
//   于是"hover 没起线"，表现为 waitFor 快选面板超时（同一份构建有时过有时挂）。
//   `Input.dispatchMouseEvent` 走**浏览器输入管线**，等价于真人鼠标：hover/按下/移动/抬起都由浏览器维护状态。
export async function mouseMove(cdp, x, y, { buttons = 0 } = {}) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(x), y: Math.round(y),
    button: buttons ? 'left' : 'none', buttons,
  });
}
/** 把指针移到 (x,y) 并停留若干次移动（让 playground 的 hover 状态消化） */
export async function mouseHover(cdp, x, y, { times = 3, gapMs = 70 } = {}) {
  for (let i = 0; i < times; i++) { await mouseMove(cdp, x, y); await sleep(gapMs); }
}
export async function mouseDown(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1,
  });
}
export async function mouseUp(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 0, clickCount: 1,
  });
}
/** 把指针移到 (x,y) 并**反复移动直到 expr 成立**（最多 timeout 毫秒），返回是否成立。
 *  ★ 2026-10-04 轮 7 诊断结论（tmp-test/cdp/diag-port-hover.mjs）：FlowGram 在端口 hover 成功时
 *  会给端口元素加 `hovered` 类；**没 hover 成功时按下不会起线**——这正是 line-drop-panel /
 *  switch-chips 长期间歇失败的物理原因（不是"断言写错"，也不是纯粹慢）。所以起线前必须等这个
 *  前置状态成立，而不是盲等固定毫秒。 */
export async function hoverUntil(cdp, x, y, expr, { timeout = 1200, gapMs = 90 } = {}) {
  await mouseMove(cdp, x, y);   // ★ 只移动一次：重复移动到同一点可能被合并成 no-op，反而打断 hover
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await evaluate(cdp, expr); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 > timeout) return false;
    await sleep(gapMs);
  }
}

/** 端口 hover 成立的判据表达式（画布上任意端口/端口点带 hovered 类） */
export const PORT_HOVERED = `!!document.querySelector('.workflow-port-render.hovered') || !!document.querySelector('.workflow-point-bg.hovered')`;

/** 真实鼠标拖拽：**从旁边接近**端口 → hover（等到 hovered 类出现）→ 按下 → 分步移动 → 抬起。
 *  "从旁边接近"很关键：直接瞬移到端口上时，某些 hover 状态机只认 pointermove 的**位移**，
 *  同坐标重复移动可能被合并成 no-op → 表现为"按下了但起不了线"。 */
export async function dragMouse(cdp, from, to, { steps = 6, stepMs = 50, hoverTimes = 2, hoverMs = 70, hoverExpr = PORT_HOVERED } = {}) {
  const approach = Math.max(24, Math.round(Math.abs(to.x - from.x) * 0.05) || 24);
  await mouseMove(cdp, from.x - approach, from.y);   // 先落在旁边
  await sleep(hoverMs);
  await mouseMove(cdp, from.x - approach / 2, from.y);
  await sleep(hoverMs);
  await mouseHover(cdp, from.x, from.y, { times: hoverTimes, gapMs: hoverMs });
  if (hoverExpr) await hoverUntil(cdp, from.x, from.y, hoverExpr);   // ★ 等前置状态成立再按下
  await mouseDown(cdp, from.x, from.y);
  await sleep(stepMs + 30);                          // 让"已按下"被消化再开始移动
  for (let i = 1; i <= steps; i++) {
    await mouseMove(cdp, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
    await sleep(stepMs);
  }
  await mouseUp(cdp, to.x, to.y);
}

/** 合成事件拖拽（老写法，作为**第二条独立输入路径**兜底）：
 *  派发到 elementFromPoint 命中的最深元素，走真实 DOM 传播路径。它与真实鼠标输入失败的**条件不同**
 *  （合成事件不看浏览器按键/指针状态，真实输入不看合成事件的 isTrusted），两条都试能显著降低落空率。 */
export async function dragSynthetic(cdp, from, to, { steps = 2, gapMs = 150 } = {}) {
  await evaluate(cdp, `
    (async () => {
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const fire = (type, px, py) => {
        const t = document.elementFromPoint(px, py) ?? editor;
        t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, view: window }));
      };
      const seq = [
        ['mousemove', ${from.x}, ${from.y}], ['mousemove', ${from.x}, ${from.y}], ['mousemove', ${from.x}, ${from.y}],
        ['mousedown', ${from.x}, ${from.y}],
        ${Array.from({ length: steps }, (_, i) => {
          const x = Math.round(from.x + ((to.x - from.x) * (i + 1)) / (steps + 1));
          const y = Math.round(from.y + ((to.y - from.y) * (i + 1)) / (steps + 1));
          return `['mousemove', ${x}, ${y}],`;
        }).join('\n        ')}
        ['mousemove', ${to.x}, ${to.y}],
        ['mouseup', ${to.x}, ${to.y}],
      ];
      for (const [t, px, py] of seq) { fire(t, px, py); await new Promise((r) => setTimeout(r, ${gapMs})); }
      return true;
    })()
  `);
}

/** 拖拽到"某个 DOM 出现"为止：**交替使用真实鼠标与合成事件两条独立输入路径**（最多 attempts 次）。
 *  某次真正起线后，后续断言完全不变（面板位置/内容/交互逐条验），所以不会掩盖真实回归。
 *  2026-10-04 轮 7 诊断：起线的**前置状态**是端口进入 hovered（见 hoverUntil），真实输入已按此实现；
 *  但手势本身在 headless 下仍偶发落空，因此再加一条独立路径兜底 —— 不再靠"调长等待时间"。 */
export async function dragUntil(cdp, from, to, expr, { attempts = 4, waitMs = 1200, opts } = {}) {
  for (let i = 1; i <= attempts; i++) {
    if (i % 2 === 1) await dragMouse(cdp, from, to, opts);
    else await dragSynthetic(cdp, from, to);
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = await evaluate(cdp, expr); } catch { v = false; }
      if (v) return { ok: true, attempts: i, via: i % 2 === 1 ? 'mouse' : 'synthetic' };
      if (Date.now() - t0 > waitMs) break;
      await sleep(80);
    }
    await mouseMove(cdp, 8, 8);      // 清 hover 残留，再试下一条路径
    await sleep(180);
  }
  return { ok: false, attempts };
}

// —— 断言（失败即抛，平铺写法）——
export function ok(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); }
export function eq(a, b, msg) {
  if (a !== b) throw new Error(`断言失败: ${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);
}
