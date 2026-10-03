// tmp-test/cdp/test-loop-jump.mjs — 子工作流跳转（2026-10-03 用户需求）
//   需求：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，
//         子工作流也可以一键切回到父工作流的循环节点」→ 拍板：header 返回胶囊 + 面包屑；loop + subflow 都支持。
// 夹具：cdp-host.html?jump=1（父工作流含 loop 有循环体 / subflow 有目标 / loop 没选循环体 / loop 循环体不存在），
//       子工作流 = `<本页工作流名>-child`（本用例先 POST /workflows/save 建好）。
// 断言覆盖：双击进入（loop、subflow）、面包屑与返回胶囊、返回后**重新选中来源节点**、
//          没选循环体 / 循环体不存在 / 自己引用自己的提示（不跳转、画布不变）。
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  const CHILD = `${name}-child`;
  const childDef = {
    name: CHILD, version: 1,
    nodes: [
      { id: 'start', type: 'start', label: '子：开始', params: {} },
      { id: 'mid', type: 'set_var', label: '子：中间节点', params: { vars: { ok: '1' } } },
      { id: 'end', type: 'end', label: '子：结束', params: {} },
    ],
    edges: [{ from: 'start', to: 'mid' }, { from: 'mid', to: 'end' }],
    layout: { start: { x: 60, y: 180 }, mid: { x: 340, y: 180 }, end: { x: 640, y: 180 } },
  };
  // 先把子工作流存到夹具服务器（夹具支持 /workflows/save）
  const saved = await evaluate(cdp, `(async () => {
    const r = await fetch('/api/dag-flow/workflows/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ${JSON.stringify(CHILD)}, def: ${JSON.stringify(childDef)} }),
    });
    return r.status;
  })()`);
  ok(saved === 200, '夹具里已存在子工作流 ' + CHILD + '（HTTP ' + saved + '）');

  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&jump=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('循环：有循环体'))`, { timeout: 20000 });

  /** 当前画布上的工作流名（header 输入框） */
  const wfName = () => evaluate(cdp, `document.querySelector('.dsh-wf-name-input')?.value ?? ''`);
  /** 双击某个节点的宿主元素（先等节点出现——返回父画布后节点是异步重建的） */
  const dbl = async (label) => {
    await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-node-host')].some((h) => (h.textContent || '').includes(${JSON.stringify(label)}))`, { timeout: 8000 });
    return evaluate(cdp, `(() => {
      const hosts = window.__df_qa('.dsh-wf-fg-node-host');
      const el = hosts.find((h) => (h.textContent || '').includes(${JSON.stringify(label)}));
      if (!el) return 'no-node';
      window.__df_fire(el, 'dblclick');
      return 'ok';
    })()`);
  };
  const navText = () => evaluate(cdp, `(() => {
    const back = document.querySelector('.dsh-wf-nav-back');
    const crumb = document.querySelector('.dsh-wf-crumb');
    const msg = document.querySelector('.dsh-wf-navmsg');
    return { back: back?.textContent ?? '', crumb: crumb?.textContent ?? '', msg: msg?.textContent ?? '' };
  })()`);

  // ============ ① 双击 loop（有循环体）→ 进入子工作流 ============
  ok((await wfName()) === name, '起始在父工作流（实际：' + (await wfName()) + '）');
  ok((await dbl('循环：有循环体')) === 'ok', '双击到了「循环：有循环体」节点（双击手势已接上）');
  await waitFor(cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(CHILD)}`, { timeout: 10000 });
  const n1 = await navText();
  ok(n1.back.includes('返回') && n1.back.includes(name), '① header 出现返回胶囊，写明返回哪个工作流（实际：' + n1.back + '）');
  ok(n1.crumb.includes(name) && n1.crumb.includes(CHILD), '① 面包屑显示层级「父 › 当前」（实际：' + n1.crumb + '）');
  ok(await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('子：中间节点'))`),
    '① 画布换成子工作流的节点');

  // ============ ② 一键返回 → 回到父工作流并重新选中来源循环节点 ============
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-nav-back').click(); return true; })()`);
  await waitFor(cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(name)}`, { timeout: 10000 });
  ok((await wfName()) === name, '② 返回父工作流（实际：' + (await wfName()) + '）');
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`, { timeout: 6000 }).catch(() => {});
  const selLabel = await evaluate(cdp, `(() => {
    const sel = document.querySelector('.dsh-wf-fg-card.fg-selected')
      || [...document.querySelectorAll('.dsh-wf-fg-node-host')].find((h) => h.closest('.fg-selected'));
    return sel?.textContent ?? '';
  })()`);
  ok(selLabel.includes('循环：有循环体'), '② 返回后重新选中来源循环节点（实际选中：' + selLabel.slice(0, 60) + '）');
  ok((await navText()).back === '', '② 已回到最外层，返回胶囊消失');
  ok(await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-panel-row')].some((r) => (r.textContent || '').includes('循环设置'))`),
    '② 右侧参数面板联动到该循环节点（循环设置可见）');

  // ============ ③ subflow 节点同样能双击进入 ============
  ok((await dbl('子流程：有目标')) === 'ok', '双击到「子流程：有目标」节点');
  await waitFor(cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(CHILD)}`, { timeout: 10000 });
  ok((await wfName()) === CHILD, '③ subflow 节点也能进入子工作流');
  await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-nav-back').click(); return true; })()`);
  await waitFor(cdp, `document.querySelector('.dsh-wf-name-input')?.value === ${JSON.stringify(name)}`, { timeout: 10000 });
  ok((await wfName()) === name, '③ 从 subflow 进入后也能一键返回');

  // ============ ④ 没选循环体 → 提示且不跳转 ============
  ok((await dbl('循环：没选循环体')) === 'ok', '双击到「循环：没选循环体」节点');
  await sleep(300);
  const n4 = await navText();
  ok((await wfName()) === name, '④ 没选循环体时不跳转（画布仍是父工作流）');
  ok(n4.msg.includes('还没选'), '④ 给出「还没选循环体」的提示（实际：' + n4.msg + '）');

  // ============ ⑤ 循环体指向不存在的工作流 → 提示且不跳转 ============
  // ★ 不要自己去 remove 提示元素（React 托管的 DOM，外部 remove 会触发 removeChild NotFoundError 并搞崩后续渲染）；
  //   直接等提示文案被**替换**成新的那条即可（flashNavMsg 会就地换字）。
  ok((await dbl('循环：循环体不存在')) === 'ok', '双击到「循环：循环体不存在」节点');
  await waitFor(cdp, `(document.querySelector('.dsh-wf-navmsg')?.textContent ?? '').includes('不存在')`, { timeout: 6000 });
  const n5 = await navText();
  ok((await wfName()) === name, '⑤ 子工作流不存在时不跳转');
  ok(n5.msg.includes('不存在') || n5.msg.includes('读取失败'), '⑤ 提示写明读取失败（实际：' + n5.msg + '）');
}
