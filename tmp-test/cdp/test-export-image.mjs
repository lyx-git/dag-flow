// tmp-test/cdp/test-export-image.mjs — 「导出图片（PNG）」（2026-10-09 用户需求）
//   用户原话：「导出 json 已经有导出按钮了，导出图片可以集成到一起」。
// 契约（本用例钉死）：
//   ① 头部 ⬇ 按钮点开**导出菜单**（含「导出 JSON」与「导出图片（PNG）」两项）
//   ② 点「导出图片（PNG）」→ 触发下载，文件名 `<工作流名>.png`
//   ③ 下载的 blob **真的是 PNG**（读前 8 字节校验 PNG 魔数 89 50 4E 47）
//   ④ 导出后浮窗提示（成功类，自动消失）
//   ⑤ 点菜单外关闭菜单；菜单项不残留
// 手段：在页面里劫持 `HTMLAnchorElement.prototype.click` 记录 (download, href)，
//   再用 fetch(href) 读回 blob 校验魔数 —— 这是"真产出 PNG"的硬证据（不是只看有没有报错）。
import { waitFor } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor: wf, ok, eq, sleep }) {
  const wait = wf ?? waitFor;

  await wait(cdp, `!!document.querySelector('.dsh-wf-btn')`, { timeout: 15000 });

  // 劫持下载：记录每次 <a download> 点击，并**同步**读回内容（blob URL 在 click 后会被立刻 revoke ✗，
  //   所以必须在劫持里就发起读取，不能等测试稍后回来 fetch）
  await evaluate(cdp, `(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        const rec = { name: this.download, href: this.href, head: null, text: null };
        window.__dl.push(rec);
        try {
          fetch(this.href).then((r) => r.arrayBuffer()).then((b) => { rec.head = Array.from(new Uint8Array(b).slice(0, 8)); }).catch(() => {});
          // SVG（文本）额外读全文——用于断言内容与完整性
          if (/\\.svg$/i.test(this.download)) {
            fetch(this.href).then((r) => r.text()).then((t) => { rec.text = t; }).catch(() => {});
          }
        } catch {}
      }
      return orig.apply(this, arguments);
    };
    return true;
  })()`);

  const openMenu = () => evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const menuItems = () => evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-export-item')].map((x) => x.textContent.trim())`);

  // ===== A. ⬇ 打开导出菜单（JSON + 图片两项都在） =====
  ok(await openMenu(), 'A1. 找到并点击头部 ⬇ 导出按钮');
  await wait(cdp, `document.querySelectorAll('.dsh-wf-export-item').length >= 2`, { timeout: 4000 });
  const items = await menuItems();
  ok(items.some((s) => /导出 JSON/.test(s)), `A2. 菜单含「导出 JSON」（实际 ${JSON.stringify(items)}）`);
  ok(items.some((s) => /导出图片/.test(s)), 'A3. 菜单含「导出图片（PNG）」');
  ok(await evaluate(cdp, `(() => {
    const m = document.querySelector('.dsh-wf-export-menu');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇').getBoundingClientRect();
    return r.top >= b.bottom - 2 && r.left >= 0 && r.width > 0;   // 锚定在按钮下方
  })()`), 'A4. 菜单锚定在 ⬇ 按钮正下方（fixed，不被头部裁切）');

  // ===== B. 点「导出图片（PNG）」→ 真的产出 PNG =====
  await evaluate(cdp, `(() => {
    const it = [...document.querySelectorAll('.dsh-wf-export-item')].find((x) => /导出图片/.test(x.textContent));
    it.click();
    return true;
  })()`);
  await wait(cdp, `(window.__dl || []).length > 0`, { timeout: 15000 });
  await wait(cdp, `(window.__dl[0].head || []).length === 8`, { timeout: 15000 });
  const dl = await evaluate(cdp, `window.__dl[0]`);
  ok(/\.png$/.test(dl.name), `B1. 下载文件名是 .png（实际 ${JSON.stringify(dl.name)}）`);
  ok(String(dl.href).startsWith('blob:'), `B2. 用 blob URL 下载（实际 ${String(dl.href).slice(0, 24)}…）`);
  // ★ PNG 魔数：89 50 4E 47 0D 0A 1A 0A（用字符串比较——driver 的 eq 对数组判定与预期不同 ✗）
  ok(Array.isArray(dl.head) && dl.head.join(',') === '137,80,78,71,13,10,26,10',
    `B3. ★下载内容是真 PNG（魔数实际 ${JSON.stringify(dl.head)}）`);
  ok(await evaluate(cdp, `(document.body.textContent || '').includes('已导出图片')`), 'B4. 导出后浮窗提示「已导出图片（N 节点 · M 连线）」');
  ok(!(await evaluate(cdp, `!!document.querySelector('.dsh-wf-export-menu')`)), 'B5. 导出后菜单自动关闭');

  // ===== C. 导出 SVG（矢量）——同菜单第三项，内容是 <svg …> =====
  await openMenu();
  await wait(cdp, `document.querySelectorAll('.dsh-wf-export-item').length >= 3`, { timeout: 4000 });
  const items3 = await menuItems();
  ok(items3.some((s) => /SVG/.test(s)), `C1. 菜单含「导出矢量图（SVG）」（实际 ${JSON.stringify(items3)}）`);
  await evaluate(cdp, `(() => {
    const it = [...document.querySelectorAll('.dsh-wf-export-item')].find((x) => /SVG/.test(x.textContent));
    it.click();
    return true;
  })()`);
  await wait(cdp, `(window.__dl || []).length >= 2`, { timeout: 8000 });
  await wait(cdp, `typeof window.__dl[1].text === 'string' && window.__dl[1].text.length > 0`, { timeout: 8000 });
  const svg = await evaluate(cdp, `window.__dl[1]`);
  ok(/\.svg$/.test(svg.name), `C2. 下载文件名是 .svg（实际 ${JSON.stringify(svg.name)}）`);
  const svgText = String(svg.text ?? '');
  const nodeRects = (svgText.match(/<rect /g) ?? []).length;
  ok(svgText.startsWith('<svg '), `C3. ★SVG 内容以 <svg 开头（实际 ${JSON.stringify(svgText.slice(0, 40))}…）`);
  ok(svgText.trim().endsWith('</svg>'), 'C4. SVG 以 </svg> 收尾（完整文件）');
  ok(nodeRects >= 3, `C5. SVG 里有节点矩形（rect 数 ${nodeRects}）`);
  ok(svgText.includes('font-family') && svgText.includes('viewBox'), 'C6. SVG 自带样式与 viewBox（自包含、可离线打开）');
  ok(await evaluate(cdp, `(document.body.textContent || '').includes('已导出矢量图')`), 'C7. 导出后有浮窗提示');

  // ===== D. 导出 JSON 仍照旧可用（同一个菜单里的老功能没被破坏） =====
  await openMenu();
  await wait(cdp, `document.querySelectorAll('.dsh-wf-export-item').length >= 3`, { timeout: 4000 });
  await evaluate(cdp, `(() => {
    const it = [...document.querySelectorAll('.dsh-wf-export-item')].find((x) => /导出 JSON/.test(x.textContent));
    it.click();
    return true;
  })()`);
  await wait(cdp, `(window.__dl || []).length >= 3`, { timeout: 8000 });
  const json = await evaluate(cdp, `window.__dl[2]`);
  ok(/\.json$/.test(json.name), `D1. 导出 JSON 仍是 .json（实际 ${JSON.stringify(json.name)}）`);
  ok(await evaluate(cdp, `(window.__dl[2].head || []).length === 8`), 'D2. JSON 内容也可读（未破坏老路径）');
  ok(await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => x.textContent.trim() === '⬇');
    return !!b;
  })()`), 'D3. ⬇ 按钮仍在（菜单收起后回到常态）');

  // ===== E. 点菜单外面关闭（不残留） =====
  await openMenu();
  await wait(cdp, `!!document.querySelector('.dsh-wf-export-menu')`, { timeout: 4000 });
  await evaluate(cdp, `(() => {
    // 背板是 fixed inset:0 的透明层，点它即"点外面"
    const menu = document.querySelector('.dsh-wf-export-menu');
    const back = menu.parentElement;
    back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  ok(!(await evaluate(cdp, `!!document.querySelector('.dsh-wf-export-menu')`)), 'D1. 点菜单外关闭菜单（不残留）');
}
