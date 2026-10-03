// tmp-test/cdp/diag-loop-panel.mjs — 诊断：?loop=1 夹具下选中 loop 节点后右面板内容
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
console.log('fixture server up =', up);
const page = await launchPage({ port: 9334 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-loop&loop=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  console.log('hosts =', await evaluate(page.cdp, `window.__df_qa('.dsh-wf-fg-node-host').length`));
  console.log('host texts =', JSON.stringify(await evaluate(page.cdp, `window.__df_qa('.dsh-wf-fg-node-host').map((h) => (h.textContent || '').slice(0, 24))`)));
  const clicked = await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('循环：固定次数'));
    if (!el) return 'HOST_NOT_FOUND';
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
    return 'clicked';
  })()`);
  console.log('click =', clicked);
  await new Promise((r) => setTimeout(r, 600));
  console.log('selected cards =', await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card.fg-selected').length`));
  console.log('right panel exists =', await evaluate(page.cdp, `!!document.querySelector('.dsh-wf-right')`));
  console.log('panel rows =', JSON.stringify(await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].map((r) => (r.textContent || '').trim().slice(0, 30))`)));
  console.log('has 🔁 =', await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.textContent || '').includes('循环设置'))`));
  console.log('matched rows =', await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].filter((r) => (r.textContent || '').includes('循环设置')).length`));
  console.log('loop row html =', String(await evaluate(page.cdp, `(() => {
    const r = [...document.querySelectorAll('.dsh-wf-panel-row')].find((x) => (x.textContent || '').includes('循环设置'));
    return r ? r.outerHTML.slice(0, 700) : '(no row)';
  })()`)));
  console.log('selects in row =', await evaluate(page.cdp, `(() => {
    const r = [...document.querySelectorAll('.dsh-wf-panel-row')].find((x) => (x.textContent || '').includes('循环设置'));
    return r ? r.querySelectorAll('select').length : -1;
  })()`));
  console.log('right panels =', await evaluate(page.cdp, `document.querySelectorAll('.dsh-wf-right').length`));
  // ★ 照测试原样执行 select 赋值，看真实死因
  const trySet = await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('循环设置'));
    const sel = row ? row.querySelector('select') : null;
    const info = {
      hasRow: !!row, hasSel: !!sel,
      isSelect: sel instanceof window.HTMLSelectElement,
      ctor: sel ? sel.constructor.name : null,
      protoHasValue: !!Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value'),
      setterType: typeof Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set,
    };
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'over');
      info.setOk = true; info.valueAfter = sel.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      info.dispatched = true;
    } catch (e) { info.error = String(e && e.message); }
    return info;
  })()`);
  console.log('trySet =', JSON.stringify(trySet));
  await new Promise((r) => setTimeout(r, 500));
  console.log('after set, def params =', JSON.stringify(await evaluate(page.cdp, `window.__df_def?.nodes?.find((n) => n.id === 'loop_count')?.params ?? null`)));
  console.log('after set, subtitle =', String(await evaluate(page.cdp, `(() => { const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('循环：固定次数')); return c?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '(none)'; })()`)));
  console.log('panel html head =', String(await evaluate(page.cdp, `document.querySelector('.dsh-wf-right')?.innerHTML?.slice(0, 300) ?? '(no right)'`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
