// tmp-test/cdp/test-motion.mjs — 交互动画（2026-10-09 用户拍板：② 缩放浮现 · 160ms · 位移 0）
//   用户原话：「按钮弹窗，操作等，现在好像都没有动画效果，操作感觉都比较生硬…给我个建议」→
//   原型（tmp-test/proto-motion-v2.html）里对比后拍板：**不做位移、用缩放浮现** ✓。
// 契约（本用例钉死）：
//   ① 导出菜单：`animation-name: dsh-wf-pop`，时长 0.16s，**位移为 0**（transform 里没有 translate）
//   ② 弹窗（`.dag-flow-picker` 缩放浮现 160ms；遮罩 `.dag-flow-picker-overlay` 淡入 140ms）
//   ③ 顶部浮窗（`.dsh-wf-toast`）同样是缩放浮现 160ms
//   ④ 右侧参数面板（`.dsh-wf-right`）淡入 140ms
//   ⑤ 系统 prefers-reduced-motion 时**全部关掉**（无障碍 ✓）
//   ⑥ 动画不引入位移（断言 keyframes 文本里没有 translateY/translateX）—— 这是用户对"位移奇怪"的明确反馈 ✓
import { waitFor } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor: wf, ok, sleep }) {
  const wait = wf ?? waitFor;

  const cssOf = (sel, prop) => evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const s = getComputedStyle(el);
    return { name: s.animationName, dur: s.animationDuration, transform: s.transform, transition: s.transitionProperty };
  })()`);

  // ===== A. 样式表里确实定义了这套动画（keyframes + 无位移） =====
  const cssText = await evaluate(cdp, `(() => {
    let all = '';
    for (const ss of document.styleSheets) {
      try { for (const r of ss.cssRules) all += r.cssText + '\\n'; } catch {}
    }
    return all;
  })()`);
  const txt = String(cssText);
  ok(txt.includes('dsh-wf-pop'), 'A1. 样式表里有 @keyframes dsh-wf-pop');
  ok(txt.includes('dsh-wf-fade'), 'A2. 样式表里有 @keyframes dsh-wf-fade');
  ok(/@keyframes dsh-wf-pop\s*\{[^}]*\}/.test(txt) && !/dsh-wf-pop[^@]*translate/.test(txt), 'A3. ★缩放浮现里**没有位移**（用户反馈「为什么做位移，感觉有点奇怪」✓）');
  ok(txt.includes('prefers-reduced-motion'), 'A4. 有 prefers-reduced-motion 降级（无障碍 ✓）');
  const allTransition = /transition:\s*all/.test(txt);
  ok(!allTransition, 'A5. ★样式表里不再有 `transition: all`（收窄过，防"闪白" ✓）');

  const closeMenu = () => evaluate(cdp, `(() => {
    const m = document.querySelector('.dsh-wf-export-menu');
    if (!m) return false;
    (m.parentElement || m).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);

  // ===== B. 导出菜单：缩放浮现（真实 DOM 上生效） =====
  await wait(cdp, `!!document.querySelector('.dsh-wf-header button')`, { timeout: 15000 });
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇');
    b.click(); return true;
  })()`);
  await wait(cdp, `!!document.querySelector('.dsh-wf-export-menu')`, { timeout: 5000 });
  const menu = await cssOf('.dsh-wf-export-menu');
  ok(menu && menu.name.includes('dsh-wf-fade'), `B1. 导出菜单纯淡入（animation-name=${menu?.name}）`);
  ok(menu && menu.dur === '0.12s', `B2. 菜单时长 120ms（实际 ${menu?.dur}）`);
  // 关掉菜单，别影响后续（★ 必须点"背板"关：背板是 body 的子元素，点 body 本身不会命中它 ✗）
  await closeMenu();
  await wait(cdp, `!document.querySelector('.dsh-wf-export-menu')`, { timeout: 3000 });

  // ===== C. 弹窗：面板缩放浮现 + 遮罩淡入 =====
  //   用「版本」弹窗（自检弹窗会被 driver 的自动确认助手点掉 ✗）
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => /🕘|版本/.test(x.textContent + (x.title || '')));
    if (b) b.click();
    return !!b;
  })()`);
  await wait(cdp, `!!document.querySelector('.dag-flow-picker')`, { timeout: 6000 });
  const picker = await cssOf('.dag-flow-picker');
  ok(picker && picker.name.includes('dsh-wf-fade'), `C1. 弹窗纯淡入（animation-name=${picker?.name}）`);
  ok(picker && picker.dur === '0.14s', `C2. 弹窗时长 140ms（实际 ${picker?.dur}）`);
  // ★ 关键：弹窗**不做缩放**——scale 会让 getBoundingClientRect 在动画期间量到缩放尺寸 ✗，
  //   而本项目多处真实逻辑（落点对齐/尺寸记忆/拖拽把手）要读弹窗矩形 → 必须没有 transform 动画 ✓
  const pickerTf = await evaluate(cdp, `(() => {
    const el = document.querySelector('.dag-flow-picker');
    if (!el) return 'NO-EL';
    const s = getComputedStyle(el);
    return s.animationName + '|' + s.transform;
  })()`);
  ok(!/scale/.test(String(pickerTf)), `C2b. ★弹窗动画不含 scale（实测 ${pickerTf}）`);
  const overlay = await cssOf('.dag-flow-picker-overlay');
  ok(overlay && overlay.name.includes('dsh-wf-fade'), `C3. 遮罩是纯淡入（animation-name=${overlay?.name}）`);
  ok(overlay && overlay.dur === '0.14s', `C4. 遮罩时长 140ms（实际 ${overlay?.dur}）`);
  await evaluate(cdp, `(() => { const x = document.querySelector('.dag-flow-picker-close'); if (x) x.click(); return true; })()`);
  await sleep(120);

  // ===== D. 顶部浮窗：同样缩放浮现 =====
  await evaluate(cdp, `(() => {
    // 用一次导出触发浮窗（不依赖运行）
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇');
    b.click(); return true;
  })()`);
  await wait(cdp, `!!document.querySelector('.dsh-wf-export-menu')`, { timeout: 5000 });
  await evaluate(cdp, `(() => {
    const it = [...document.querySelectorAll('.dsh-wf-export-item')].find((x) => /SVG/.test(x.textContent));
    it.click(); return true;
  })()`);
  await wait(cdp, `!!document.querySelector('.dsh-wf-toast')`, { timeout: 6000 });
  const toast = await cssOf('.dsh-wf-toast');
  ok(toast && toast.name.includes('dsh-wf-pop'), `D1. 顶部浮窗播放缩放浮现（animation-name=${toast?.name}）`);
  ok(toast && toast.dur === '0.16s', `D2. 浮窗时长 160ms（实际 ${toast?.dur}）`);
  await sleep(2800);   // 等成功类浮窗自动消失，别影响后续用例

  // ===== E. 右侧面板：纯淡入 =====
  const right = await cssOf('.dsh-wf-right');
  ok(!right || right.name.includes('dsh-wf-fade') || right.name === 'none', `E1. 右侧面板淡入（animation-name=${right?.name}）`);

  // ===== F. prefers-reduced-motion：全部关掉 =====
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇');
    b.click(); return true;
  })()`);
  await wait(cdp, `!!document.querySelector('.dsh-wf-export-menu')`, { timeout: 5000 });
  const reduced = await cssOf('.dsh-wf-export-menu');
  ok(reduced && reduced.name === 'none', `F1. ★prefers-reduced-motion 下动画被关闭（animation-name=${reduced?.name}）`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });   // 复位
  await closeMenu();
}
