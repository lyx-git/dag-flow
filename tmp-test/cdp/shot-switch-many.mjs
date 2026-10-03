// tmp-test/cdp/shot-switch-many.mjs — 拍「很多 case 的 switch」画布态（用户报「case 超出节点」）
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
const page = await launchPage({ port: 9340 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-many&many=1`);
  await installHelpers(page.cdp);
  // ★ 紧凑策略下 case ≥7 会隐藏卡内标签，所以等「卡片出现」而不是等标签
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('分支很多'))`, { timeout: 20000 });
  // 通过右面板加到 20 个 case
  await evaluate(page.cdp, `(() => {
    const hosts = window.__df_qa('.dsh-wf-fg-node-host');
    const el = hosts.find((h) => (h.textContent || '').includes('分支很多'));
    window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
  })(); true;`);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.textContent || '').includes('分支设置'))`, { timeout: 5000 });
  for (let i = 0; i < 12; i++) {
    await evaluate(page.cdp, `(() => { document.querySelector('.dsh-wf-inputs-add')?.click(); })(); true;`);
    await sleep(60);
  }
  await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('分支设置'));
    const inputs = [...row.querySelectorAll('input')].filter((i) => (i.placeholder || '').includes('case 值'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    inputs.forEach((inp, i) => { if (!inp.value) { setter.call(inp, 'extra' + (i + 1)); inp.dispatchEvent(new Event('input', { bubbles: true })); } });
  })(); true;`);
  await sleep(1200);
  // 把画布缩到能看全（滚轮缩放不可靠，直接用 PlaygroundConfig 改 zoom 也未必可达；这里只截图当前视口）
  await shot('tmp-test/switch-many-cases-real.png');
  const info = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('分支很多'));
    const host = card?.closest('.dsh-wf-fg-node-host') || card?.parentElement;
    const cr = card.getBoundingClientRect(), hr = host.getBoundingClientRect();
    return {
      caseCount: Object.keys(window.__df_def?.nodes?.find((n) => n.id === 'sw_many')?.params?.cases ?? {}).length,
      cardLayoutH: card.offsetHeight, hostLayoutH: host.offsetHeight,
      cardRectH: Math.round(cr.height), hostRectH: Math.round(hr.height),
      cardBottomMinusHostBottom: Math.round(cr.bottom - hr.bottom),
      lastLabelText: [...card.querySelectorAll('.dsh-wf-fg-branch-label')].pop()?.textContent,
      cardInViewport: cr.top >= 0 && cr.bottom <= window.innerHeight,
    };
  })()`);
  console.log('已保存 tmp-test/switch-many-cases-real.png');
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
