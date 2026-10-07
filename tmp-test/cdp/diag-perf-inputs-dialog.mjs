// tmp-test/cdp/diag-perf-inputs-dialog.mjs — 定位「✍️ 工作流参数」弹窗输入框卡顿 + 整体发卡
//   用户反馈：卡顿在「全局参数的输入框」；「一直卡，只要点就有感觉」；连「手动选中文字 Ctrl+C」都有感觉。
//   思路：
//     ① 用 CDP Performance.getMetrics 把 CPU 拆成 脚本/布局/样式重算/其它 —— 判断烧在 JS 还是 CSS/DOM
//     ② 空闲 N 秒的每秒成本（面板+画布挂着时的"底噪"）——"一直卡"应该在这里体现
//     ③ 在 ✍️ 弹窗输入框里逐键敲，量**同步耗时**（React 离散事件会同步 flush）——定位"点输入框就卡"
//   用法：node tmp-test/cdp/diag-perf-inputs-dialog.mjs [--q=vars|huge]
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const Q = (process.argv.find((a) => a.startsWith('--q=')) ?? '--q=huge').slice(4);
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9403 });
const metrics = async () => {
  const m = await page.cdp.send('Performance.getMetrics');
  const o = {};
  for (const x of m.metrics) o[x.name] = x.value;
  return o;
};
const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'];

try {
  await page.cdp.send('Performance.enable');
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=perfdlg&${Q}`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await sleep(800);
  const nodes = await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-fg-node-host').length`);
  console.log(`夹具 --q=${Q} ｜ 节点 ${nodes}`);

  // ① 空闲 6 秒的 CPU 成本（"底噪"）
  let a = await metrics();
  await sleep(6000);
  let b = await metrics();
  const per = (x) => ((b[x] - a[x]) / 6 * 1000).toFixed(1);
  console.log(`① 空闲 6s 的每秒 CPU：Task=${per('TaskDuration')}ms  Script=${per('ScriptDuration')}ms  Layout=${per('LayoutDuration')}ms  RecalcStyle=${per('RecalcStyleDuration')}ms`);

  // ② 打开 ✍️ 工作流参数弹窗，逐键敲输入框，量同步耗时
  await evaluate(page.cdp, `window.__df_clickBtn('✍️')`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-picker .dsh-wf-input')`, { timeout: 8000 });
  await sleep(300);
  const keystroke = await evaluate(page.cdp, `(async () => {
    const setVal = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inp = document.querySelector('.dag-flow-picker .dsh-wf-input');
    if (!inp) return { err: '没有参数输入框' };
    inp.focus();
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      setVal(inp, 'abcdefghij'.slice(0, (i % 10) + 1));
      const t1 = performance.now();   // 离散事件 → React 同步 flush，这一段的耗时就是"敲一下要等多久"
      times.push(t1 - t0);
      await new Promise((r) => setTimeout(r, 60));
    }
    times.sort((x, y) => x - y);
    return { median: Math.round(times[10] * 100) / 100, max: Math.round(times[19] * 100) / 100, min: Math.round(times[0] * 100) / 100 };
  })()`);
  console.log(`② ✍️ 参数输入框逐键：中位=${keystroke.median}ms  最大=${keystroke.max}ms  最小=${keystroke.min}ms`);

  // ③ 打字期间的 CPU 分解（看是 JS 还是样式/布局）
  const c = await metrics();
  const typing = await evaluate(page.cdp, `(async () => {
    const setVal = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const inp = document.querySelector('.dag-flow-picker .dsh-wf-input');
    for (let i = 0; i < 30; i++) { setVal(inp, 'x'.repeat((i % 12) + 1)); await new Promise((r) => setTimeout(r, 30)); }
    return true;
  })()`);
  const d = await metrics();
  const dd = (x) => ((d[x] - c[x]) * 1000).toFixed(1);
  console.log(`③ 连敲 30 次的累计 CPU：Task=${dd('TaskDuration')}ms  Script=${dd('ScriptDuration')}ms  Layout=${dd('LayoutDuration')}ms  RecalcStyle=${dd('RecalcStyleDuration')}ms`);

  // ④ 关掉弹窗后，再量一次空闲（对照：弹窗是否是主因）
  await evaluate(page.cdp, `document.querySelector('.dag-flow-picker .dag-flow-picker-close')?.click()`);
  await sleep(500);
  let e = await metrics();
  await sleep(6000);
  let f = await metrics();
  const per2 = (x) => ((f[x] - e[x]) / 6 * 1000).toFixed(1);
  console.log(`④ 关闭弹窗后空闲 6s 的每秒 CPU：Task=${per2('TaskDuration')}ms  Script=${per2('ScriptDuration')}ms  Layout=${per2('LayoutDuration')}ms  RecalcStyle=${per2('RecalcStyleDuration')}ms`);
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
