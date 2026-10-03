// tmp-test/cdp/diag-result-tip.mjs — 诊断悬浮卡为什么不弹（一次性）
export async function run({ cdp, evaluate, waitFor, ok, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-badge')`, { timeout: 8000 });

  const dump = await evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')];
      return cards.map((c, i) => ({
        i,
        w: Math.round(c.getBoundingClientRect().width),
        badge: !!c.querySelector('.dsh-wf-fg-badge'),
        parent: (c.parentElement?.className ?? '').toString().slice(0, 60),
        inEditor: !!c.closest('.dsh-wf-fg-editor'),
        ancestor: (() => { let p = c.parentElement, out = []; for (let k = 0; k < 4 && p; k++) { out.push((p.className ?? '').toString().split(' ')[0]); p = p.parentElement; } return out.join(' < '); })(),
      }));
    })();
  `);
  console.log('  卡片清单：');
  for (const c of dump) console.log(`    #${c.i} w=${c.w} badge=${c.badge} inEditor=${c.inEditor} | ${c.ancestor}`);

  // 用「编辑器里第一张有徽标的卡」重试
  const hovered = await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-editor .dsh-wf-fg-card')].find((c) => c.querySelector('.dsh-wf-fg-badge'))
        ?? document.querySelector('.dsh-wf-fg-editor .dsh-wf-fg-card');
      if (!el) return 'no-card-in-editor';
      el.dispatchEvent(new MouseEvent('mouseenter'));
      return 'dispatched w=' + Math.round(el.getBoundingClientRect().width);
    })();
  `);
  console.log('  编辑器内悬浮结果：' + hovered);
  await sleep(400);
  const hooks = await evaluate(cdp, `JSON.stringify({ bound: window.__df_tipBound ?? null, show: window.__df_tipShow ?? null })`);
  console.log('  诊断钩子：' + hooks);
  const after = await evaluate(cdp, `
    (() => ({
      tips: document.querySelectorAll('.dsh-wf-fg-tip').length,
      bodyHtmlTail: document.body.innerHTML.includes('dsh-wf-fg-tip'),
      tipText: document.querySelector('.dsh-wf-fg-tip')?.textContent?.slice(0, 80) ?? '',
    }))();
  `);
  console.log('  悬浮后：' + JSON.stringify(after));

  // 退一步：直接看 store 里到底有没有这一项（徽标能显示说明有；这里确认 render 侧的 class 是否被替换）
  const cls = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].map((c) => c.className).join(' | ').slice(0, 300)`);
  console.log('  卡片 class：' + cls);
  ok(true, 'diag done');
}
