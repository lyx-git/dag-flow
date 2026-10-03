// tmp-test/cdp/shot-copy-toast.mjs — 一次性截图：右侧面板点变量 chip → 浮窗「已复制 xxxx」（2026-10-03 用户要求）
// 用法：node tmp-test/cdp/shot-copy-toast.mjs   （工作目录 = dag-flow 仓库根）
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
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-copy-toast&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  const shot = async (file) => {
    const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('已保存 ' + file);
  };
  // headless 下 navigator.clipboard.writeText 可能被拒（非用户手势/权限），而复制反馈只在写入成功后出现
  // → 像 CDP 用例那样把它替换成必定成功的探针，还原真机（127.0.0.1 是安全上下文、点击即授权）的条件
  await evaluate(page.cdp, `(() => {
    window.__copied = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
      });
    } catch { /* 忽略 */ }
    return true;
  })()`);
  // 选中 py 节点（有 2 个上游），面板出现变量 chips
  await evaluate(page.cdp, `(() => {
    const hosts = [...document.querySelectorAll('.dsh-wf-fg-node-host')];
    const i = hosts.findIndex((h) => (h.textContent || '').includes(' · py'));
    window.__df_clickNode(i);
    return i;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-var-group')`, { timeout: 8000 });
  await sleep(400);
  // 点一个「输出变量」chip（本节点输出组）→ 浮窗应立刻出现
  const clicked = await evaluate(page.cdp, `(() => {
    const chips = [...document.querySelectorAll('.dsh-wf-var-chip')];
    const c = chips.find((x) => x.textContent.trim().includes('.out.count')) ?? chips[chips.length - 1];
    c.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return c.textContent.trim();
  })()`);
  await sleep(220);
  const toast = await evaluate(page.cdp, `(() => { const t = document.querySelector('.dsh-wf-copy-toast'); if (!t) return { missing: true, copied: window.__copied ?? [] }; const r = t.getBoundingClientRect(); return { text: t.textContent, pos: getComputedStyle(t).position, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] }; })()`);
  console.log('点击的 chip：' + clicked);
  console.log('浮窗：' + JSON.stringify(toast));
  await shot('tmp-test/copy-toast-real.png');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
