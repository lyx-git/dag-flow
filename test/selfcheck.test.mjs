// test/selfcheck.test.mjs — 工作流自检（轮 1：结构/引用、模板引用前缀、可达性、环）
//   2026-10-04 用户拍板：分多轮实现；运行前自动检查；发现问题要给出**报错提示 + 解决办法**并拦下人工确认。
// 契约（本文件钉死）：①ok 只由 error 决定（warn 不拦）②每条都必须带 fix（解决办法不能空）
//   ③错误码稳定（code 不随文案变）④自检自身异常绝不抛（降级成 warn）⑤纯函数：不读 fs、不碰网络
// 手段：esbuild 即时打包 src/executor/selfcheck.ts → 断言
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-selfcheck-'));
const OUT = join(dir, 'selfcheck.mjs');
await build({ entryPoints: ['src/executor/selfcheck.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { selfcheck } = await import(pathToFileURL(OUT).href);

const codes = (r) => r.items.map((i) => i.code);
const mk = (nodes, edges) => ({ name: 'sc', version: 1, nodes, edges });
const lg = (id, params = {}) => ({ id, type: 'log', params: { level: 'info', message: 'x', ...params } });

console.log('== A. 干净工作流：通过 ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, lg('a'), { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  ok(r.ok, 'A1. ok=true');
  eq(r.errorCount, 0, 'A2. 无 error');
  eq(r.stats, { nodes: 3, edges: 2 }, 'A3. stats 报告节点/边数');
}

console.log('== B. 结构不合法：转成 error 项并给出解决办法 ==');
{
  const r = selfcheck({ name: 'bad', version: 1, nodes: [lg('a')], edges: [] });
  eq(codes(r), ['STRUCT_INVALID'], 'B1. 错误码 STRUCT_INVALID（缺 start/end）');
  ok(!r.ok, 'B2. ok=false（会拦住运行）');
  ok(typeof r.items[0].fix === 'string' && r.items[0].fix.length > 10, 'B3. ★带解决办法（fix 非空）');
  eq(r.stats.nodes, 1, 'B4. 结构错也返回 stats（节点数尽量给出）');
}

console.log('== C. 模板引用指向不存在的节点 ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'a', type: 'log', params: { level: 'info', message: '{{ghost.out.text}}' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  eq(codes(r), ['REF_UNKNOWN'], 'C1. 错误码 REF_UNKNOWN');
  eq(r.items[0].nodeId, 'a', 'C2. 定位到引用方节点');
  ok(r.items[0].message.includes('ghost'), 'C3. 消息里点出缺失的节点名');
  ok(r.items[0].fix.includes('上游变量'), 'C4. ★解决办法指向具体操作（面板「上游变量」复制正确引用）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'a', type: 'log', params: { level: 'info', message: '{{inputs.主题}} {{vars.x}}' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  ok(r.ok, 'C5. {{inputs.*}} / {{vars.*}} 不算节点引用（不误报）');
}

console.log('== D. 不可达节点：warn（不拦运行），但要说清"会被当独立入口执行" ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, lg('orphan'), { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'end' }],
  ));
  ok(r.ok, 'D1. 只有 warn → ok 仍为 true（不拦）');
  eq(codes(r), ['UNREACHABLE'], 'D2. 错误码 UNREACHABLE');
  eq(r.warnCount, 1, 'D3. warnCount=1');
  ok(r.items[0].message.includes('独立入口'), 'D4. 消息点明真实后果（会被当独立入口执行，不是跳过）');
  ok(r.items[0].fix.length > 10, 'D5. 带解决办法');
}

console.log('== E. 环路：error（引擎会直接拒绝，必须提前报） ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, lg('a'), lg('b'), { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'end' }],
  ));
  eq(codes(r), ['CYCLE'], 'E1. 错误码 CYCLE');
  ok(!r.ok, 'E2. ok=false');
  ok(r.items[0].fix.includes('循环体'), 'E3. ★解决办法指向正路（要用 loop 的循环体，不要回边）');
  ok(r.items[0].message.includes('→'), 'E4. 消息给出环路路径');
}

