// tmp-test/cdp/shot-proto.mjs — 给本地 HTML 原型拍图（复用 CDP driver，CHROME_PATH 与测试一致）
//   用法：node tmp-test/cdp/shot-proto.mjs tmp-test/proto-group-comment.html tmp-test/proto-group-comment.png [宽 高]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchPage, goto, sleep } from './driver.mjs';

const src = resolve(process.argv[2] ?? 'tmp-test/proto-group-comment.html');
const out = resolve(process.argv[3] ?? 'tmp-test/proto-group-comment.png');
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 900);

const page = await launchPage({ port: 9399 });
try {
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await goto(page.cdp, pathToFileURL(src).href);
  await sleep(500);
  // 整页高度（原型可能超出视口）
  const ph = await page.cdp.send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
  const full = Math.max(height, Number(ph?.result?.value ?? height));
  const r = await page.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: full, scale: 1 } });
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log(`已保存 ${out}（${width}x${full}）`);
} finally {
  try { page.close(); } catch { /* */ }
}
