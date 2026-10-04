// tmp-test/cdp/test-goto-warn.mjs — 失败策略「回跳不生效」必须在画布上提前显形（2026-10-04 轮 5 便利性）
//   背景：轮 3 的 goto 是"失败边 + 目标只执行一次"——目标若在本节点之前（已经跑过），跳转不生效、
//   按「停止这条支路」处理。这类配置光看面板看不出来，只有跑完才知道（用户现有工作流正是这样被坑的）。
//   现在问题面板直接用祖先判定给出 warn（点击可选中源节点）。
//   夹具：cdp-host.html?goto=1（见 grab-test.tsx 的 gotoWarnDef：boom 的 onError.goto 指向 start）
import { goto, installHelpers } from './driver.mjs';

export async function run({ cdp, evaluate, waitFor, ok, sleep, name, base }) {
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name)}&goto=1`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 4`, { timeout: 20000 });
  await sleep(500);

  // ① 夹具就位：boom 的失败策略是"跳到 start"（start 在它之前）
  const policy = await evaluate(cdp, `(window.__df_def?.nodes ?? []).find((n) => n.id === 'boom')?.onError?.goto ?? ''`);
  ok(policy === 'start', `① 夹具就位：boom.onError.goto = ${JSON.stringify(policy)}（目标在本节点之前）`);

  // ①b ★ 失败策略显形（2026-10-04 轮 7「fail 策略显形」）：goto 的"看不见的跳转"在卡片上有一枚紫色 chip
  const chip = await evaluate(cdp, `(() => {
    const el = document.querySelector('.dsh-wf-fg-failchip');
    return { text: (el?.textContent ?? '').trim(), cls: el?.className ?? '', title: el?.title ?? '' };
  })()`);
  ok(chip.cls.includes('is-goto'), `①b 卡片上有失败跳转 chip（实际 class=${JSON.stringify(chip.cls)}）`);
  ok(chip.text.includes('失败→') && chip.text.includes('start'), `①c chip 写明跳到哪个节点（实际：${JSON.stringify(chip.text)}）`);
  ok(chip.title.includes('目标只执行一次'), '①d chip 的 title 说明「目标只执行一次」（鼠标悬浮可读）');

  // ② 点状态栏的「⚠ N 个问题」打开问题面板（与用户操作路径一致）
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-statusbar-error')`, { timeout: 8000 });
  await evaluate(cdp, `document.querySelector('.dsh-wf-statusbar-error').click(); true;`);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-problems')`, { timeout: 8000 });
  const msgs = await evaluate(cdp, `[...document.querySelectorAll('.dsh-wf-fg-problem')].map((el) => el.textContent)`);
  const hit = msgs.find((m) => m.includes('boom') && m.includes('跳转'));
  ok(!!hit, `② 问题面板列出「回跳不生效」告警（共 ${msgs.length} 条）：${JSON.stringify((hit ?? '').slice(0, 90))}`);
  ok((hit ?? '').includes('不会生效'), '③ 文案明确说"不会生效"（而不是含糊的"请注意"）');
  ok((hit ?? '').includes('停止这条支路'), '④ 文案说明实际行为：按「停止这条支路」处理');
  ok((hit ?? '').includes('循环') || (hit ?? '').includes('loop'), '⑤ 文案给出替代方向（要回跳重试用循环区）');

  // ⑥ 该条目是 warn（不是 error——配置本身合法，只是不会生效）
  const cls = await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-problem')].find((e) => e.textContent.includes('boom') && e.textContent.includes('跳转'));
      return el ? el.className : '';
    })()`);
  ok(String(cls).includes('warn'), `⑥ 级别为 warn（actual=${cls}）`);

  // ⑦ 点这条告警 → 选中源节点（问题面板既有交互约定）
  await evaluate(cdp, `
    (() => {
      const el = [...document.querySelectorAll('.dsh-wf-fg-problem')].find((e) => e.textContent.includes('boom') && e.textContent.includes('跳转'));
      el?.click();
      return true;
    })(); true;
  `);
  await waitFor(cdp, `!!document.querySelector('.dsh-wf-fg-card.fg-selected')`, { timeout: 5000 });
  const selText = await evaluate(cdp, `document.querySelector('.dsh-wf-fg-card.fg-selected')?.textContent ?? ''`);
  ok(selText.includes('会失败的步骤') || selText.includes('boom'), `⑦ 点击告警选中了源节点（${JSON.stringify(selText.slice(0, 40))}）`);

  // ⑧ 反向对照：无 goto 的工作流不会误报（不制造噪音）
  await goto(cdp, `${base}/cdp-host.html?name=${encodeURIComponent(name + '-plain')}`);
  await installHelpers(cdp);
  await waitFor(cdp, `document.querySelectorAll('.dsh-wf-fg-card').length >= 2`, { timeout: 20000 });
  await sleep(400);
  const plainStatus = await evaluate(cdp, `document.querySelector('.dsh-wf-statusbar')?.textContent ?? ''`);
  const plainHas = await evaluate(cdp, `
    (() => {
      const el = document.querySelector('.dsh-wf-statusbar-error');
      if (el) el.click();
      return [...document.querySelectorAll('.dsh-wf-fg-problem')].some((e) => e.textContent.includes('跳转'));
    })()`);
  ok(plainHas === false, `⑧ 无 goto 的工作流不会误报（状态栏：${JSON.stringify(plainStatus)}）`);
}