console.log('== F. 契约：所有项都带 fix / 纯函数不抛 ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'a', type: 'log', params: { level: 'info', message: '{{ghost.out}}' } }, lg('orphan'), { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  ok(r.items.length >= 2, `F1. 多类问题同时报出（${codes(r).join(',')}）`);
  ok(r.items.every((i) => typeof i.fix === 'string' && i.fix.length > 5), 'F2. ★每一条都有非空解决办法');
  ok(r.items.every((i) => i.level === 'error' || i.level === 'warn'), 'F3. level 只有 error/warn');
  ok(r.items.every((i) => typeof i.code === 'string' && i.code.length > 0), 'F4. 每条都有稳定错误码');
  // 传入垃圾也不能抛
  let threw = false;
  try { selfcheck(null); selfcheck(undefined); selfcheck(42); selfcheck({ nodes: 'x' }); } catch { threw = true; }
  ok(!threw, 'F5. ★对垃圾输入不抛异常（自检绝不阻断运行路径）');
}

console.log('== G. 轮 2：必填参数（与执行期同一个检查器，提前暴露）==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'py', type: 'python', params: {} }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'py' }, { from: 'py', to: 'end' }],
  ));
  eq(codes(r), ['PARAM_REQUIRED'], 'G1. 错误码 PARAM_REQUIRED（python 没写代码）');
  eq(r.items[0].nodeId, 'py', 'G2. 定位到该节点');
  ok(r.items[0].message.includes('Python') || r.items[0].message.includes('py'), 'G3. 消息指出是哪个节点/参数');
  ok(r.items[0].fix.includes('面板'), 'G4. ★解决办法指向面板具体操作');
  ok(!r.ok, 'G5. 属 error（会拦住运行）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'py', type: 'python', params: { codePath: 'x.py' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'py' }, { from: 'py', to: 'end' }],
  ));
  ok(r.ok, 'G6. code/codePath 二选一：给了 codePath 即通过（不误报）');
}

console.log('== H. 轮 2：if/switch 出边缺分支键（恒激活 = 所有分支都跑）==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'sw', type: 'switch', params: { value: 'a', cases: { a: 'log1' } } }, lg('log1'), { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'sw' }, { from: 'sw', to: 'log1' }, { from: 'log1', to: 'end' }],
  ));
  ok(codes(r).includes('BRANCH_KEY_MISSING'), 'H1. 报 BRANCH_KEY_MISSING（现有 ' + codes(r).join(',') + '）');
  const it = r.items.find((i) => i.code === 'BRANCH_KEY_MISSING');
  ok(it.level === 'error' && !r.ok, 'H2. 属 error（静默错误必须拦）');
  ok(it.fix.includes('中点'), 'H3. ★解决办法：去线上点标签选分支键');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'sw', type: 'switch', params: { value: 'a', cases: { a: 'end' } } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'sw' }, { from: 'sw', to: 'end', when: 'a' }],
  ));
  ok(r.ok, 'H4. 有分支键就不报（不误伤）');
}

console.log('== I. 轮 2：switch cases ↔ 出边一致性（warn，不拦）==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'sw', type: 'switch', params: { value: 'a', cases: { a: 'end', b: 'end' } } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'sw' }, { from: 'sw', to: 'end', when: 'a' }, { from: 'sw', to: 'end', when: 'zzz' }],
  ));
  ok(codes(r).includes('SWITCH_CASE_NO_EDGE'), 'I1. cases 有 "b" 但无出边 → 告警');
  ok(codes(r).includes('SWITCH_EDGE_NOT_IN_CASES'), 'I2. 出边键 "zzz" 不在 cases → 告警');
  ok(r.ok, 'I3. 只告警不拦运行（warn）');
  ok(r.items.every((i) => i.fix && i.fix.length > 5), 'I4. 两类告警都带解决办法');
}

console.log('== J. 轮 2：goto 回跳（目标在前面/同层 → 永远不生效）==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'a', type: 'log', params: { level: 'info', message: 'x' }, onError: { goto: 'start' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  ok(codes(r).includes('GOTO_BACKWARD'), 'J1. 报 GOTO_BACKWARD（现有 ' + codes(r).join(',') + '）');
  const it = r.items.find((i) => i.code === 'GOTO_BACKWARD');
  ok(it.level === 'warn', 'J2. 属 warn（配置无害，只是不生效）');
  ok(it.fix.includes('循环体'), 'J3. ★解决办法指向正路（loop 循环体）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'a', type: 'log', params: { level: 'info', message: 'x' }, onError: { goto: 'end' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'end' }],
  ));
  ok(!codes(r).includes('GOTO_BACKWARD'), 'J4. 目标在后面的层 → 不报（正常 goto）');
}

