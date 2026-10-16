// test/yaml-lite.test.mjs — 自研 YAML 解析器「逐嵌套结构」单元测试（纯函数，不依赖 DSH 环境）
//   背景：2026-09-25 / 09-26 / 10-11 三次同族深层 bug 都出在嵌套结构上——
//     ① `key:` 打开子层级后，子层里的 `- item` 数组行被整段丢弃（settings.yaml 的 models 解析成空对象）
//     ② `- key: value` 数组项的子字段整体丢失（只留 id，name/contextWindow/input 全被 parent.isArray 拦掉）
//     ③ `- key:`（空值）从不建立 key 这一层（官方 patch 的 `- insert:` + 嵌套 `- id:` 整层丢失）
//   本文件把「对象→数组→对象→列表」的每种组合都钉死，避免同族 bug 第四次出现。
//   手段：esbuild 即时打包 src/adapter/yaml-lite.ts → 临时 mjs → 断言（与 test/topo.test.mjs 同款写法）
//   跑法：node test/yaml-lite.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
const J = (v) => JSON.stringify(v);

const dir = tmpRoot('df-yaml-lite-');
const OUT = join(dir, 'yaml-lite.mjs');
await build({ entryPoints: ['src/adapter/yaml-lite.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { parse } = await import(pathToFileURL(OUT).href);

// ===== 1. 标量形态与整行注释 =====
console.log('== 1. 标量与整行注释 ==');
{
  const r = parse([
    '# 整行注释被跳过',
    'name: dag-flow',
    'count: 42',
    'ratio: 1.5',
    'neg: -7',
    'on: true',
    'off: false',
    'nothing: null',
    'tilde: ~',
    'dq: "带\\n换行"',
    "sq: '单引号'",
  ].join('\n'));
  assert(r.name === 'dag-flow', '字符串');
  assert(r.count === 42, '整数 → number');
  assert(r.ratio === 1.5, '小数 → number');
  assert(r.neg === -7, '负数');
  assert(r.on === true && r.off === false, 'true/false → boolean');
  assert(r.nothing === null && r.tilde === null, 'null 与 ~ → null');
  assert(r.dq === '带\n换行', '双引号内 \\n 还原为换行');
  assert(r.sq === '单引号', '单引号字符串');
}
// 现状说明：只跳过**整行**注释，行内 # 不剥离（值里会带上）——这条是当前语义，锁住它
{
  const r = parse('key: value # 行内注释');
  assert(r.key === 'value # 行内注释', '现状：行内 # 不剥离（只跳整行注释）');
}

// ===== 2. ★bug①场景：`key:` 子层级首行是 `- ` ⇒ 惰性对象→数组 =====
console.log('== 2. key: 下的数组（bug① 回归） ==');
{
  const r = parse([
    'llm:',
    '  models:',
    '    - id: a',
    '    - id: b',
  ].join('\n'));
  assert(Array.isArray(r.llm?.models), 'llm.models 是数组（不是空对象）');
  assert(r.llm.models.length === 2 && r.llm.models[0].id === 'a' && r.llm.models[1].id === 'b', `两项都在：${J(r.llm.models)}`);
}

// ===== 3. ★bug②场景：`- key: value` 数组项的子字段与嵌套列表 =====
console.log('== 3. 数组项对象的子字段（bug② 回归） ==');
{
  const r = parse([
    'models:',
    '  - id: kimi-vision',
    '    name: Kimi Vision',
    '    contextWindow: 200000',
    '    input:',
    '      - text',
    '      - image',
    '  - id: plain',
    '    name: 纯文本模型',
  ].join('\n'));
  const m = r.models ?? [];
  assert(m.length === 2, `两项：${m.length}`);
  assert(m[0]?.id === 'kimi-vision' && m[0]?.name === 'Kimi Vision', '第一项的 id/name 都在（不再只剩 id）');
  assert(m[0]?.contextWindow === 200000, '数字子字段 → number');
  assert(Array.isArray(m[0]?.input) && m[0].input.join(',') === 'text,image', `input 下的嵌套列表：${J(m[0]?.input)}`);
  assert(m[1]?.id === 'plain' && m[1]?.name === '纯文本模型', '第二项没被前一项吞掉（同缩进 `- ` 自动 pop 回数组）');
}

// ===== 4. 对象→数组→对象→列表（四层组合） =====
console.log('== 4. 四层嵌套：对象→数组→对象→列表 ==');
{
  const r = parse([
    '- id: dag-flow',
    '  name: "@x/dag-flow"',
    '  config:',
    '    enabled: true',
    '    models:',
    '      - id: a',
    '        tags: [x, y]',
    '        input:',
    '          - text',
    '          - image',
    '  after: 1',
  ].join('\n'));
  assert(Array.isArray(r), '顶层以 `- ` 开头 ⇒ root 是数组');
  const item = r[0] ?? {};
  assert(item.id === 'dag-flow' && item.name === '@x/dag-flow', '数组项对象字段');
  assert(item.config?.enabled === true, '数组项下的子对象（config.enabled）');
  assert(Array.isArray(item.config?.models) && item.config.models.length === 1, 'config.models 是数组');
  assert(Array.isArray(item.config.models[0]?.input) && item.config.models[0].input.join(',') === 'text,image', `再深一层的列表：${J(item.config.models[0]?.input)}`);
  assert(J(item.config.models[0]?.tags) === J(['x', 'y']), `行内 flow 数组真解析（2026-10-11 审计⑩ 起）：${J(item.config.models[0]?.tags)}`);
  assert(item.after === 1, '回到数组项层的后续键仍归本项（栈没串层）');
}

// ===== 5. `- key:`（空值）建立 key 层；数组项是标量 =====
console.log('== 5. - key: 空值入栈 / 标量数组项 ==');
{
  const r = parse([
    'list:',
    '  - text',
    '  - image',
    '  - key:',
    '    deep: 1',
  ].join('\n'));
  assert(r.list.slice(0, 2).join(',') === 'text,image', '标量数组项');
  // ★ 2026-10-11 修复（第三个同族 bug）：原实现只 push 数组项对象、**没建立 key 这一层**，
  //   `key` 连同其下更深缩进的内容一起丢。修好后 key 层必须在，且子字段挂在 key 底下。
  assert(r.list[2]?.key?.deep === 1, `- key: 空值建立 key 层：${J(r.list[2])}`);
  assert(r.list[2]?.deep === undefined, '子字段不再错误地挂在数组项这一层（层级正确）');
}

// ===== 5c. ★官方 patch 形状：`- insert:` + 嵌套 `- id:`（第三个同族 bug 的回归锁） =====
console.log('== 5c. - insert: + 嵌套 - id:（官方 base patch 形状） ==');
{
  const r = parse([
    '# The dsh-base bundle patch',
    '- insert:',
    '    - id: tool-plugin-manager',
    "      name: '@deepseek-ai/dsh-plugin-manager/tools'",
    '      disabled: true',
    '',
    '    - id: hmr',
    "      name: '@deepseek-ai/dsh-hmr'",
    '      config:',
    '        root: []',
    '',
    '    # 注释行不影响项归属',
    '    - id: llm',
    "      name: '@deepseek-ai/dsh-llm'",
  ].join('\n'));
  assert(Array.isArray(r) && r.length === 1, `顶层 1 项：${Array.isArray(r) ? r.length + ' 项' : '不是数组'}`);
  assert(Array.isArray(r[0]?.insert), 'insert 这一层存在且是数组（修复前为 undefined）');
  const ids = (r[0]?.insert ?? []).map((e) => e?.id);
  assert(ids.join(',') === 'tool-plugin-manager,hmr,llm', `嵌套 - id 全部读到：${ids.join(',')}`);
  assert(r[0].insert[0]?.disabled === true, '嵌套项的子字段（disabled: true）');
  assert(r[0].insert[0]?.name === '@deepseek-ai/dsh-plugin-manager/tools', '嵌套项的 name 归本项');
  assert(Array.isArray(r[0].insert[1]?.config?.root) && r[0].insert[1].config.root.length === 0, `嵌套项下的子对象（config.root = 空数组）：${J(r[0].insert[1]?.config?.root)}`);
  assert(r[0].insert[2]?.id === 'llm', '注释行不打乱后续项的归属');

  // 同一份文件里并列的第二条顶层 `- insert:` 各自成项（dsh-web-app 的 patch 就是这个形状）
  const r2 = parse([
    '- insert:',
    '    - id: a',
    '    - id: b',
    '- insert:',
    '    - id: c',
  ].join('\n'));
  assert(r2.length === 2, `两条并列 - insert: → 2 项：${r2.length}`);
  assert(r2[0].insert.map((e) => e.id).join(',') === 'a,b', '第一条的嵌套列表完整');
  assert(r2[1].insert.map((e) => e.id).join(',') === 'c', '第二条的嵌套列表归属正确（没被前一条吞掉）');

  // 嵌套列表与 `- insert:` 同缩进（YAML 合法：序列可以与其父 mapping 键同列）
  const r3 = parse(['- insert:', '  - id: same-indent'].join('\n'));
  assert(r3[0]?.insert?.[0]?.id === 'same-indent', `同缩进写法也成立：${J(r3)}`);
}

// ===== 5b. dag-flow 真正依赖的形状：profile patch 的扁平 `- id: ...` + config =====
console.log('== 5b. 扁平 patch 行（llm-config 依赖） ==');
{
  const r = parse([
    '# Your patch layer for this dsh profile, applied after every bundle layer',
    '- id: meow-memory',
    "  name: 'meow-memory'",
    '  config:',
    '    promptLang: zh',
    '- id: llm-deepseek',
    '  name: llm-deepseek',
    '  config:',
    '    apiKey: sk-test',
    '    models:',
    '      - id: deepseek-chat',
    '        input:',
    '          - text',
    '- id: agent-default-model',
    '  config:',
    '    model: deepseek-chat',
  ].join('\n'));
  const ids = (Array.isArray(r) ? r : []).map((e) => e?.id).filter(Boolean);
  assert(Array.isArray(r), '顶层是数组（patch 文件形状）');
  assert(ids.join(',') === 'meow-memory,llm-deepseek,agent-default-model', `llm-config 要的 id 都能读到：${ids.join(',')}`);
  const ds = r.find((e) => e.id === 'llm-deepseek');
  assert(ds?.config?.apiKey === 'sk-test', 'config 子对象可读');
  assert(Array.isArray(ds?.config?.models) && ds.config.models[0]?.id === 'deepseek-chat', 'config 下 models 数组可读');
  assert(ds.config.models[0]?.input?.join(',') === 'text', 'models[].input 能力数组可读');
  const dm = r.find((e) => e.id === 'agent-default-model');
  assert(dm?.config?.model === 'deepseek-chat', 'agent-default-model.config.model 可读');
}

// ===== 5d. 块状字符串 `|` 与 `>`（2026-10-11 新增：以前会把 key 变成 {}，静默给错值） =====
console.log('== 5d. 块状字符串（literal | / folded >） ==');
{
  const r = parse([
    'config:',
    '  section: |',
    '    第一行',
    '',
    '    第二行',
    '  after: 1',
  ].join('\n'));
  assert(typeof r.config?.section === 'string', `| 解析成字符串（不再是对象）：${J(r.config?.section)}`);
  assert(r.config.section === '第一行\n\n第二行\n', `| 保留换行、末尾按 clip 补一个换行：${J(r.config?.section)}`);
  assert(r.config?.after === 1, '块结束后的同级键仍归本层（缩进回到 key 同级即结束）');

  // 真实形状：dsh-base 的 `- id: plan-mode` → `config.section: |`（缩进 10 的长提示词）
  const r2 = parse([
    '- id: plan-mode',
    '  config:',
    '    section: |',
    '          You are in plan mode.',
    '          Stay in plan mode.',
    '    keep: true',
    '- id: next-row',
  ].join('\n'));
  assert(r2[0]?.config?.section === 'You are in plan mode.\nStay in plan mode.\n', `嵌套在数组项里也对：${J(r2[0]?.config?.section)}`);
  assert(r2[0]?.config?.keep === true, '块后的同级键仍归 config');
  assert(r2[1]?.id === 'next-row', '块后的下一个数组项没被吞掉');

  const r3 = parse(['note: >', '  aaa', '  bbb', '', '  ccc'].join('\n'));
  assert(r3.note === 'aaa bbb\nccc\n', `> 折叠成空格、空行成段落分隔：${J(r3.note)}`);

  const r4 = parse(['a: |', 'b: 1'].join('\n'));
  assert(r4.a === '' && r4.b === 1, `key: | 后面直接同级 → 空串且不吞下一行：${J(r4)}`);

  // ★ chomping / 缩进指示符：真实文件里用到的是 `|-` 与 `>-`（实测 4+4+4 处）
  const r5 = parse(['description: |-', '  一行', '  二行', 'next: 1'].join('\n'));
  assert(r5.description === '一行\n二行', `|- strip：不补末尾换行：${J(r5.description)}`);
  assert(r5.next === 1, '|- 块后的同级键仍归本层');
  const r6 = parse(['personaPrefix: >-', '  You are a coding agent', '  powered by test.', 'k: 2'].join('\n'));
  assert(r6.personaPrefix === 'You are a coding agent powered by test.', `>- 折叠且 strip：${J(r6.personaPrefix)}`);
  const r7 = parse(['x: |2', '    a', 'y: 1'].join('\n'));
  assert(r7.x === '  a\n', `|2 显式缩进指示符（正文缩进 = key 缩进 + 2，多出来的空格保留）：${J(r7.x)}`);
  assert(r7.y === 1, '|2 块后的同级键仍归本层');
}

// ===== 5e. 行内 flow 数组/对象（2026-10-11 审计⑩：以前一律原样存字符串） =====
console.log('== 5e. 行内 flow 数组/对象 ==');
{
  const r = parse([
    'models:',
    '  - id: kimi-vision',
    '    input: [text, image]',
    '    fallbacks: []',
    '  - id: plain',
    '    input: [text]',
  ].join('\n'));
  assert(J(r.models[0]?.input) === J(['text', 'image']), `[text, image] → 数组：${J(r.models[0]?.input)}`);
  assert(Array.isArray(r.models[0]?.fallbacks) && r.models[0].fallbacks.length === 0, `[] → 空数组（真机 patch 里 fallbacks: [] 是真实用例）：${J(r.models[0]?.fallbacks)}`);
  assert(J(r.models[1]?.input) === J(['text']), '第二项的 flow 数组同样解析');
  // 数字/布尔/引号元素与"引号内的逗号不切分"
  const r2 = parse(['a: [1, true, "x, y", \'z\']'].join('\n'));
  assert(J(r2.a) === J([1, true, 'x, y', 'z']), `flow 元素按标量解析、引号内逗号不切分：${J(r2.a)}`);
  // 嵌套 flow + 对象形式
  const r3 = parse(['m: {a: 1, b: [x, y]}'].join('\n'));
  assert(r3.m?.a === 1 && J(r3.m?.b) === J(['x', 'y']), `flow 对象 + 嵌套数组：${J(r3.m)}`);
  // 顶层数组项直接是 flow 数组
  const r4 = parse(['- [a, b]', '- c'].join('\n'));
  assert(J(r4) === J([['a', 'b'], 'c']), `数组项直接写 flow：${J(r4)}`);
  // 普通字符串里带方括号但不成对/不在首尾 → 仍是字符串（不误伤）
  const r5 = parse(['note: see [1', 'path: a]b'].join('\n'));
  assert(r5.note === 'see [1' && r5.path === 'a]b', `不配对的方括号仍是字符串：${J(r5)}`);
}

// ===== 5f. `+` chomping 与「数组项里的块状字符串」（2026-10-11 审计⑩） =====
console.log('== 5f. + chomping / - key: |（数组项块） ==');
{
  const r = parse(['a: |+', '  x', '', ''].join('\n'));
  assert(r.a === 'x\n\n\n', `|+ keep：保留尾部空行（clip 会收成一个换行）：${J(r.a)}`);

  const r2 = parse([
    'steps:',
    '  - name: s1',
    '    section: |',
    '      line1',
    '      line2',
    '  - name: s2',
    '    section: |-',
    '      only',
  ].join('\n'));
  assert(r2.steps[0]?.section === 'line1\nline2\n', `数组项里的 \`- key: |\` 现在能解析（此前存成字符串 "|"）：${J(r2.steps[0]?.section)}`);
  assert(r2.steps[0]?.name === 's1', '块不影响同项的其它字段');
  assert(r2.steps[1]?.section === 'only', `数组项里的 |- strip：${J(r2.steps[1]?.section)}`);
}

// ===== 6. 深缩进三层对象 =====
console.log('== 6. 三层对象嵌套 ==');
{
  const r = parse([
    'a:',
    '  b:',
    '    c: 1',
    '    d:',
    '      - e',
  ].join('\n'));
  assert(r.a?.b?.c === 1 && r.a.b.d.join(',') === 'e', `三层对象 + 末层列表：${J(r)}`);
}

// ===== 7. 边界：冒号后必须有空格、无冒号行被忽略 =====
console.log('== 7. 边界 ==');
{
  const r = parse(['noColonLine', 'url: http://x.com/a:b', 'kv: value'].join('\n'));
  assert(r.noColonLine === undefined, '无冒号行被忽略');
  assert(r.url === 'http://x.com/a:b', '值里的冒号不受影响（只认冒号后跟空格/行尾）');
  assert(r.kv === 'value', '普通键值');
  assert(parse('').constructor === Object || typeof parse('') === 'object', '空输入 → 对象');
}

console.log(`\n=== yaml-lite：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
