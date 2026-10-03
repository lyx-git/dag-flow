// tmp-test/cdp/debug-save.mjs — 诊断「手动保存未落盘」：包装 fetch 记录请求/响应 + 服务器状态转储
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, installHelpers, waitFor, sleep, lastPageError } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => console.log('[server]', String(d).trim()));
server.stderr.on('data', (d) => console.log('[server:err]', String(d).trim()));
for (let i = 0; i < 80; i++) { try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); break; } catch { await sleep(100); } }

const name = 'dbg-' + Date.now().toString(36);
const page = await launchPage({ port: 9334 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=${encodeURIComponent(name)}`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await evaluate(page.cdp, `
    window.__df_reqs = [];
    const __of = window.fetch.bind(window);
    window.fetch = (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? String(args[0]));
      return __of(...args).then(async (r) => {
        let body = ''; try { body = (await r.clone().text()).slice(0, 300); } catch {}
        window.__df_reqs.push({ url, method: args[1]?.method ?? 'GET', status: r.status, body });
        return r;
      }).catch((e) => { window.__df_reqs.push({ url, err: String(e) }); throw e; });
    };
    true;
  `);
  await evaluate(page.cdp, `window.__df_clickBtn('保存')`);
  await sleep(2500);
  console.log('REQS:', JSON.stringify(await evaluate(page.cdp, `window.__df_reqs`), null, 1));
  console.log('defNodes:', await evaluate(page.cdp, `window.__df_def?.nodes?.length`),
    '| defName:', await evaluate(page.cdp, `window.__df_def?.name`),
    '| inputName:', await evaluate(page.cdp, `document.querySelector('.dsh-wf-name-input')?.value`));
  console.log('titleSubs:', JSON.stringify(await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-title-sub')].map(e => e.textContent)`)));
  console.log('pageError:', lastPageError());
  const wf = await fetch(`${BASE}/api/dag-flow/workflows/${encodeURIComponent(name)}`).then((r) => r.text()).catch((e) => 'ERR ' + e.message);
  console.log('SERVER GET:', String(wf).slice(0, 200));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
