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
true;
`;

export async function installHelpers(cdp) { await evaluate(cdp, PAGE_HELPERS); }

// —— 断言（失败即抛，平铺写法）——
export function ok(cond, msg) { if (!cond) throw new Error('断言失败: ' + msg); }
export function eq(a, b, msg) {
  if (a !== b) throw new Error(`断言失败: ${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);
}
