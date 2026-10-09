// tmp-test/cdp/test-cancel-run.mjs — 取消运行：**不许闪回"待运行"**、最终落定「✗ 已取消」
//   用户原话（2026-10-08）：「工作流点取消按钮的时候，ai节点还在跑，但是按钮会先回到待运行的按钮状态，
//   再跳回取消中的状态，这是咋回事」——这是上一轮取消修复留下的毛刺：
//   `handleRun` 的 finally 在本地 fetch 被 abort 后**立刻** setRunning(false) ✗ → 头部先闪回「▶」、
//   取消按钮消失，随后后台监视器发现宿主还在跑又把界面点回「取消中…」。
// 契约（本用例钉死）：
//   ① 运行中 → 头部是「运行中」+ 红色「⏹ 取消」
//   ② 点取消后**立刻**（≤400ms 采样）→ 头部进入「取消中…」，**不允许**出现「▶」待运行态
//   ③ 取消期间取消按钮禁用且文案「⏳ 取消中…」
//   ④ 宿主确认结束后 → 头部回到「▶」、运行结果落定「✗ 已取消」
// ★ **诚实口径（2026-10-08 A/B 实测）**：本用例**不能**反证"闪回 ▶"那一帧——把 `handleRun` finally 的
//   守卫去掉（还原旧行为）后本用例**仍然全过** ✗（夹具里 React 把两次 setState 合并了 / 监视器在同一批
//   里补回了 running，那一帧没被提交）。所以它锁的是**取消态的状态机与文案**（取消中/禁用/落定已取消），
//   毛刺本身只能靠代码推理 + 真机确认。若将来要做成真反证锁，需要给夹具加"取消后 /run/status 延迟应答"
//   的控制口，把 ▶ 那一帧撑开。
// 依赖夹具：`POST /__run-mode {mode:'slow'}`（分阶段推进、不 hold，DELETE **不会**立刻清掉它 —— 正好
//   模拟"AI 节点还在跑、宿主还在收尾"），跑完/清掉后 /run/status 404 → 客户端据此落定。
import { waitFor } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor: wf, ok, eq, sleep }) {
  const wait = wf ?? waitFor;
  const post = async (path, body) => evaluate(cdp, `fetch(${JSON.stringify(path)}, { method:'POST', headers:{'content-type':'application/json'}, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.status)`);

  // 慢速模式：/run 立刻返回、随后按工作流名回报逐节点进度（客户端后台监视器据此点亮）
  await post('/__run-mode', { mode: 'slow' });

  const headText = () => evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')];
    const run = b.find((x) => /▶|运行中|取消中|自检中/.test(x.textContent));
    const cancel = b.find((x) => /取消/.test(x.textContent));
    return { run: run?.textContent?.trim() ?? '', runDisabled: !!run?.disabled, cancel: cancel?.textContent?.trim() ?? '', cancelDisabled: !!cancel?.disabled };
  })()`);

  // ===== A. 起跑 → 头部进入「运行中」+ 出现取消按钮 =====
  //   ★ 自检弹窗由 driver 的自动确认助手点掉（默认开）——**不要**在这里等弹窗，否则会白等到超时 ✗
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);
  await wait(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => /运行中|取消中/.test(x.textContent));
    return !!b;
  })()`, { timeout: 8000 });
  let h = await headText();
  ok(/运行中/.test(h.run), `A1. 起跑后头部显示「运行中」（实际 ${JSON.stringify(h.run)}）`);
  ok(/取消/.test(h.cancel), `A2. 出现取消按钮（实际 ${JSON.stringify(h.cancel)}）`);

  // ===== B. 点取消 → **任何一帧都不许**闪回「▶ 待运行」 =====
  //   ★ 用 MutationObserver 记录头部按钮文案的**每一次 DOM 提交**（比 60ms 轮询严格：React 两次
  //     setState 若分属不同提交，中间那帧一定会被记下来）。
  await evaluate(cdp, `(() => {
    window.__headSeq = [];
    const rec = () => {
      const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => /▶|运行中|取消中|自检中/.test(x.textContent));
      const s = b ? b.textContent.trim() : '';
      const last = window.__headSeq[window.__headSeq.length - 1];
      if (s !== last) window.__headSeq.push(s);
    };
    rec();
    window.__headOb?.disconnect?.();
    const ob = new MutationObserver(rec);
    ob.observe(document.querySelector('.dsh-wf-header'), { subtree: true, childList: true, characterData: true, attributes: true });
    window.__headOb = ob;
    return true;
  })()`);
  await evaluate(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => /取消/.test(x.textContent));
    b.click();
    return true;
  })()`);
  await sleep(900);
  const seq = await evaluate(cdp, `(() => { window.__headOb?.disconnect?.(); return window.__headSeq; })()`);
  ok(!seq.some((s) => /▶/.test(String(s))), `B1. ★取消后**没有任何一帧**闪回「▶ 待运行」（记录到的文案序列：${JSON.stringify(seq)}）`);
  ok(seq.some((s) => /取消中/.test(String(s))), `B2. ★序列里出现过「取消中…」（${JSON.stringify(seq)}）`);
  h = await headText();
  ok(/取消中/.test(h.run), `B3. 头部运行按钮显示「取消中…」（实际 ${JSON.stringify(h.run)}）`);
  ok(h.runDisabled === true, 'B4. 取消中运行按钮禁用（防连点）');
  ok(/取消中/.test(h.cancel) && h.cancelDisabled === true, `B5. 取消按钮变「⏳ 取消中…」且禁用（实际 ${JSON.stringify(h.cancel)}/${h.cancelDisabled}）`);

  // ===== C. 宿主收尾完成后 → 回到「▶」+ 浮窗提示「取消成功」（右侧结果条**不**显示「已取消」✗） =====
  await wait(cdp, `(() => {
    const b = [...document.querySelectorAll('.dsh-wf-header button')].find((x) => /▶|运行中|取消中/.test(x.textContent));
    return b && /▶/.test(b.textContent);
  })()`, { timeout: 20000 });
  const after = await evaluate(cdp, `(() => {
    const txt = document.querySelector('.dsh-wf-header')?.textContent ?? '';
    const chip = document.querySelector('.dsh-wf-run-result')?.textContent ?? '';
    return { header: txt, chip, cancelled: /已取消/.test(txt) || /已取消/.test(chip), toast: (document.body.textContent || '').includes('取消成功') };
  })()`);
  ok(!after.cancelled, `C1. ★右侧/头部**不**显示「✗ 已取消」（chip=${JSON.stringify(after.chip)}）`);
  ok(after.toast, `C2. ★取消完成后浮窗提示「取消成功」（头部文本：${JSON.stringify(String(after.header).slice(0, 60))}）`);
  // ★ 2026-10-08 用户要求：浮窗**放到上面**（原来在底部 18px ✗）→ 断言它落在视口上半部
  const toastPos = await evaluate(cdp, `(() => {
    const d = [...document.querySelectorAll('div')].find((x) => /取消成功/.test(x.textContent || '') && getComputedStyle(x).position === 'fixed');
    if (!d) return { top: -1, h: window.innerHeight };
    return { top: d.getBoundingClientRect().top, h: window.innerHeight };
  })()`);
  ok(toastPos.top >= 0 && toastPos.top < toastPos.h / 2, `C2b. ★浮窗在**上半部**（top=${Math.round(toastPos.top)} / 视口高 ${toastPos.h}）`);
  h = await headText();
  ok(!/取消/.test(h.cancel), `C3. 取消按钮已消失（回到未运行态；实际 ${JSON.stringify(h.cancel)}）`);

  // 收尾：恢复默认模式，避免影响后续用例
  await post('/__run-mode', { mode: 'fast' });
}
