// tmp-test/cdp/diag-perf-input-copy.mjs — 量化「点输入框 / 复制文字」的卡顿
//   用户反馈原话：「点输入框和复制文字的时候，有点卡顿是咋回事」
//   关键设计：分两阶段对比 ——
//     A 无运行结果（刚打开工作流）
//     B 有运行结果（跑过一次之后）★ FlowPanel 在 runResults 非空时，每次渲染都会
//       重建整个 nodes 数组（{...n, data:{...n.data, runStatus: rs}}）+ 新建 activeEdges Set，
//       而客户端没有任何 React.memo ⇒ 任何状态变化（如复制→toast）都会让画布层收到全新 props。
//   用夹具控制口 POST /__host-run 灌入"已完成运行"，让后台监视器轮询到结果 → 进入 B 状态。
//   用法：node tmp-test/cdp/diag-perf-input-copy.mjs [--q=vars|big|huge]
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const Q = (process.argv.find((a) => a.startsWith('--q=')) ?? '--q=vars').slice(4);
const WF = 'perfprobe';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9401 });
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await goto(page.cdp, `${BASE}/cdp-host.html?name=${WF}&${Q}`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await sleep(600);

  await evaluate(page.cdp, `(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
    window.__perf = { longtasks: [] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longtasks.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch { /* */ }
    // 画布层 DOM 变更计数
    window.__mut = 0;
    window.__mo = new MutationObserver((rs) => { window.__mut += rs.length; });
    window.__watch = () => { window.__mut = 0; const el = document.querySelector('.dsh-wf-fg-editor'); if (el) window.__mo.observe(el, { childList: true, subtree: true, attributes: true, characterData: true }); return !!el; };
    window.__unwatch = () => { window.__mo.disconnect(); return window.__mut; };
    // 复制 chip → toast 延迟（连测 5 次取中位数）
    window.__mCopy = async () => {
      const chip = document.querySelector('.dsh-wf-var-chip');
      if (!chip) return { err: 'no chip' };
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        let seen = null;
        const mo = new MutationObserver(() => { if (seen === null && document.querySelector('.dsh-wf-copy-toast')) seen = performance.now() - t0; });
        mo.observe(document.body, { childList: true, subtree: true });
        chip.click();
        await new Promise((r) => setTimeout(r, 120));
        mo.disconnect();
        samples.push(seen === null ? -1 : Math.round(seen * 10) / 10);
      }
      samples.sort((a, b) => a - b);
      return { median: samples[2], min: samples[0], max: samples[4] };
    };
    // 点输入框：两次 rAF 的总耗时（≈ 可感知的响应延迟）
    window.__mFocus = async () => {
      const inp = document.querySelector('.dsh-wf-right .dsh-wf-input');
      if (!inp) return { err: 'no input' };
      const t0 = performance.now();
      inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      inp.focus();
      inp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      inp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ms: Math.round((performance.now() - t0) * 10) / 10 };
    };
    return true;
  })()`);

  const nodes = await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-fg-node-host').length`);
  // 选中一个带输入框的节点
  let picked = -1;
  for (let i = 0; i < nodes; i++) {
    await evaluate(page.cdp, `window.__df_clickNode(${i})`);
    await sleep(200);
    if (await evaluate(page.cdp, `!!document.querySelector('.dsh-wf-right .dsh-wf-input')`)) { picked = i; break; }
  }
  const chips = await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-right .dsh-wf-var-chip').length`);
  console.log(`夹具 --q=${Q} ｜ 节点 ${nodes} ｜ 选中 #${picked} ｜ 右侧 chips ${chips}`);

  const runPhase = async (label) => {
    const badges = await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-fg-badge').length`);
    // 复制点击 + 画布 churn
    const churn = await evaluate(page.cdp, `(async () => {
      window.__watch();
      const r = await window.__mCopy();
      return { copy: r, canvasMutations: window.__unwatch() };
    })()`);
    const focus = await evaluate(page.cdp, `window.__mFocus()`);
    const lt = await evaluate(page.cdp, `window.__perf.longtasks.length`);
    console.log(`  [${label}] 徽标数=${badges} ｜ 复制(中位)=${churn.copy.median}ms (${churn.copy.min}~${churn.copy.max}) ｜ 复制时画布 DOM 变更=${churn.canvasMutations} ｜ 点输入框=${focus.ms}ms ｜ longtask 累计=${lt}`);
    return { badges, churn, focus };
  };

  console.log('阶段 A：无运行结果（刚打开）');
  await runPhase('A 无结果');

  // 灌入"已完成运行"→ 后台监视器 2.5s 内轮询到 → runResults 非空
  const ids = await evaluate(page.cdp, `(window.__df_def?.nodes ?? []).map((n) => n.id)`);
  // ★ --bigout：让每个节点的 out 变成"真实工作流那种大输出"（长文本 + 结果数组 + 嵌套），
  //   用来验证「右侧变量表 fieldsFor 每次渲染都重算、且输入是真实运行输出」这条路径的开销。
  const bigout = process.argv.includes('--bigout');
  const outs = {};
  if (bigout) {
    for (const id of ids) {
      outs[id] = {
        text: 'x'.repeat(20000),
        items: Array.from({ length: 20 }, (_, i) => ({ title: 'T' + i, url: 'https://example.com/' + i, snippet: 'y'.repeat(300) })),
        nested: { a: { b: { c: { d: 1, e: [1, 2, 3] } } } },
      };
    }
  }
  await (await fetch(BASE + '/__host-run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: WF, ids, stage: ids.length, outs }),
  })).json();
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-badge').length > 0`, { timeout: 15000 });
  await sleep(400);
  console.log(`阶段 B：已灌入运行结果（等价于"跑过一次之后"）${bigout ? ' ★ 大输出模式（每节点 ~26KB）' : '（小输出）'}`);
  await runPhase('B 有结果');

  console.log('\n说明：longtask 阈值 50ms；画布 DOM 变更数 = 一次复制点击期间 .dsh-wf-fg-editor 子树里的 mutation 条数（越大=越可能整块画布被重渲染）。');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
