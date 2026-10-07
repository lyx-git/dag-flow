// tmp-test/cdp/diag-sched-toggle-race.mjs — 定位 schedule-dialog ⑧「取消勾选后该条加 is-off 类」偶发失败
//   用法：node tmp-test/cdp/diag-sched-toggle-race.mjs
//   假设：`saveSchedule()` 成功后 `await loadSchedules()` 会**无条件**把服务端列表写回 state。
//         若"上一次保存"触发的那次 GET 还在飞（或稍后才发出），它会把用户**刚点的新状态**覆盖回去
//         → 开关闪一下弹回（正是 2026-10-04 轮 6 用户报过的症状类）。
//   证法：故障注入——人为把 `/schedules?workflow=` 的 GET 延迟 400ms，看翻转是否**稳定复现**。
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
if (!up) { server.kill(); console.error('fixture 未就绪'); process.exit(1); }

const page = await launchPage({ port: 9397 });

/** 跑一轮：delayGet 毫秒延迟 GET，返回 is-off 的时间线（40ms 采样） */
async function trial(delayGet, tag) {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-race-${tag}&vars=1`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 6`, { timeout: 20000 });
  await sleep(300);

  await evaluate(page.cdp, `(() => {
    window.__race = []; window.__off = [];
    window.__setVal = (el, val) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc.set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.__click = (sel) => { const el = document.querySelector(sel); if (!el) throw new Error('找不到 ' + sel); el.click(); return true; };
    window.__log = async () => ((await (await fetch('/__sched-log')).json()).log ?? []);
    window.__delayGet = ${delayGet};
    const of = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]?.url ?? args[0]);
      if (url.includes('/api/dag-flow/schedules?workflow=') && window.__delayGet > 0) await new Promise((r) => setTimeout(r, window.__delayGet));
      const res = await of(...args);
      if (url.includes('/api/dag-flow/schedules/save')) {
        let body = {}; try { body = JSON.parse(args[1]?.body ?? '{}'); } catch { /* */ }
        window.__race.push({ t: Date.now(), kind: 'POST', enabled: body.enabled, cron: body.cron });
      }
      if (url.includes('/api/dag-flow/schedules?workflow=')) {
        const c = res.clone();
        c.json().then((d) => {
          const it = (d.items ?? [])[0] ?? {};
          window.__race.push({ t: Date.now(), kind: 'GET->state', enabled: it.enabled, cron: it.cron });
        }).catch(() => { /* */ });
      }
      return res;
    };
    window.__timer = setInterval(() => {
      const el = document.querySelector('.dsh-wf-sched-item');
      window.__off.push({ t: Date.now(), off: !!el && el.classList.contains('is-off') });
    }, 40);
    return true;
  })()`);

  // 打开 ⏰ 弹窗 → 加一条
  await evaluate(page.cdp, `[...document.querySelectorAll('.dsh-wf-btn')].find((x) => (x.title || '').startsWith('定时任务（'))?.click()`);
  await waitFor(page.cdp, `!!document.querySelector('.dag-flow-picker.dsh-wf-sched')`, { timeout: 8000 });
  await evaluate(page.cdp, `document.querySelector('.dsh-wf-sched .dsh-wf-inputs-add').click()`);
  await waitFor(page.cdp, `document.querySelectorAll('.dsh-wf-sched-item').length === 1`, { timeout: 8000 });

  // 改 cron（1.2s 防抖）→ 等它的 save 出现在桩日志里 → 立刻点开关（复刻测试 ⑦b→⑧ 的时序）
  await evaluate(page.cdp, `window.__setVal(document.querySelector('.dsh-wf-sched-cron'), '*/30 * * * *')`);
  await waitFor(page.cdp, `(async () => (await window.__log()).some((e) => e.op === 'save' && e.cron === '*/30 * * * *'))()`, { timeout: 8000 });
  await evaluate(page.cdp, `window.__click('.dsh-wf-sched-item .dsh-wf-sched-toggle input[type="checkbox"]')`);
  await sleep(2600);

  const r = await evaluate(page.cdp, `(() => {
    clearInterval(window.__timer);
    const t0 = window.__off[0]?.t ?? 0;
    const rel = (t) => t - t0;
    return {
      race: window.__race.map((x) => ({ ...x, t: rel(x.t) })),
      off: window.__off.map((x) => ({ t: rel(x.t), off: x.off })),
    };
  })()`);

  // 时间线压缩：只打印状态变化的时刻
  const flips = [];
  let prev = null;
  for (const s of r.off) { if (s.off !== prev) { flips.push(`${s.t}ms:${s.off ? 'is-off' : '可见(启用)'}`); prev = s.off; } }
  console.log(`\n=== delayGet=${delayGet}ms（${tag}）===`);
  console.log('  请求时间线:', r.race.map((x) => `${x.t}ms ${x.kind}(enabled=${x.enabled}${x.cron ? ' cron=' + x.cron : ''})`).join('  |  '));
  console.log('  开关状态变化:', flips.join('  ->  '));
  const flippedBack = flips.some((f, i) => i > 0 && f.includes('可见') && flips.slice(0, i).some((p) => p.includes('is-off')));
  console.log('  结论:', flippedBack ? '★ 出现了 is-off → 可见 的翻转（竞态复现）' : '未出现翻转');
  return flippedBack;
}

try {
  const a = await trial(400, 'slow');
  const b = await trial(0, 'fast');
  console.log(`\n判定：延迟 GET 时复现=${a} / 不延迟时复现=${b}`);
  console.log(a && !b ? '=> 机制确认：save 后那次 loadSchedules() 的 GET 响应会覆盖更新的本地状态' : '=> 机制未确认，需要继续查');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
