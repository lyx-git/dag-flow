// tmp-test/cdp/shot-autopass.mjs — 拍实装效果：非交互运行下 manual 节点「自动通过」的显形（用户拍板 A 方案）
//   ①画布徽标「⏭ 自动通过」+ 悬浮卡说明「不是失败，也不代表有人确认过」
//   ②⏰ 定时任务弹窗提前说明「本工作流含人工确认节点 → 定时跑不会停下来等确认」
// 用法：node tmp-test/cdp/shot-autopass.mjs   （工作目录 = dag-flow 仓库根）
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

const page = await launchPage({ port: 9371 });
try { await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }); } catch { /* */ }

const NAME = 'shot-autopass';
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=${encodeURIComponent(NAME)}&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(600);
  const ids = await evaluate(page.cdp, `(window.__df_def?.nodes ?? []).map((n) => n.id)`);

  // 从左侧面板拖一个「手动确认」节点进画布（与 test-sched-run 同一手法）
  const beforeAdd = await evaluate(page.cdp, `window.__df_def?.nodes?.length ?? -1`);
  await evaluate(page.cdp, `
    (() => {
      const item = [...document.querySelectorAll('.dsh-wf-fg-palette-item')].find((el) => (el.textContent || '').includes('手动确认'));
      if (!item) return false;
      const r = item.getBoundingClientRect();
      const sx = r.left + 5, sy = r.top + 5;
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
      const editor = document.querySelector('.dsh-wf-fg-editor');
      const er = editor.getBoundingClientRect();
      const ex = er.left + er.width * 0.42, ey = er.top + er.height * 0.62;
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx + 12, clientY: sy + 12 }));
      document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: ex, clientY: ey }));
      return true;
    })(); true;
  `);
  await waitFor(page.cdp, `(window.__df_def?.nodes?.length ?? 0) > ${beforeAdd >= 0 ? beforeAdd : 0}`, { timeout: 8000 });
  const manualId = await evaluate(page.cdp, `(window.__df_def?.nodes ?? []).find((n) => n.type === 'manual')?.id ?? ''`);
  console.log('manual 节点 id = ' + manualId);

  // 宿主侧（= 定时触发语义）跑一遍，manual 的 out 带 autoPassed:true，客户端零点击
  await evaluate(page.cdp, `(async () => {
    await fetch('/__host-run', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: ${JSON.stringify(NAME)},
        ids: ${JSON.stringify(ids)}.concat([${JSON.stringify(manualId)}]),
        stage: ${ids.length + 1},
        outs: { [${JSON.stringify(manualId)}]: { prompt: '继续生成日报？', confirmed: true, autoPassed: true, value: '', confirmedAt: new Date().toISOString() } },
      }) });
    return true;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-badge.is-auto')`, { timeout: 12000 });

  // 悬浮该 manual 节点 → 悬浮卡
  await evaluate(page.cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge.is-auto'));
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.dispatchEvent(new MouseEvent('mouseenter'));
      }
      return !!el;
    })(); true;
  `);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-fg-tip')`, { timeout: 4000 });
  await sleep(400);

  const s1 = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('tmp-test/autopass-badge-real.png', Buffer.from(s1.data, 'base64'));
  console.log('已保存 tmp-test/autopass-badge-real.png');
  console.log(JSON.stringify(await evaluate(page.cdp, `(() => ({
    badge: document.querySelector('.dsh-wf-fg-badge.is-auto')?.textContent ?? '',
    badgeColor: (() => { const b = document.querySelector('.dsh-wf-fg-badge.is-auto'); return b ? getComputedStyle(b).color : null; })(),
    tip: document.querySelector('.dsh-wf-fg-tip')?.textContent ?? '',
  }))()`), null, 1));

  await evaluate(page.cdp, `document.querySelector('.dsh-wf-fg-tip')?.dispatchEvent(new MouseEvent('mouseleave')); true;`);
  await sleep(200);

  // ⓶ ⏰ 定时任务弹窗（本工作流含 manual → 应有说明行）
  await evaluate(page.cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'));
    b?.click();
    return !!b;
  })()`);
  await waitFor(page.cdp, `!!document.querySelector('.dsh-wf-sched')`, { timeout: 8000 });
  await sleep(400);
  const s2 = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('tmp-test/autopass-sched-note-real.png', Buffer.from(s2.data, 'base64'));
  console.log('已保存 tmp-test/autopass-sched-note-real.png');
  console.log('弹窗提示行：' + JSON.stringify(await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched-note')?.textContent ?? ''`)));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
