// tmp-test/cdp/test-line-drop-panel.mjs — 拖线到空白松手 → 快选面板跟随落点弹出（2026-10-02 用户反馈：
// 画线松手不弹面板。根因：官方 Layer 把 position 透传给 renderer、定位是 renderer 职责——旧渲染器
// 没用该 prop，面板作为图层流内静态块渲染，位置不随落点且可能被画布遮住）。
// 修复后：渲染器 portal 到 body + position:fixed 落点坐标（视口钳位）。
// ★ 2026-10-04 轮 7（做稳）：起线改用 driver 的**真实鼠标输入** `dragMouse`（CDP Input.dispatchMouseEvent）。
//   此前靠页面内合成 MouseEvent（hover 三次 + 180ms 间隔）模拟拖拽，与 playground 的 hover/drag 状态机
//   时序对不上 → 间歇性"起不了线、快选面板不弹"（同一份构建有时过有时挂）。真实输入走浏览器输入管线，
//   等价于真人鼠标：hover / 按键状态 / 移动步数都由浏览器维护。
import { goto, installHelpers, dragUntil } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep }) {
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-editor')`, { timeout: 20000 });
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card')`, { timeout: 15000 });
  // ★ 2026-10-04 轮 7：等画布"热"起来再做第一次手势——页面刚渲染完时 FlowGram 的端口 hover 状态机
  //   还没就绪，此时按下不会起线（诊断见 tmp-test/cdp/diag-port-hover.mjs）
  await sleep(600);

  /** 起线：算好起点（start 的输出端口中心）与落点，然后用**真实鼠标**拖过去 */
  const dragFromPort = async (dropXRatio, dropYRatio) => {
    const geo = await evaluate(cdp, `
      (() => {
        const editor = document.querySelector('.dsh-wf-fg-editor');
        const er = editor.getBoundingClientRect();
        // 输出端口 portal 渲染，不在 host 内，全画布找 output 类型
        const port = [...document.querySelectorAll('.workflow-port-render')]
          .find((p) => p.getAttribute('data-port-entity-type') === 'output');
        if (!port) return { error: 'output port not found' };
        const pr = port.getBoundingClientRect();
        // 落点必须避开节点卡（拖到卡上会直接连成线、不弹快选面板）
        const cards = [...document.querySelectorAll('.dsh-wf-fg-card')].map((c) => c.getBoundingClientRect());
        let x = Math.round(er.left + er.width * ${dropXRatio});
        let y = Math.round(er.top + er.height * ${dropYRatio});
        for (let dx = 0; dx <= 0.3 && cards.some((c) => x > c.left - 60 && x < c.right + 60 && y > c.top - 60 && y < c.bottom + 60); dx += 0.05) {
          x = Math.round(er.left + er.width * (${dropXRatio} + dx));
          if (x > er.right - 30) break;
        }
        return { sx: Math.round(pr.left + pr.width / 2), sy: Math.round(pr.top + pr.height / 2), dropX: x, dropY: y };
      })()
    `);
    ok(!geo.error, '起线序列执行' + (geo.error ? ' — ' + geo.error : ''));
    // 手势最多重试 3 次（见 driver.dragUntil 的注释：落空≠功能坏了，重试后断言完全不变）
    const r = await dragUntil(cdp, { x: geo.sx, y: geo.sy }, { x: geo.dropX, y: geo.dropY }, `!!document.querySelector('.dsh-wf-fg-quick')`);
    ok(r.ok, `拖线后快选面板弹出（第 ${r.attempts} 次手势）`);
    return { dropX: geo.dropX, dropY: geo.dropY };
  };

  const drop = await dragFromPort(0.72, 0.75);

  // 断言① 面板出现
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  ok(true, '拖线松手后快选面板弹出');
  // 断言② 面板渲染在 body 直下（Portal）且 fixed 定位
  const info = await evaluate(cdp, `
    (() => {
      const q = document.querySelector('.dsh-wf-fg-quick');
      const r = q.getBoundingClientRect();
      const inBody = q.parentElement === document.body;
      const s = getComputedStyle(q);
      return {
        inBody, position: s.position, zIndex: s.zIndex,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0,
      };
    })()
  `);
  ok(info.inBody, '面板 Portal 到 body 直下（不受图层 transform 包含块影响）');
  ok(info.position === 'fixed', '面板 fixed 定位（position prop 生效）');
  ok(info.inViewport, '面板完整落在视口内（' + JSON.stringify(info.rect) + '）');
  // 断言③ 面板跟随落点：面板左上角与拖线松手点距离 < 260px（钳位可能贴边，放宽到面板尺寸量级）
  const dist = Math.hypot(info.rect.x - drop.dropX, info.rect.y - drop.dropY);
  ok(dist < 260, '面板跟随落点弹出（落点 (' + drop.dropX + ',' + drop.dropY + ') 面板 (' + info.rect.x + ',' + info.rect.y + ') 距离 ' + Math.round(dist) + 'px）');

  // 断言④ Esc 关闭面板（onClose → resolve undefined）
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('.dsh-wf-fg-quick-search');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    })(); true;
  `);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  ok(true, 'Esc 关闭快选面板');

  // ===== 断言⑤：重开面板选节点 → 新节点落在拖线松手点（2026-10-02 用户反馈：跑到画布中间）=====
  const drop2 = await dragFromPort(0.68, 0.7);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  // 输入 python 过滤 → Enter 选第一项（创建节点并自动连线）
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('.dsh-wf-fg-quick-search');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, 'python');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })(); true;
  `);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  // def 层：python 节点已创建且有来自 start 的入边
  await waitFor(cdp, `
    (() => {
      const d = window.__df_def ?? {};
      const py = (d.nodes ?? []).find((n) => n.type === 'python');
      if (!py) return false;
      return (d.edges ?? []).some((e) => e.to === py.id && e.from === 'start');
    })()
  `, { timeout: 8000 });
  ok(true, '选节点后创建成功且自动从 start 连线');
  // 画布实体层：新节点卡中心落在松手点附近（±150px，官方 adjustNodePosition 半宽/半高居中语义）
  const near = await evaluate(cdp, `
    (() => {
      const cards = [...document.querySelectorAll('.dsh-wf-fg-card')].filter((el) => (el.textContent || '').includes('Python'));
      const card = cards[cards.length - 1];
      if (!card) return { found: false };
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return { found: true, dist: Math.hypot(cx - ${drop2.dropX}, cy - ${drop2.dropY}) };
    })()
  `);
  ok(near.found, '新节点画布卡已渲染');
  ok(near.dist < 150, '新节点落在拖线松手点附近（距离 ' + Math.round(near.dist) + 'px < 150px）');

  // ===== 断言⑥：会话输入节点也能自动连线（2026-10-02 用户反馈：选会话输入后连线没了）=====
  // 根因：session_input 注册 defaultPorts 只有 output、无 input → buildLine 的
  // inputPorts.length>0 门控静默跳过连线。修复后应有 input 端口并能连上。
  // 落点取左下空白区（避开 start 与上一轮 python 节点卡——拖到节点上会命中 toPort 直接连线、不弹面板）
  const drop3 = await dragFromPort(0.28, 0.86);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('.dsh-wf-fg-quick-search');
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      desc.set.call(input, '会话');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })(); true;
  `);
  await waitFor(cdp, `!document.querySelector('.dsh-wf-fg-quick')`, { timeout: 5000 });
  // def 层：session_input 节点已创建且与 start 之间有连线
  await waitFor(cdp, `
    (() => {
      const d = window.__df_def ?? {};
      const si = (d.nodes ?? []).find((n) => n.type === 'session_input');
      if (!si) return false;
      return (d.edges ?? []).some((e) => e.to === si.id && e.from === 'start');
    })()
  `, { timeout: 8000 });
  ok(true, '会话输入节点拖线创建后自动连线（input 端口门控已修）');
}
