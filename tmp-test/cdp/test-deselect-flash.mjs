// tmp-test/cdp/test-deselect-flash.mjs — 取消选中闪空白回归（用户 2026-10-01 夜）：
// 选中节点 → 点击空白画布取消选中 → 逐帧采样卡片背景色 400ms。
// 旧实现：选中态 background:linear-gradient 简写把 background-color 置 transparent，
// 取消选中时渐变图瞬时消失、颜色从透明渐回 → 中途出现 rgba alpha<1 的「空白帧」。
// 修复后：纯色可插值背景，全程不透明。
export async function run({ cdp, evaluate, waitFor, ok, eq }) {
  // 等画布节点卡渲染完成（编辑器出现 ≠ 卡片已挂载——竞态曾致 getComputedStyle(undefined) 偶发失败）
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  // 基准色（未选中态）：取主题 token 实际渲染值，不硬编码 CSS fallback
  const baseC = await evaluate(cdp, `getComputedStyle(document.querySelectorAll('.dsh-wf-fg-card')[0]).backgroundColor`);

  // 选中节点
  await evaluate(cdp, `window.__df_clickNode(0)`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`, { timeout: 5000 });

  // 注入采样器：点空白取消选中 + rAF 逐帧采样（真实时钟，无虚拟时间伪影）
  await evaluate(cdp, `
    window.__df_sampleDeselect = async () => {
      const card = document.querySelector('.dsh-wf-fg-card.fg-selected');
      const editor = document.querySelector('.dsh-wf-fg-editor');
      if (!card || !editor) throw new Error('没有选中卡片或编辑器');
      const r = editor.getBoundingClientRect();
      const x = r.left + r.width * 0.75, y = r.top + r.height * 0.85;
      const parse = (c) => {
        const m = c.match(/rgba?\\(([^)]+)\\)/);
        if (m) {
          const p = m[1].split(/[,\\/\\s]+/).filter(Boolean).map(Number);
          return { a: p.length >= 4 ? p[3] : 1, rgb: [p[0], p[1], p[2]] };
        }
        const m2 = c.match(/color\\(([^)]+)\\)/);
        if (m2) {
          const hasAlpha = c.includes('/');
          const parts = m2[1].trim().split(/\\s+/);
          const a = hasAlpha ? Number(parts[parts.length - 1]) : 1;
          const nums = parts.filter((t) => /^[\\d.]+$/.test(t)).map(Number);
          return { a, rgb: nums.slice(0, 3).map((v) => Math.round(v * 255)) };
        }
        return { a: 1, rgb: null };
      };
      window.__df_rgbOf = parse;
      window.__df_fire(editor, 'mousedown', x, y);
      window.__df_fire(editor, 'click', x, y);
      const samples = [];
      const t0 = performance.now();
      for (;;) {
        const c = getComputedStyle(card).backgroundColor;
        const p = parse(c);
        samples.push({ t: Math.round(performance.now() - t0), a: p.a, rgb: p.rgb });
        if (performance.now() - t0 > 400) break;
        await new Promise((res) => requestAnimationFrame(res));
      }
      return samples;
    };
    true;
  `);
  const samples = await evaluate(cdp, `window.__df_sampleDeselect()`);
  ok(Array.isArray(samples) && samples.length >= 5, '采样帧数足够（' + (samples?.length ?? 0) + ' 帧）');

  const transparent = samples.filter((s) => s.a < 1);
  eq(transparent.length, 0, '全程背景不透明（透明帧: ' + JSON.stringify(transparent.slice(0, 3)) + '）');

  // 末帧回落到未选中基准色（对比 baseC 实测值，容忍 ±2 量化误差）
  const base = await evaluate(cdp, `window.__df_rgbOf(${JSON.stringify(baseC)})`);
  const last = samples[samples.length - 1];
  ok(last.rgb && base.rgb, '背景色可解析: last=' + JSON.stringify(last) + ' base=' + JSON.stringify(base));
  const drift = Math.max(...base.rgb.map((v, i) => Math.abs(v - last.rgb[i])));
  ok(drift <= 2, '取消选中后背景回落基准色 ' + JSON.stringify(base.rgb) + '（实际 rgb(' + last.rgb.join(',') + ')）');

  // 取消选中确实生效 + 可重新选中
  ok(await evaluate(cdp, `!document.querySelector('.dsh-wf-fg-card.fg-selected')`), 'fg-selected 类已移除');
  await evaluate(cdp, `window.__df_clickNode(0)`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`, { timeout: 5000 });
}
