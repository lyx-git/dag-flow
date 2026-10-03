// tmp-test/cdp/probe-live-gui.mjs — 用 CDP 把**真实 GUI**（http://127.0.0.1:3080）开进 headless Chrome：
//   ①读客户端标记（判断用户浏览器里跑的是哪版 bundle）
//   ②看 dag-flow 面板能不能挂起来（真机复现的前提）
//   ③截图 tmp-test/live-gui.png
import { writeFileSync } from 'node:fs';
import { launchPage, evaluate, waitFor, sleep } from './driver.mjs';

const URL = process.env.GUI_URL ?? 'http://127.0.0.1:3080';
const page = await launchPage({ port: 9352 });
const logs = [];
try {
  // ★必须在导航前开 Runtime 并挂 handler，否则错过启动期 console
  await page.cdp.send('Page.enable');
  await page.cdp.send('Runtime.enable');
  page.cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${p.type}] ${text}`);
  });
  page.cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails ?? {};
    logs.push('[exception] ' + (d.exception?.description ?? d.text ?? '').split('\n')[0]);
  });

  await page.cdp.send('Page.navigate', { url: URL });
  try {
    await waitFor(page.cdp, `document.readyState === 'complete' && document.body && document.body.innerText.length > 20`, { timeout: 25000 });
  } catch (e) {
    console.log('导航/首屏等待失败：' + e.message);
  }
  await sleep(3000);   // 给客户端插件 apply + 面板渲染留时间

  const info = await evaluate(page.cdp, `(() => {
    const txt = (document.body?.innerText ?? '');
    return {
      title: document.title,
      url: location.href,
      bodyLen: txt.length,
      head: txt.slice(0, 200).replace(/\\n+/g, ' | '),
      hasBoot: !!window.__DSH_BOOT__,
      sidebarEntries: [...document.querySelectorAll('button,a,[role=button]')].map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 24).slice(0, 40),
      dagFlowWin: !!document.querySelector('.dsh-wf-win'),
      editor: !!document.querySelector('.dsh-wf-fg-editor'),
      panels: document.querySelectorAll('.dsh-wf-card, .dsh-wf-btn').length,
    };
  })()`);
  const shot = await page.cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tmp-test/live-gui.png', Buffer.from(shot.data, 'base64'));

  console.log('=== 页面 ===');
  console.log(JSON.stringify(info, null, 1));
  console.log('=== 控制台（含客户端标记）===');
  console.log(logs.filter((l) => l.includes('dag-flow') || l.includes('exception')).join('\n') || '(无 dag-flow 相关日志)');
  console.log('=== 全部控制台 ===');
  console.log(logs.slice(0, 40).join('\n') || '(空)');
  console.log('截图：tmp-test/live-gui.png');
} finally {
  try { page.close(); } catch { /* */ }
}
