// tmp-test/cdp/shot-branch.mjs — 一次性脚本：拍分支键显形 + 就地编辑的真实渲染（交付证据）
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

const page = await launchPage({ port: 9337 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-branch&branch=1`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-line-label').length >= 5`, { timeout: 20000 });
  await sleep(600);
  await shot('tmp-test/branch-labels-real.png');

  // 打开就地编辑器（点 quick 标签）
  await evaluate(page.cdp, `(() => {
    const el = [...document.querySelectorAll('.dsh-wf-fg-line-label')].find((x) => x.textContent.trim() === 'quick');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }));
  })(); true;`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-bedit')`, { timeout: 5000 });
  await sleep(400);
  await shot('tmp-test/branch-edit-real.png');

  const info = await evaluate(page.cdp, `(() => {
    const card = (kw) => [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.textContent.includes(kw));
    const sw = card('模式分支');
    return {
      lineLabels: [...document.querySelectorAll('.dsh-wf-fg-line-label')].map((el) => el.textContent.trim()).sort(),
      switchCardH: Math.round(sw.getBoundingClientRect().height),
      editKeys: [...document.querySelectorAll('.dsh-wf-fg-bedit-key')].map((b) => b.textContent.trim()),
    };
  })()`);
  console.log('已保存 tmp-test/branch-labels-real.png 与 tmp-test/branch-edit-real.png');
  console.log(JSON.stringify(info));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
