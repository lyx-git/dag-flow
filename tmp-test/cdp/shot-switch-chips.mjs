// tmp-test/cdp/shot-switch-chips.mjs — 拍 switch「横排 chips」实装效果（4 个 case + 兜底 = 5 个出口）
// 同时打印行序号与端口圆点的实测纵坐标，用来人工核对「端口 ↔ 行号 ↔ chip」是否对齐。
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

const page = await launchPage({ port: 9344 });
const shot = async (file) => {
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=shot-switch-chips&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  await sleep(700);
  // 悬停第 3 个 chip，让「chip ↔ 端口行」的对应关系出现在截图里
  await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    window.__df_fire(card.querySelectorAll('.dsh-wf-fg-chip')[2], 'mouseover');
    return true;
  })()`);
  await sleep(400);
  await shot('tmp-test/switch-chips-real.png');

  const info = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const r = card.getBoundingClientRect();
    const cy = (el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
    const dots = [...document.querySelectorAll('.workflow-point-bg')]
      .map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })
      .filter((p) => p.x > r.left - 20 && p.x < r.right + 20 && p.y > r.top - 20 && p.y < r.bottom + 20);
    return {
      card: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      rows: [...card.querySelectorAll('.dsh-wf-fg-rou')].map((el) => ({ t: el.textContent, y: cy(el) })),
      dots,
      chips: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((el) => ({ t: el.textContent, hl: el.className.includes('hl') })),
    };
  })()`);
  console.log('已保存 tmp-test/switch-chips-real.png');
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
