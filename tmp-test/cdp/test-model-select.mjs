// tmp-test/cdp/test-model-select.mjs — AI 节点模型下拉的两件事（2026-10-03）：
//  ①「存值 vs 实时列表」缺口（用户问「不是实时获取的 dsh 当前的模型吗」时发现）
//     事实：列表是打开面板时实时拉的（GET /models），但工作流里存的是**保存时的字符串快照**。
//     缺口：快照 id 不在当前列表里时，controlled select 匹配不到任何 option → 界面显示"请选择执行模型"，
//           而 JSON 里仍是旧 id → 看起来没选模型、实际按旧 id 执行。修法：显式列成「⚠ …（当前值…）」+ 警示。
//  ②模型下拉显示**显示名**（用户 2026-10-03：「最好是改成下拉选显示名称改成模型显示名称，不用模型id，不容易分辨」）
//     宿主 llm listModels 的 name（如 deepseek-flash → DeepSeek-V41-Flash）作为 option 文案；
//     存值/执行仍是 id；宿主没给显示名时回退 model id；同名时补 provider 显示名消歧；下拉下方细字给出执行 id。
// 夹具：cdp-host.html?stale=1 + fixture 控制口 POST /__models-mode {mode:'name'|'empty'}
//       （默认 'empty' = 老行为：/models 返回空列表 → 覆盖"拿不到列表"分支）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  const setMode = (mode) => evaluate(cdp, `(async () => {
    const r = await fetch('/__models-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: '${mode}' }) });
    return (await r.json().catch(() => ({}))).mode ?? '';
  })()`);

  /** 选中带旧模型快照的 AI 节点，并返回模型下拉的状态
   *  ★ 抗「导航竞态」写法：driver.goto 只轮询 document.readyState，Page.navigate 提交前的
   *    一瞬仍能读到旧文档的 'complete' → goto 可能立刻返回（停在旧页面）。旧页面上如果面板
   *    已经挂载过（夹具加载时就会挂载一次 AI 面板并拉 /models），`modelsLoaded` 已为 true，
   *    再点同一个节点不会重新拉列表 → 断言看到的是**上一轮模式的空列表**（本文件实测到的偶发假红）。
   *    对策：① 每次读之前先点画布空白取消选中（卸载面板）再点节点（重新挂载必然重新拉 /models）；
   *         ② 用 waitFor 显式等「期望的列表内容/快照项」出现，而不是读一次就断言。 */
  const readSelect = async (expect) => {
    await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-fg-card')].some((c) => (c.textContent || '').includes('AI：旧模型快照'))`, { timeout: 20000 });
    await installHelpers(cdp);
    const clickNode = `(() => {
      const hosts = window.__df_qa('.dsh-wf-fg-node-host');
      const el = hosts.find((h) => (h.textContent || '').includes('AI：旧模型快照'));
      window.__df_fire(el, 'mousedown'); window.__df_fire(el, 'mouseup'); window.__df_fire(el, 'click');
      return true;
    })()`;
    // ① 取消选中（点画布空白）→ 面板卸载
    await evaluate(cdp, `(() => {
      const ed = document.querySelector('.dsh-wf-fg-editor');
      if (ed) { window.__df_fire(ed, 'mousedown'); window.__df_fire(ed, 'mouseup'); window.__df_fire(ed, 'click'); }
      return true;
    })()`);
    await sleep(250);
    // ② 重新选中 → 面板挂载 → 必然重新 GET /models
    await evaluate(cdp, clickNode);
    await waitFor(cdp, `[...document.querySelectorAll('.dsh-wf-panel-label')].some((l) => (l.textContent || '').includes('选择模型'))`, { timeout: 8000 });
    // ③ 等期望内容到位（避免读到尚未回填的旧状态）
    if (expect) {
      await waitFor(cdp, `(() => {
        const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
        const s = row?.querySelector('select');
        return [...(s?.options ?? [])].some((o) => o.textContent.includes(${JSON.stringify(expect)}));
      })()`, { timeout: 8000 });
    }
    return evaluate(cdp, `(() => {
      const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
      const s = row?.querySelector('select');
      return {
        value: s?.value ?? '',
        opts: [...(s?.options ?? [])].map((o) => ({ v: o.value, t: o.textContent })),
        hints: [...document.querySelectorAll('.dsh-wf-panel-hint')].map((h) => h.textContent || ''),
      };
    })()`);
  };

  // ============ 阶段一：/models 返回带显示名的条目 ============
  // ★ 先落到夹具页面（保证 POST 与页面同源）→ 切模式并**校验切换成功** → 再刷新一次让面板按新列表拉取。
  //   第一版把 setMode 放在 goto 之前，出现过一次"/models 仍返回空列表"（切换未生效）的偶发失败——
  //   现在把「控制口生效」本身也变成一条断言，失败时能立刻区分「夹具没切过去」与「前端没渲染显示名」。
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&stale=1&t=0`);
  const mode1 = await setMode('name');
  const probe = await evaluate(cdp, `(async () => {
    const r = await fetch('/api/dag-flow/models');
    const j = await r.json().catch(() => null);
    return { status: r.status, n: (j?.models ?? []).length };
  })()`);
  ok(mode1 === 'name' && probe.n > 0,
    '夹具控制口生效：/__models-mode → ' + mode1 + '，/models → HTTP ' + probe.status + '，' + probe.n + ' 条');

  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&stale=1&t=1`);
  const sel = await readSelect('Probe-V41-Flash');

  const texts = sel.opts.map((o) => o.t);
  const optOf = (id) => sel.opts.find((o) => o.v === id);

  ok(optOf('dsh:llm:probe-provider:probe-flash')?.t.includes('Probe-V41-Flash'),
    '① 下拉显示模型**显示名** Probe-V41-Flash（实际选项：' + JSON.stringify(texts) + '）');
  ok(!texts.some((t) => /llm:probe-provider:probe-flash/.test(t)),
    '① 选项文案里不再出现内部 id（llm:probe-provider:probe-flash）');
  ok(optOf('dsh:llm:other-provider:probe-flash')?.t.includes('另一家'),
    '① 同名模型补提供方显示名消歧（Probe-V41-Flash（另一家））');
  ok(optOf('dsh:custom-model:glm-x')?.t.includes('glm-x'),
    '① 宿主没给显示名时回退 model id（glm-x），不退化成 llm:provider:model');
  ok(optOf('dsh:llm:probe-provider:probe-flash')?.t.includes('📷'),
    '① 图片能力徽标仍在（显示名与徽标共存）');
  ok(sel.opts.find((o) => o.v === 'dsh:llm:probe-provider:probe-flash')?.v === 'dsh:llm:probe-provider:probe-flash',
    '① ★ 存值/执行仍是 id：option 的 value 未被显示名污染');
  ok(sel.hints.some((h) => h.includes('执行 id：custom-model:glm-5.3-flash')),
    '① 下拉下方细字给出本次实际执行的模型 id（保底不丢 id）');

  // ★ 选中状态标记（用户 2026-10-03：「点开下拉选项的已经选中的下拉选项就有一个选中的状态标记它」）
  const marked1 = sel.opts.filter((o) => o.t.includes('✓'));
  ok(marked1.length === 1 && marked1[0].v === 'custom-model:glm-5.3-flash',
    '① 只有当前已选的那一项带 ✓ 选中标记（实际：' + JSON.stringify(marked1.map((o) => o.t)) + '）');

  // 原有「快照 id 显式列出」的断言（阶段一：列表非空，但列表里没有这个快照）
  ok(sel.value === 'custom-model:glm-5.3-flash', '下拉的当前值仍是工作流里存的快照 id（实际：' + sel.value + '）');
  ok(sel.opts.some((o) => o.v === 'custom-model:glm-5.3-flash' && o.t.includes('当前值')), '快照 id 被显式列为「…（当前值，dsh 当前未提供）」而不是显示成"没选"（选项：' + JSON.stringify(texts) + '）');
  ok(sel.hints.some((h) => h.includes('不在此') || h.includes('不在 dsh 当前')), '面板给出「当前保存的模型不在 dsh 当前列表里」的警示');
  ok(await evaluate(cdp, `(() => {
    const m = window.__df_def?.nodes?.find((n) => n.id === 'ai_stale')?.params?.model;
    return m === undefined || m === 'custom-model:glm-5.3-flash';
  })()`), '面板没有把存值静默改写成别的模型（def 镜像未变更或尚未产生）');

  // ============ 阶段一之二：选完模型 → 重进下拉要「直接定位到已选模型」（用户 2026-10-03 需求） ============
  const PICK = 'dsh:llm:probe-provider:probe-flash';
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
    const s = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(s, ${JSON.stringify(PICK)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(500); // 等 def 镜像同步
  const selR = await readSelect('Probe-V41-Flash');
  ok(selR.value === PICK, '③ 选完模型后重进面板，下拉当前值仍是刚选的模型（实际：' + selR.value + '）');
  ok(selR.opts[1]?.v === PICK, '③ 已选模型被挪到列表最前（紧跟占位项）→ 展开就能定位到（实际前两项：' + JSON.stringify(selR.opts.slice(0, 2)) + '）');
  ok(await evaluate(cdp, `(() => window.__df_def?.nodes?.find((n) => n.id === 'ai_stale')?.params?.model === ${JSON.stringify(PICK)})()`),
    '③ 存值同步（写进 def 的是模型 id，不是显示名）');
  const markedR = selR.opts.filter((o) => o.t.includes('✓'));
  ok(markedR.length === 1 && markedR[0].v === PICK, '③ 已选项带 ✓ 且只有它带（实际：' + JSON.stringify(markedR.map((o) => o.t)) + '）');
  ok(selR.opts.filter((o) => o.v && o.v !== PICK).every((o) => !o.t.includes('✓')), '③ 未选中的项都不带 ✓');

  // ============ 阶段二：/models 返回空列表（保留"本次没取到模型列表"分支的覆盖） ============
  const mode2 = await setMode('empty');
  ok(mode2 === 'empty', '夹具控制口切回 empty（实际：' + mode2 + '）');
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&stale=1&t=2`);
  const sel2 = await readSelect('当前值');
  ok(sel2.opts.filter((o) => o.v !== '' && !String(o.v).startsWith('custom-model:')).length === 0,
    '② 列表为空时（拿不到模型列表）不显示任何可执行模型项（实际：' + JSON.stringify(sel2.opts.map((o) => o.t)) + '）');
  ok(sel2.opts.some((o) => o.v === 'custom-model:glm-5.3-flash' && o.t.includes('当前值')),
    '② 空列表下快照 id 仍被显式列出（不会显示成"没选"）');
  ok(sel2.hints.some((h) => h.includes('本次没取到模型列表')),
    '② 空列表走「本次没取到模型列表」专用警示（与"列表非空但没这个模型"区分）');
  ok(sel2.hints.some((h) => h.includes('执行 id：custom-model:glm-5.3-flash')),
    '② 空列表下也给出实际执行的模型 id');

  // ============ 段④：清空选择（没有已选模型）→ 任何项都不带选中标记，且重复重进一致 ============
  const mode3 = await setMode('name');
  ok(mode3 === 'name', '④ 夹具切回有效列表（实际：' + mode3 + '）');
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&stale=1&t=3`);
  await readSelect('Probe-V41-Flash'); // 页面重载 → 夹具 def 又带快照模型（此时有 ✓）
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.dsh-wf-panel-row')].find((r) => (r.textContent || '').includes('选择模型'));
    const s = row?.querySelector('select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(s, '');
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(500);
  const selN = await readSelect('Probe-V41-Flash'); // expect 只为「等列表加载完」，与选中与否无关
  ok(selN.opts.length > 2, '④ 列表非空（该断言有效；选项数 ' + selN.opts.length + '）');
  ok(selN.opts.every((o) => !o.t.includes('✓')), '④ 没有已选模型时任何项都不带 ✓（实际：' + JSON.stringify(selN.opts.map((o) => o.t)) + '）');
  const selN2 = await readSelect('Probe-V41-Flash'); // 重复重进（用户：「重复点击也一样」）
  ok(selN2.opts.every((o) => !o.t.includes('✓')), '④ 重复重进面板后依然没有选中标记');
}
