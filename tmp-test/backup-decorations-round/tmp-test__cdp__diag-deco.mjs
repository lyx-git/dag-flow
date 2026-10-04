// tmp-test/cdp/diag-deco.mjs — 诊断：分组框改名为什么没落到 def.canvas？
//   用法：node tmp-test/cdp/diag-deco.mjs
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9397 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-deco`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-deco-add')`, { timeout: 20000 });

  await evaluate(page.cdp, `(() => { [...document.querySelectorAll('.dsh-wf-deco-add')][0].click(); return true; })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-deco-group')`, { timeout: 8000 });
  await sleep(300);
  console.log('① 框已建；def.canvas =', JSON.stringify(await evaluate(page.cdp, `window.__df_def?.canvas ?? null`)));

  const info = await evaluate(page.cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-deco-title');
    return { hasInput: !!inp, value: inp?.value ?? null, count: document.querySelectorAll('.dsh-wf-deco-title').length,
             bridgeSet: !!(window.__df_decoCalls !== undefined) };
  })()`);
  console.log('② 标题输入框 =', JSON.stringify(info));

  // 真聚焦 → 改值（原生 setter）→ 真 blur
  await evaluate(page.cdp, `(() => {
    const inp = document.querySelector('.dsh-wf-deco-title');
    inp.focus();
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value');
    desc.set.call(inp, '数据抓取');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return { focused: document.activeElement === inp, value: inp.value };
  })()`).then((r) => console.log('③ 聚焦/改值后 =', JSON.stringify(r)));
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-deco-title').blur(); return true; })()`);
  await sleep(600);
  console.log('④ 桥调用记录 =', JSON.stringify(await evaluate(page.cdp, `window.__df_decoCalls ?? null`)));
  console.log('⑤ 之后 def.canvas =', JSON.stringify(await evaluate(page.cdp, `window.__df_def?.canvas ?? null`)));
  console.log('⑥ 输入框现值 =', JSON.stringify(await evaluate(page.cdp, `document.querySelector('.dsh-wf-deco-title')?.value ?? null`)));
  console.log('⑦ 桥装载时间 =', JSON.stringify(await evaluate(page.cdp, `window.__df_decoBridgeSet ?? null`)), ' focusout 次数 =', JSON.stringify(await evaluate(page.cdp, `window.__df_decoFocusout ?? null`)), ' 桥为空? =', JSON.stringify(await evaluate(page.cdp, `window.__df_decoBridgeNull ?? null`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
