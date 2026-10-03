// tmp-test/cdp/diag-switch-many.mjs — 量测：switch case 很多时，卡片/节点宿主/端口/标签的几何关系
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
console.log('fixture up =', up);
const page = await launchPage({ port: 9339 });
try {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-many&many=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-branch-label').length >= 8`, { timeout: 20000 });
  await sleep(400);
  // 先把 case 加到 20 个（走右面板的「+」按钮），看极端情况
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
  // 给 12 个新空行填上 case 名（空键不写入 params，所以必须填）
  await evaluate(page.cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('分支设置'));
    const inputs = [...row.querySelectorAll('input')].filter((i) => (i.placeholder || '').includes('case 值'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    inputs.forEach((inp, i) => { if (!inp.value) { setter.call(inp, 'extra' + (i + 1)); inp.dispatchEvent(new Event('input', { bubbles: true })); } });
    return inputs.length;
  })(); true;`);
  await sleep(800);
  const geo = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes('分支很多'));
    if (!card) return { err: 'card not found' };
    const host = card.closest('.dsh-wf-fg-node-host') || card.parentElement;
    const labels = [...card.querySelectorAll('.dsh-wf-fg-branch-label')];
    const cr = card.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const lbl = labels.map((l) => {
      const r = l.getBoundingClientRect();
      return { text: l.textContent.trim(), topInCard: Math.round(r.top - cr.top), bottomInCard: Math.round(r.bottom - cr.top) };
    });
    const cs = getComputedStyle(card);
    const hs = getComputedStyle(host);
    return {
      cardRect: { w: Math.round(cr.width), h: Math.round(cr.height) },
      hostRect: { w: Math.round(hr.width), h: Math.round(hr.height) },
      cardMinHeightStyle: card.style.minHeight || '(none)',
      cardOverflow: cs.overflow,
      cardHeightStyle: card.style.height || '(none)',
      hostOverflow: hs.overflow,
      hostHeightStyle: host.style.height || '(none)',
      hostTransformSize: host.style.transform || '(none)',
      labelCount: labels.length,
      lastLabelBottom: lbl.length ? lbl[lbl.length - 1].bottomInCard : null,
      labelsOverCard: lbl.filter((x) => x.bottomInCard > Math.round(cr.height)).map((x) => x.text),
      // ★ 横向越界实测：标签右边缘相对卡片右边缘（正数=伸出卡片外）
      labelX: (() => {
        const rows = labels.map((l) => {
          const r = l.getBoundingClientRect();
          return { text: l.textContent.trim(), leftRel: +(r.left - cr.left).toFixed(1), rightRel: +(r.right - cr.left).toFixed(1), w: +(r.width).toFixed(1) };
        });
        return { cardW: +cr.width.toFixed(1), maxRightRel: Math.max(...rows.map((x) => x.rightRel)), sample: rows.slice(0, 3) };
      })(),
      portEls: [...document.querySelectorAll('[class*=port],[class*=Port]')].map((p) => {
        const r = p.getBoundingClientRect();
        return { cls: String(p.className).slice(0, 50), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      }).slice(0, 8),
      labels: lbl,
      ports: [...host.querySelectorAll('*')].filter((p) => /top:\\s*\\d+px/.test(p.getAttribute('style') || '')).map((p) => {
        const r = p.getBoundingClientRect();
        return { cls: String(p.className).slice(0, 46), styleTop: p.getAttribute('style'), topInCard: Math.round(r.top - cr.top), h: Math.round(r.height) };
      }).slice(0, 26),
      hostChildren: [...host.children].map((c) => ({ cls: String(c.className).slice(0, 46), style: (c.getAttribute('style') || '').slice(0, 60) })),
      paramsCaseCount: Object.keys((window.__df_def?.nodes?.find((n) => n.id === 'sw_many')?.params?.cases) ?? {}).length,
    };
  })()`);
  console.log(JSON.stringify(geo, null, 1));
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
