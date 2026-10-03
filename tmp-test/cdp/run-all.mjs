// tmp-test/cdp/run-all.mjs — CDP 测试编排：起 fixture 服务器 + headless Chrome，逐文件跑断言
// 用法：node tmp-test/cdp/run-all.mjs   （工作目录 = dag-flow 仓库根）
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, ok, eq, sleep, lastPageError } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const TESTS = [
  ['close-btn', () => import('./test-close-btn.mjs')],
  ['deselect-flash', () => import('./test-deselect-flash.mjs')],
  ['panel-resize', () => import('./test-panel-resize.mjs')],
  ['minimap', () => import('./test-minimap.mjs')],
  ['versions', () => import('./test-versions.mjs')],
  ['picker-copy', () => import('./test-picker-copy.mjs')],
  ['inputs', () => import('./test-inputs.mjs')],
  ['palette-drag', () => import('./test-palette-drag.mjs')],
  ['run-button', () => import('./test-run-button.mjs')],
  ['inspector-switch', () => import('./test-inspector-switch.mjs')],
  ['code-file', () => import('./test-code-file.mjs')],
  ['switch-cases', () => import('./test-switch-cases.mjs')],
  ['delete-button', () => import('./test-delete-button.mjs')],
  ['file-save-click', () => import('./test-file-save-click.mjs')],
  ['line-drop-panel', () => import('./test-line-drop-panel.mjs')],
  ['manual-confirm', () => import('./test-manual-confirm.mjs')],
  ['branch-labels', () => import('./test-branch-labels.mjs')],
  ['loop-visible', () => import('./test-loop-visible.mjs')],
  ['switch-many', () => import('./test-switch-many.mjs')],
  ['model-select', () => import('./test-model-select.mjs')],
  ['loop-jump', () => import('./test-loop-jump.mjs')],
  ['switch-chips', () => import('./test-switch-chips.mjs')],
  ['var-refs', () => import('./test-var-refs.mjs')],
  // ★ 2026-10-03：节点「最终执行结果」悬浮卡 + A 方案「失败不影响流程」勾选框
  ['node-result-tip', () => import('./test-node-result-tip.mjs')],
  // ★ 2026-10-03：运行过程态（待运行/运行中/依次点亮 + 动态运行按钮 + 红色取消）
  ['live-status', () => import('./test-live-status.mjs')],
  // ★ 2026-10-03：画布视图控件（进画布默认 75% 看得清 / 适应画布 50% 下限 / 一键放大缩小 / 不被重渲染重置）
  ['view-controls', () => import('./test-view-controls.mjs')],
];

// —— fixture 服务器 ——
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let serverUp = false;
for (let i = 0; i < 80 && !serverUp; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); serverUp = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!serverUp) { server.kill(); console.error('✗ fixture 服务器未就绪'); process.exit(1); }

// —— 逐测试（每个测试独立 goto，页面状态隔离；服务器状态用唯一工作流名隔离）——
//   可选 `CDP_ONLY=loop-jump,switch-chips` 只跑指定几项（开发期省时；默认跑全部）
const only = (process.env.CDP_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SELECTED = only.length ? TESTS.filter(([n]) => only.includes(n)) : TESTS;
const results = [];
let page = null;
try {
  page = await launchPage({ port: 9333 });
  for (const [name, load] of SELECTED) {
    const t0 = Date.now();
    const wfName = `${name}-${Date.now().toString(36)}`;
    try {
      await goto(page.cdp, `${BASE}/cdp-host.html?name=${encodeURIComponent(wfName)}`);
      await installHelpers(page.cdp);
      await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
      const { run } = await load();
      await run({ cdp: page.cdp, evaluate, waitFor, ok, eq, sleep, name: wfName, base: BASE });
      results.push([name, true, `${Date.now() - t0}ms`, '']);
    } catch (e) {
      // 失败现场：附上页面请求记录与最后一条页面异常（避免只有超时、不知死因）
      let extra = '';
      try { extra += ' | reqs=' + JSON.stringify(await evaluate(page.cdp, `window.__df_reqs ?? []`)).slice(0, 600); } catch { /* */ }
      try { const pe = lastPageError(); if (pe) extra += ' | pageErr=' + pe.split('\n')[0]; } catch { /* */ }
      results.push([name, false, `${Date.now() - t0}ms`, e.message + extra]);
    }
  }
} finally {
  try { page?.close(); } catch { /* */ }
  server.kill();
}

console.log('');
let failed = 0;
for (const [name, pass, ms, err] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '✓' : '✗'} ${name}  ${pass ? ms : ''}${err ? '\n    ' + err : ''}`);
}
console.log(failed ? `\n${results.length - failed}/${results.length} 通过` : `\n全部 ${results.length} 项通过`);
process.exit(failed ? 1 : 0);
