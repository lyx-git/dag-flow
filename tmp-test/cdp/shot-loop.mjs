// tmp-test/cdp/shot-loop.mjs — 一次性脚本：拍 loop 可见化（P1 副标题 / P2 面板 / P3 循环标记与运行徽标）
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9338 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-loop&loop=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  // 选中 loop_count，让右侧「🔁 循环设置」出现在同一张图里
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('循环：固定次数'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.textContent || '').includes('循环设置'))`, { timeout: 5000 });
  await sleep(700);
  await shot('tmp-test/loop-visible-real.png');

  // 再跑一次（fixture /run stub 返回 loop out.count=7）→ 拍运行后徽标
  await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);
  await waitFor(page.cdp, `(() => {
    const c = [...document.querySelectorAll('.dsh-wf-fg-card')].find((x) => (x.textContent || '').includes('循环：固定次数'));
    return (c?.querySelector('.dsh-wf-fg-badge')?.textContent ?? '').includes('循环 7 次');
  })()`, { timeout: 15000 });
  await sleep(400);
  await shot('tmp-test/loop-visible-run-real.png');

  const info = await evaluate(page.cdp, `(() => {
    const card = (kw) => [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.textContent.includes(kw));
    const sub = (kw) => (card(kw)?.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '').trim();
    return {
      副标题: { count: sub('循环：固定次数'), over: sub('循环：遍历数组'), while: sub('循环：条件'), none: sub('循环：无边界') },
      循环线标数: document.querySelectorAll('.dsh-wf-fg-line-label.is-loop').length,
      运行徽标: card('循环：固定次数')?.querySelector('.dsh-wf-fg-badge')?.textContent ?? '(无)',
    };
  })()`);
  console.log('已保存 tmp-test/loop-visible-real.png 与 tmp-test/loop-visible-run-real.png');
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
