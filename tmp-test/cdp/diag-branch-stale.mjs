// tmp-test/cdp/diag-branch-stale.mjs — 诊断「改了分支键：def 变了但画布标签没跟上」
// 每一步打印：走了就地(inPlace)还是重建路径 + def 状态 + 标签快照（轮询 3s 看是否收敛）
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9340 });
const ev = (expr) => evaluate(page.cdp, expr);
const labels = () => ev(`(() => { const m = {}; for (const el of document.querySelectorAll('.dsh-wf-fg-line-label')) { const t = el.textContent.trim(); m[t] = (m[t] ?? 0) + 1; } return m; })()`);
const swEdges = () => ev(`(window.__df_def?.edges ?? []).filter((e) => e.from === 'sw_1').map((e) => e.to + ':' + (e.when ?? '-')).sort()`);
const domLines = () => ev(`document.querySelectorAll('.gedit-flow-activity-edge').length`);

const clickLabel = (text) => ev(`(() => {
  const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return 'NO';
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  return 'OK';
})()`);
const pick = (contains) => ev(`(() => {
  const b = [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].find((x) => x.textContent.includes(${JSON.stringify(contains)}));
  if (!b) return 'NO_BTN';
  b.click(); return 'OK';
})()`);

async function step(tag, chipText, keyContains, expectDefWhen) {
  const opened = await clickLabel(chipText);
  if (opened !== 'OK') { console.log(`${tag}: 找不到「${chipText}」标签`); return; }
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 4000 });
  const title = await ev(`document.querySelector('.dsh-wf-fg-bedit-node')?.textContent ?? ''`);
  const picked = await pick(keyContains);
  const t0 = Date.now();
  let defT = -1, labelT = -1;
  for (let i = 0; i < 60; i++) {
    const es = await swEdges();
    if (defT < 0 && JSON.stringify(es).includes(expectDefWhen)) defT = Date.now() - t0;
    const ls = await labels();
    if (labelT < 0 && JSON.stringify(ls).includes(`"${keyContains}"`)) labelT = Date.now() - t0;
    if (defT >= 0 && labelT >= 0) break;
    await sleep(50);
  }
  const edit = await ev(`JSON.stringify(window.__df_lastBranchEdit ?? null)`);
  await sleep(800);
  console.log(`${tag}\n  编辑器=${title}｜点键=${picked}｜路径=${edit}`);
  console.log(`  def 变化 ${defT}ms / 画布标签变化 ${labelT < 0 ? '❌ 3s 内没变' : labelT + 'ms'}｜之后 def=${JSON.stringify(await swEdges())} 标签=${JSON.stringify(await labels())} 线数=${await domLines()}`);
}

try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-stale&branch=1`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length >= 5`, { timeout: 20000 });
  await sleep(600);
  console.log(`初始 def=${JSON.stringify(await swEdges())} 标签=${JSON.stringify(await labels())} 线数=${await domLines()}`);

  await step('[A] quick → full', 'quick', 'full', 'log_t:full');
  await step('[B] full → quick（切回原 case）', 'full', 'quick', 'log_t:quick');
  await step('[C] quick → full 再来一次', 'quick', 'full', 'log_t:full');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
