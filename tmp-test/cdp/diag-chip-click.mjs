// tmp-test/cdp/diag-chip-click.mjs — 排查：① chip 点击后选中态没出现 ② ?many 夹具 8 条 case 线标签不见了
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9346 });
const errs = [];
try {
  // ===== ① chips 点击 =====
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-click&chips=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('多路分支：运行模式'))`, { timeout: 20000 });
  await sleep(400);
  const before = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const chips = [...card.querySelectorAll('.dsh-wf-fg-chip')];
    return chips.map((c) => {
      const r = c.getBoundingClientRect();
      return { t: c.textContent.trim(), cls: c.className, title: c.getAttribute('title') ?? '', pe: getComputedStyle(c).pointerEvents, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    });
  })()`);
  console.log('chips(before) =', JSON.stringify(before, null, 1));
  // 原生 click()
  await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('video'));
    chip.click();
    return true;
  })()`);
  await sleep(400);
  const afterNative = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    return { cls: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.className), sub: card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '' };
  })()`);
  console.log('after native click() =', JSON.stringify(afterNative));
  // 完整鼠标序列（mousedown→mouseup→click，含坐标）
  await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    const chip = [...card.querySelectorAll('.dsh-wf-fg-chip')].find((c) => c.textContent.includes('full'));
    const r = chip.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = document.elementFromPoint(x, y) ?? chip;
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
      t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window }));
    }
    return { hitCls: t.className, hitText: (t.textContent || '').trim() };
  })()`);
  await sleep(400);
  const afterSeq = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('多路分支：运行模式'));
    return { cls: [...card.querySelectorAll('.dsh-wf-fg-chip')].map((c) => c.className), sub: card.querySelector('.dsh-wf-fg-card-sub')?.textContent ?? '',
      portOrder: [...document.querySelectorAll('.workflow-port-render')].map((el) => el.getAttribute('data-port-id') ?? el.getAttribute('data-port-entity-id') ?? '') };
  })()`);
  console.log('after mouse seq =', JSON.stringify(afterSeq, null, 1));

  // ===== ② ?many 的 8 条 case 线 =====
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-many&many=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 3`, { timeout: 20000 });
  await sleep(600);
  const many = await evaluate(page.cdp, `(() => {
    const d = window.__df_def ?? {};
    return {
      defEdges: (d.edges ?? []).map((e) => e.from + '->' + e.to + (e.when ? '[' + e.when + ']' : '')),
      lineLabels: [...document.querySelectorAll('.dsh-wf-fg-line-label')].map((e) => e.textContent.trim()),
      svgLines: document.querySelectorAll('.gedit-flow-activity-edge').length,
      allLines: document.querySelectorAll('line, path').length,
    };
  })()`);
  console.log('many =', JSON.stringify(many, null, 1));
} catch (e) {
  errs.push(String(e));
} finally {
  if (errs.length) console.log('ERR: ' + errs.join(' | '));
  try { page.close(); } catch { /* */ }
  server.kill();
}