console.log('== K. 轮 3：loop 循环边界（与引擎 LOOP_NO_BOUND 同判据）==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: {} }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ));
  ok(codes(r).includes('LOOP_NO_BOUND'), 'K1. 报 LOOP_NO_BOUND（无 count/while/over）');
  const it = r.items.find((i) => i.code === 'LOOP_NO_BOUND');
  ok(it.level === 'error' && !r.ok, 'K2. 属 error（运行必失败，提前拦）');
  ok(it.fix.includes('循环设置'), 'K3. ★解决办法指向面板「🔁 循环设置」');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 3 } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ));
  ok(!codes(r).includes('LOOP_NO_BOUND'), 'K4. 有 count → 不报（不误伤）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { while: 'true' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ));
  ok(!codes(r).includes('LOOP_NO_BOUND'), 'K5. 有 while 字符串 → 不报');
}
{
  // ★ 回归锁（2026-10-04 踩到的误报）：over/count 在自检阶段还是**模板字符串**，运行时才解析
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start', params: { items: ['x'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}' }, next: 'end' },
      { id: 'end', type: 'end' }],
    [],
  ));
  ok(!codes(r).includes('LOOP_NO_BOUND'), 'K6. ★over 是模板引用（{{…}}）→ 不算无边界（不误报）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: '{{inputs.n}}' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ));
  ok(!codes(r).includes('LOOP_NO_BOUND'), 'K7. count 为模板字符串 → 也不算无边界');
}

console.log('== L. 轮 3：循环体 / 子工作流依赖必须存在（需要宿主注入 knownWorkflows）==');
{
  const known = new Set(['子工作流-文字整理']);
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 2, body: { workflowName: '不存在的子流' } } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ), { knownWorkflows: known });
  ok(codes(r).includes('LOOP_BODY_MISSING'), 'L1. 循环体不存在 → LOOP_BODY_MISSING');
  const it = r.items.find((i) => i.code === 'LOOP_BODY_MISSING');
  ok(it.message.includes('不存在的子流') && it.level === 'error', 'L2. 消息点出缺失的工作流名，级别 error');
  ok(it.fix.includes('循环体下拉'), 'L3. ★解决办法给出具体操作位置');
}
{
  const known = new Set(['子工作流-文字整理']);
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 2, body: { workflowName: '子工作流-文字整理' } } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ), { knownWorkflows: known });
  ok(!codes(r).includes('LOOP_BODY_MISSING'), 'L4. 循环体存在 → 不报');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'sf', type: 'subflow', params: { workflowName: '没这个流' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'sf' }, { from: 'sf', to: 'end' }],
  ), { knownWorkflows: new Set(['x']) });
  ok(codes(r).includes('SUBFLOW_MISSING'), 'L5. subflow 依赖不存在 → SUBFLOW_MISSING（error）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'sf', type: 'subflow', params: { workflowName: '没这个流' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'sf' }, { from: 'sf', to: 'end' }],
  ));
  ok(!codes(r).includes('SUBFLOW_MISSING'), 'L6. 没注入 knownWorkflows（离线/拿不到清单）→ 跳过这项，不误报');
}

console.log('== M. 轮 3：merge 上游 ≥2 / 存值模型可解析 ==');
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, lg('a'), { id: 'mg', type: 'merge', params: {} }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'a', to: 'mg' }, { from: 'mg', to: 'end' }],
  ));
  ok(codes(r).includes('MERGE_NO_UPSTREAM'), 'M1. merge 只有 1 条上游 → MERGE_NO_UPSTREAM（error）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, lg('a'), lg('b'), { id: 'mg', type: 'merge', params: {} }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'a' }, { from: 'start', to: 'b' }, { from: 'a', to: 'mg' }, { from: 'b', to: 'mg' }, { from: 'mg', to: 'end' }],
  ));
  ok(!codes(r).includes('MERGE_NO_UPSTREAM'), 'M2. merge 两条上游 → 不报');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'ai', type: 'subagent', params: { model: 'some-model', prompt: 'hi' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'ai' }, { from: 'ai', to: 'end' }],
  ), { modelResolves: () => false });
  const it = r.items.find((i) => i.code === 'MODEL_UNRESOLVED');
  ok(!!it && it.level === 'warn', 'M3. 存值模型解析不到 → warn（不拦运行）');
  ok(it.fix.includes('选择模型'), 'M4. ★解决办法指向「选择模型」重选');
  ok(it.message.includes('不会被静默改写') === false && it.fix.includes('不会被静默改写'), 'M5. 说明存值不会被静默改写（在 fix 里）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'ai', type: 'subagent', params: { model: 'ok-model', prompt: 'hi' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'ai' }, { from: 'ai', to: 'end' }],
  ), { modelResolves: () => true });
  ok(!codes(r).includes('MODEL_UNRESOLVED'), 'M6. 模型能解析 → 不报');
}

