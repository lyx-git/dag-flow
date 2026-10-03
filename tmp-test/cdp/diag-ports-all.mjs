// tmp-test/cdp/diag-ports-all.mjs — 对比三种夹具（branch 2 case / chips 5 出口 / many 8 case）里
// switch 输出端口的实际纵坐标：判断「端口被全部居中」是新引入的问题，还是夹具一直如此。
import { spawn } from 'node:child_process';
import { launchPage, goto, evaluate, waitFor, installHelpers, sleep, lastPageError } from './driver.mjs';

const BASE = 'http://127.0.0.1:34177';
const server = spawn(process.execPath, ['tmp-test/picker-server.mjs'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { await (await fetch(BASE + '/api/dag-flow/workflows')).json(); up = true; } catch { await sleep(100); }
}
const page = await launchPage({ port: 9345 });
const probe = async (q, kw) => {
  await goto(page.cdp, `${BASE}/cdp-host.html?name=diag-${q.replace(/[^a-z0-9]/gi, '')}&${q}`);
  await installHelpers(page.cdp);
  await waitFor(page.cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes(${JSON.stringify(kw)}))`, { timeout: 20000 });
  await sleep(600);
  const out = await evaluate(page.cdp, `(() => {
    const card = [...document.querySelectorAll('.dsh-wf-fg-card')].find((c) => (c.textContent || '').includes(${JSON.stringify(kw)}));
    const r = card.getBoundingClientRect();
    const near = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; };
    const ports = [...document.querySelectorAll('.workflow-port-render')].map(near)
      .filter((p) => p.x > r.left - 24 && p.x < r.right + 24 && p.y > r.top - 30 && p.y < r.bottom + 30);
    const dots = [...document.querySelectorAll('.workflow-point-bg')].map(near)
      .filter((p) => p.x > r.left - 24 && p.x < r.right + 24 && p.y > r.top - 30 && p.y < r.bottom + 30);
    return {
      card: { y: Math.round(r.top), h: Math.round(r.height) },
      rows: [...card.querySelectorAll('.dsh-wf-fg-rou')].map((el) => { const b = el.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }),
      labels: [...card.querySelectorAll('.dsh-wf-fg-branch-label')].map((el) => { const b = el.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }),
      portRender: ports, dots,
    };
  })()`);
  console.log(`\n== ${q}（${kw}）==`);
  console.log(JSON.stringify(out));
  const pe = lastPageError();
  console.log('页面异常：', pe ? pe.split('\n')[0] : '(无)');
};
try {
  await probe('branch=1', '模式分支');
  await probe('chips=1', '多路分支：运行模式');
  await probe('many=1', '分支很多');
} finally {
  try { page.close(); } catch { /* */ }
  server.kill();
}
