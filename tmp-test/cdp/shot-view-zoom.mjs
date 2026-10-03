// tmp-test/cdp/shot-view-zoom.mjs — 一次性截图脚本：画布视图控件（进画布 75% / 一键 1:1 100% / 适应画布 50%）
// 用法：node tmp-test/cdp/shot-view-zoom.mjs   （工作目录 = dag-flow 仓库根）
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

const shot = async (cdp, file) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('已保存 ' + file);
};

const page = await launchPage({ port: 9337 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-view-zoom&big=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await sleep(1400);   // 等初始视图（首帧 + 40ms 重试）落定

  const state = async () => evaluate(page.cdp, `({
    zoom: Math.round((window.__df_initialView?.zoom ?? 0) * 100) + '%',
    readout: (document.querySelector('.dsh-wf-fg-zoom')?.textContent ?? '').trim(),
    cards: document.querySelectorAll('.dsh-wf-fg-card').length,
  })`);

  console.log('进画布：' + JSON.stringify(await state()));
  await shot(page.cdp, 'tmp-test/view-zoom-entry.png');

  await evaluate(page.cdp, `document.querySelector('.dsh-wf-fg-zoom').click(); true;`);
  await sleep(700);
  console.log('点百分比（1:1）：' + JSON.stringify(await state()));
  await shot(page.cdp, 'tmp-test/view-zoom-100.png');

  await evaluate(page.cdp, `([...document.querySelectorAll('.dsh-wf-fg-tb')].find((b) => b.title.startsWith('适应画布'))).click(); true;`);
  await sleep(700);
  console.log('点适应画布：' + JSON.stringify({ ...(await state()), fit: await evaluate(page.cdp, `window.__df_lastFit ?? null`) }));
  await shot(page.cdp, 'tmp-test/view-zoom-fit.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