console.log('== N. 轮 4：建议类（全部只提醒，不拦运行）==');
{
  // N1 manual + 有定时任务 → 提醒"定时那次不会停下来等确认"
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'mn', type: 'manual', params: { prompt: '确认一下' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'mn' }, { from: 'mn', to: 'end' }],
  ), { hasSchedule: true });
  const it = r.items.find((i) => i.code === 'MANUAL_AUTOPASS');
  ok(!!it && it.level === 'warn', 'N1. manual + 定时任务 → warn「会被自动放行」');
  ok(r.ok, 'N2. 建议类不拦运行（ok 仍为 true）');
  ok(it.fix.includes('手动点'), 'N3. ★解决办法说明：手动运行时才会真停下来等');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'mn', type: 'manual', params: { prompt: 'x' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'mn' }, { from: 'mn', to: 'end' }],
  ));
  ok(!codes(r).includes('MANUAL_AUTOPASS'), 'N4. 没有定时任务 → 不提醒（不制造噪音）');
}
{
  // N5 "数据源"节点设了跳过支路、被 ≥2 个下游引用 → 静默成"成功但没做事"
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' },
      { id: 'cfg', type: 'set_var', params: { vars: { a: 1 } }, onError: 'continue' },
      { id: 'l1', type: 'log', params: { level: 'info', message: '{{cfg.out.a}}' }, next: 'end' },
      { id: 'l2', type: 'log', params: { level: 'info', message: '{{cfg.out.a}}' } },
      { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'cfg' }, { from: 'cfg', to: 'l1' }, { from: 'cfg', to: 'l2' }, { from: 'l2', to: 'end' }],
  ));
  const it = r.items.find((i) => i.code === 'SOURCE_SKIP_SILENT');
  ok(!!it && it.level === 'warn' && it.nodeId === 'cfg', 'N5. 数据源 skip + ≥2 下游引用 → warn');
  ok(it.message.includes('成功'), 'N6. 点明真实风险：整轮仍显示成功、像"什么都没做"');
  // ★ 2026-10-04：这条消息原来写成「整轮却仍显示**成功**」——** 在 React 纯文本节点里会原样显示成星号
  //   （同一坑第三次复发）。判据从"含成功"收紧为"含成功且不含 **"，把复发变成会自动报红的回归。
  ok(!it.message.includes('**'), 'N6b. 消息里没有 Markdown 星号（纯文本会被原样渲染）');
  ok(it.fix.includes('停止这条支路'), 'N7. ★建议改成「⛔ 停止这条支路」');
}
{
  // N8 只有 1 个下游引用 → 不提醒（降噪）
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' },
      { id: 'cfg', type: 'set_var', params: { vars: { a: 1 } }, onError: 'continue' },
      { id: 'l1', type: 'log', params: { level: 'info', message: '{{cfg.out.a}}' } },
      { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'cfg' }, { from: 'cfg', to: 'l1' }, { from: 'l1', to: 'end' }],
  ));
  ok(!codes(r).includes('SOURCE_SKIP_SILENT'), 'N8. 只 1 个下游引用 → 不提醒');
}
{
  // N9 图片/视频生成 → 费用提醒
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'img', type: 'image_generate', params: { prompt: 'a cat', baseURL: 'https://x', model: 'm' } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'img' }, { from: 'img', to: 'end' }],
  ));
  const it = r.items.find((i) => i.code === 'MEDIA_COST');
  ok(!!it && it.level === 'warn' && it.nodeId === 'img', 'N9. 含媒体生成节点 → warn 会产生费用');
  ok(it.fix.includes('跳过这条支路'), 'N10. ★给出调试期做法（先设跳过/断开）');
}
{
  // N11 大循环（带循环体 ≥20 次）→ 放大提醒
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 30, body: { workflowName: 'w' } } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ), { knownWorkflows: new Set(['w']) });
  const it = r.items.find((i) => i.code === 'BIG_LOOP');
  ok(!!it && it.level === 'warn' && it.message.includes('30'), 'N11. 循环体 + 30 次 → warn（耗时/费用放大）');
}
{
  const r = selfcheck(mk(
    [{ id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 3 } }, { id: 'end', type: 'end' }],
    [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }],
  ));
  ok(!codes(r).includes('BIG_LOOP'), 'N12. 小循环（3 次）→ 不打扰');
}

console.log(`\n=== selfcheck 工作流自检（轮 1+2+3+4）：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
