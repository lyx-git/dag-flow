// tmp-test/cdp/diag-branch-switch.mjs — 诊断「switch 在线上改分支键：切不回原 case / 很慢」
// 观测三件事：①点已有 case 按钮后 def.edges 何时变；②画布标签文字何时变（视觉是否滞后/不变）；
// ③往返切换（quick→full→quick）是否都能成功；每步打印耗时。
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9338 });
const ev = (expr) => evaluate(page.cdp, expr);
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-switch&branch=1`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length >= 5`, { timeout: 20000 });
  await sleep(600);

  const snap = () => ev(`(() => ({
    labels: [...document.querySelectorAll('.dsh-wf-fg-line-label')].map((e) => e.textContent.trim()).sort(),
    swEdges: (window.__df_def?.edges ?? []).filter((e) => e.from === 'sw_1').map((e) => e.to + ':' + (e.when ?? '-')).sort(),
    swCases: JSON.stringify(window.__df_def?.nodes?.find((n) => n.id === 'sw_1')?.params?.cases ?? null),
  }))()`);

  console.log('初始：', JSON.stringify(await snap()));

  const clickChip = (text) => ev(`(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'NO_CHIP';
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
    return 'OK';
  })()`);

  const clickKey = (labelPart) => ev(`(() => {
    const b = [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].find((x) => x.textContent.includes(${JSON.stringify(labelPart)}));
    if (!b) return 'NO_BTN:' + [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].map((x) => x.textContent.trim()).join('|');
    b.click();
    return 'OK';
  })()`);

  /** 点当前 quick 线 → 改成 full，测量 def 与画布标签各自的落地时间 */
  async function switchCase(fromChip, keyPart, tag) {
    const t0 = Date.now();
    const opened = await clickChip(fromChip);
    if (opened !== 'OK') { console.log(`${tag}: 找不到标签 ${fromChip} → ${opened}`); return; }
    await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
    const tOpen = Date.now() - t0;
    console.log(`${tag}: 编辑器弹出耗时 ${tOpen}ms；候选键 = ${JSON.stringify(await ev(`[...document.querySelectorAll('.dsh-wf-fg-bedit-key')].map((x) => x.textContent.trim())`))}`);
    const clicked = await clickKey(keyPart);
    if (clicked !== 'OK') { console.log(`${tag}: 点键失败 → ${clicked}`); return; }
    const tClick = Date.now();
    // 轮询观察：def 何时变、画布标签何时变
    let tDef = -1, tLabel = -1, last = '';
    for (let i = 0; i < 120; i++) {
      const s = await snap();
      const cur = JSON.stringify(s);
      if (tDef < 0 && /log_t:full|log_f:quick|\.*full/.test(JSON.stringify(s.swEdges))) tDef = Date.now() - tClick;
      if (tDef < 0) tDef = Date.now() - tClick;
      if (cur !== last) { last = cur; }
      const labelChanged = !s.labels.includes(fromChip);
      if (labelChanged) { tLabel = Date.now() - tClick; break; }
      await sleep(50);
    }
    await sleep(1200);
    const s2 = await snap();
    console.log(`${tag}: def 落地 ${tDef}ms / 画布标签变化 ${tLabel < 0 ? '❌ 超时未变' : tLabel + 'ms'}；之后状态 = ${JSON.stringify(s2)}`);
  }

  await switchCase('quick', 'full', '[1] quick → full（已有 case）');
  await switchCase('full', 'quick', '[2] 切回原 case quick');

  // 额外：新 case 路径耗时
  const t3 = Date.now();
  await clickChip('quick');
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  await ev(`(() => {
    const input = document.querySelector('.dsh-wf-fg-bedit-custom input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'turbo'); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })(); true;`);
  await sleep(1500);
  console.log(`[3] 新建 case turbo 总耗时 ${Date.now() - t3}ms；之后状态 = ${JSON.stringify(await snap())}`);
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
