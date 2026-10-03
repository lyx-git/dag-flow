// test/llm-config.test.mjs — dsh settings.yaml schema 解析锁定（2026-09-27 降耦审计意见 5）
// 目标：把 dag-flow 依赖的 dsh 配置结构（llm-pi-ai.providers / llm-deepseek / refs）
// 用多代 fixture 形态锁住——dsh 改 schema 时这里是第一道报警。
// 手段：esbuild 即时打包 src/adapter/subagent.ts + src/adapter/dsh-home.ts → 临时 mjs → 断言
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'dag-flow-llm-test-'));

// ★ H 组（0.2.0 profile patch 源）要走文件系统链：DSH_HOME 必须在 import bundle 前指向 fixture
// （subagent.ts 的 SETTINGS_PATH 是模块顶层固化，import 后再改 env 无效）
import { mkdirSync, writeFileSync } from 'node:fs';
const homeFixture = join(tmp, 'home', '.dsh');
mkdirSync(join(homeFixture, 'profiles', 'web'), { recursive: true });
process.env.DSH_HOME = homeFixture;

const OUT = join(tmp, 'llm-config.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/subagent.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  external: ['@deepseek-ai/cordis'],
  logLevel: 'silent',
});
const { buildLlmCandidates, envFallbackEndpoint, listAllEndpoints, resolveLlmEndpoint } = await import(pathToFileURL(OUT).href);

const OUT_HOME = join(tmp, 'dsh-home.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/dsh-home.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT_HOME,
  logLevel: 'silent',
});
const { dshHome } = await import(pathToFileURL(OUT_HOME).href);

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ---- 形态 A：models 为数组 + id 字段 + input 标注（dsh 当前主形态） ----
{
  const settings = {
    'llm-pi-ai': {
      providers: {
        'pi-ai': {
          baseURL: 'https://api.example.com/v1',
          apiKeyEnv: 'P1_KEY',
          models: [
            { id: 'model-a', input: ['text', 'image'] },
            { id: 'model-b' },
          ],
        },
      },
    },
  };
  const creds = { refs: { P1_KEY: 'sk-test-a' } };
  const eps = buildLlmCandidates(settings, creds);
  t('A1 数组 models 解析出 2 个端点', eps.length === 2);
  t('A2 refs 里的 key 生效', eps[0]?.apiKey === 'sk-test-a');
  t('A3 providerName = provider:model', eps[0]?.providerName === 'pi-ai:model-a');
  t('A4 input 标注透传（多模态）', JSON.stringify(eps[0]?.input) === JSON.stringify(['text', 'image']));
  t('A5 未标注 input 视为仅文本', JSON.stringify(eps[1]?.input) === JSON.stringify(['text']));
  t('A6 baseURL 透传', eps[0]?.baseURL === 'https://api.example.com/v1');
}

// ---- 形态 B：models 为对象 + name 字段（yaml 解析差异防御的另一半） ----
{
  const settings = {
    'llm-pi-ai': {
      providers: {
        custom: {
          baseURL: 'https://b.example.com/v1',
          apiKeyEnv: 'P2_KEY',
          models: { m1: { name: 'model-x' }, m2: { id: 'model-y' } },
        },
      },
    },
  };
  process.env.P2_KEY = 'sk-env-b';
  const eps = buildLlmCandidates(settings, {});
  t('B1 对象 models 解析出 2 个端点', eps.length === 2);
  t('B2 name 字段兜底生效', eps[0]?.model === 'model-x');
  t('B3 id 字段优先于 name', eps[1]?.model === 'model-y');
  t('B4 key 缺 refs 时回环境变量', eps[0]?.apiKey === 'sk-env-b');
  delete process.env.P2_KEY;
}

// ---- 形态 C：llm-deepseek 简写（baseURL + agent-default-model） ----
{
  const settings = {
    'llm-deepseek': { baseURL: 'https://api.deepseek.com' },
    'agent-default-model': { model: 'deepseek-reasoner' },
  };
  const creds = { refs: { DEEPSEEK_API_KEY: 'sk-ds' } };
  const eps = buildLlmCandidates(settings, creds);
  t('C1 简写形态出 1 个端点', eps.length === 1);
  t('C2 agent-default-model 生效', eps[0]?.model === 'deepseek-reasoner');
  t('C3 providerName=llm-deepseek 且仅文本', eps[0]?.providerName === 'llm-deepseek' && JSON.stringify(eps[0]?.input) === JSON.stringify(['text']));
}

// ---- 形态 D：键缺失/空配置 → 0 端点（不抛错） ----
{
  t('D1 空对象 → 0 端点', buildLlmCandidates({}, {}).length === 0);
  t('D2 无关键名 → 0 端点', buildLlmCandidates({ other: 1 }, { refs: {} }).length === 0);
}

// ---- dshHome()：DSH_HOME 环境变量优先（意见 2 的行为锁） ----
{
  const saved = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  t('E1 默认落 ~/.dsh', dshHome().endsWith('.dsh'));
  process.env.DSH_HOME = 'X:\\portable-dsh';
  t('E2 DSH_HOME 优先于 ~/.dsh', dshHome() === 'X:\\portable-dsh');
  if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved;
}

// ---- 环境变量逃生舱（2026-09-27 用户拍板方案 C）----
{
  const saved = {
    b: process.env.DAG_FLOW_LLM_BASEURL,
    k: process.env.DAG_FLOW_LLM_KEY,
    m: process.env.DAG_FLOW_LLM_MODEL,
  };
  delete process.env.DAG_FLOW_LLM_BASEURL;
  delete process.env.DAG_FLOW_LLM_KEY;
  delete process.env.DAG_FLOW_LLM_MODEL;
  t('F1 未设环境变量 → null（不影响 dsh 首选）', envFallbackEndpoint() === null);
  process.env.DAG_FLOW_LLM_BASEURL = 'https://env.example.com/v1/';
  const e1 = envFallbackEndpoint();
  t('F2 仅 BASEURL → 默认模型 + 尾斜杠规范 + 无 key', e1?.model === 'deepseek-chat' && e1?.baseURL === 'https://env.example.com/v1' && e1?.apiKey === '' && e1?.providerName === 'env-fallback');
  process.env.DAG_FLOW_LLM_KEY = 'sk-env';
  process.env.DAG_FLOW_LLM_MODEL = 'glm-5.3-flash';
  const e2 = envFallbackEndpoint();
  t('F3 三变量齐全 → 全部生效', e2?.apiKey === 'sk-env' && e2?.model === 'glm-5.3-flash');
  if (saved.b === undefined) delete process.env.DAG_FLOW_LLM_BASEURL; else process.env.DAG_FLOW_LLM_BASEURL = saved.b;
  if (saved.k === undefined) delete process.env.DAG_FLOW_LLM_KEY; else process.env.DAG_FLOW_LLM_KEY = saved.k;
  if (saved.m === undefined) delete process.env.DAG_FLOW_LLM_MODEL; else process.env.DAG_FLOW_LLM_MODEL = saved.m;
}

// ---- G：yaml-lite 顶层数组（dsh 0.2.0 cordis.patch.yml 形态：- id: ... / config: ...）----
// 单独 bundle yaml-lite，喂真实 patch 结构（含嵌套 providers/models/input）
{
  const OUT_YAML = join(tmp, 'yaml-lite.bundle.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/adapter/yaml-lite.ts')],
    bundle: true, format: 'esm', platform: 'node', target: 'node20',
    outfile: OUT_YAML, logLevel: 'silent',
  });
  const { parse: yamlParse } = await import(pathToFileURL(OUT_YAML).href);
  const patchYaml = [
    '# Your patch layer for this dsh profile',
    '- id: meow-memory',
    "  name: 'meow-memory'",
    '  config:',
    '    promptLang: zh',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      custom-model:',
    '        apiKeyEnv: CUSTOM_MODEL_API_KEY',
    '        baseURL: https://ark.example.com/api/v3',
    '        models:',
    '          - id: model-text',
    '            name: model-text',
    '            contextWindow: 128000',
    '            maxTokens: 4096',
    '          - id: model-vision',
    '            contextWindow: 1000000',
    '            maxTokens: 131072',
    '            input:',
    '              - text',
    '              - image',
    '- id: agent-default-model',
    '  config:',
    '    provider: custom-model-vision',
    '    model: glm-test',
  ].join('\n');
  const doc = yamlParse(patchYaml);
  t('G1 顶层数组解析（array，2+ 条目）', Array.isArray(doc) && doc.length === 3);
  const piEntry = Array.isArray(doc) ? doc.find((x) => x && x.id === 'llm-pi-ai') : null;
  t('G2 llm-pi-ai 条目命中', !!piEntry && piEntry.name === '@deepseek-ai/dsh-llm-pi-ai');
  const cm = piEntry?.config?.providers?.['custom-model'];
  t('G3 providers.custom-model 字段齐全', cm?.baseURL === 'https://ark.example.com/api/v3' && cm?.apiKeyEnv === 'CUSTOM_MODEL_API_KEY');
  t('G4 models 数组 2 项且 id 生效', Array.isArray(cm?.models) && cm.models.length === 2 && cm.models[0].id === 'model-text');
  t('G5 models 项嵌套 input 数组完整', JSON.stringify(cm?.models?.[1]?.input) === JSON.stringify(['text', 'image']));
  t('G6 同层多条目互不串扰', Array.isArray(doc) && doc[2]?.config?.model === 'glm-test');
}

// ---- H：0.2.0 文件链实测（fixture home：无 settings.yaml，仅 profiles/web/cordis.patch.yml + .credentials.yaml）----
{
  process.env.DSH_HOME = homeFixture; // E 块动过 DSH_HOME，恢复 fixture
  const patchYaml = [
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      patch-provider:',
    '        apiKeyEnv: PATCH_KEY',
    '        api: anthropic-messages',
    '        baseURL: https://patch.example.com/v1',
    '        models:',
    '          - id: patch-model',
    '            input:',
    '              - text',
    '- id: llm-deepseek',
    '  config:',
    '    baseURL: https://ds.example.com',
    '- id: agent-default-model',
    '  config:',
    '    model: deepseek-chat',
  ].join('\n');
  writeFileSync(join(homeFixture, 'profiles', 'web', 'cordis.patch.yml'), patchYaml, 'utf8');
  writeFileSync(join(homeFixture, '.credentials.yaml'), 'refs:\n  PATCH_KEY: sk-patch-1\n', 'utf8');
  // fixture 故意不写 settings.yaml —— 模拟 dsh 0.2.0 迁移后的形态
  const eps = await listAllEndpoints();
  t('H1 仅 patch 源发现 2 个端点（pi-ai 1 + deepseek 简写 1）', eps.length === 2, JSON.stringify(eps?.map((e) => e.providerName)));
  t('H2 patch 条目 key 经 .credentials.yaml refs 生效', eps[0]?.apiKey === 'sk-patch-1' && eps[0]?.baseURL === 'https://patch.example.com/v1');
  t('H3 patch 模型 input 透传', JSON.stringify(eps[0]?.input) === JSON.stringify(['text']));
  t('H4 llm-deepseek 简写从 patch 条目生效', eps.some((e) => e.providerName === 'llm-deepseek' && e.model === 'deepseek-chat'));

  // H5：settings.yaml 与 patch 并存 → 键级 settings.yaml 优先（同名键整体让位，防迁移过渡期双源重复端点）
  writeFileSync(join(homeFixture, 'settings.yaml'), [
    'llm-pi-ai:',
    '  providers:',
    '    yaml-provider:',
    '      apiKeyEnv: PATCH_KEY',
    '      baseURL: https://yaml.example.com/v1',
    '      models:',
    '        - id: yaml-model',
  ].join('\n'), 'utf8');
  const eps2 = await listAllEndpoints();
  const provNames = eps2.map((e) => e.providerName);
  t('H5 settings.yaml 优先：yaml-provider 在、patch-provider 让位', provNames.some((n) => n === 'yaml-provider:yaml-model') && !provNames.some((n) => n.startsWith('patch-provider:')), JSON.stringify(provNames));
  t('H6 同名键让位但缺键仍补：llm-deepseek 从 patch 补进', eps2.some((e) => e.providerName === 'llm-deepseek' && e.model === 'deepseek-chat'), JSON.stringify(provNames));

  // 清理 settings.yaml，避免影响其他测试块（本文件内无后续文件链测试，保险起见）
  try { (await import('node:fs')).unlinkSync(join(homeFixture, 'settings.yaml')); } catch { /* */ }
  const savedHome = process.env.DSH_HOME;
  if (savedHome === homeFixture) { /* 留着，进程级无碍 */ }
}

// ---- I：非 OpenAI 兼容协议防御（2026-10-02 方案B，修 AI 节点 404）----
// fixture 的 patch-provider 带 api: anthropic-messages（本组在 H 组 fixture 基础上跑，
// H5 写入的 settings.yaml 已在 H 尾删除 → patch 源生效）
{
  process.env.DSH_HOME = homeFixture;
  const eps3 = await listAllEndpoints();
  const cm = eps3.find((e) => e.providerName === 'patch-provider:patch-model');
  t('I1 anthropic-messages 协议 provider 标 viaHost（不再 OpenAI 直连）', cm?.viaHost === true, JSON.stringify(cm));
  t('I2 viaHost 端点带 hostProvider=provider 键名', cm?.hostProvider === 'patch-provider');
  t('I3 viaHost 端点 baseURL 允许保留（执行侧不再用它，仅展示）', cm?.baseURL === 'https://patch.example.com/v1');
  // 执行侧：模型匹配允许 viaHost 命中（baseURL 为空合法；host 发现源不可用时落到防腐层标记的端点）
  try {
    const ep = await resolveLlmEndpoint('patch-provider:patch-model');
    t('I4 resolveLlmEndpoint 命中 viaHost 端点（走 host 路由）', ep.viaHost === true && ep.model === 'patch-model');
  } catch (e) {
    t('I4 resolveLlmEndpoint 命中 viaHost 端点（走 host 路由）', false, String(e));
  }
  // 未匹配模型 → 明确报错（不再静默改用其他端点——「选了A用B」陷阱）
  let notFound = '';
  try { await resolveLlmEndpoint('dsh:not-exist-model'); } catch (e) { notFound = String(e?.message ?? e); }
  t('I5 未匹配模型明确报错（不再静默换端点）', notFound.includes('未找到模型'), notFound.slice(0, 120));
}

// ---- J：显示名字段（2026-10-03 用户要求「下拉/报错不要用模型 id，不容易分辨」）----
{
  const settings = {
    'llm-pi-ai': {
      providers: {
        'pi-ai-disp': {
          baseURL: 'https://j.example.com/v1',
          models: [
            { id: 'm-disp', name: '显示名-甲' },  // name ≠ id → 算显示名
            { id: 'm-same', name: 'm-same' },     // name === id（本机常见写法）→ 不带头，让 UI 回退 model id
            { id: 'm-no-name' },                  // 无 name
          ],
        },
      },
    },
  };
  const eps = buildLlmCandidates(settings, {});
  const by = (id) => eps.find((e) => e.model === id);
  t('J1 providerLabel = provider 键名（同名消歧用，比内部串 pid:model 好认）', by('m-disp')?.providerLabel === 'pi-ai-disp', String(by('m-disp')?.providerLabel));
  t('J2 name ≠ id → modelLabel = 显示名', by('m-disp')?.modelLabel === '显示名-甲', String(by('m-disp')?.modelLabel));
  t('J3 name === id → 不带 modelLabel（UI 回退 model id，不假装有显示名）', by('m-same')?.modelLabel === undefined, String(by('m-same')?.modelLabel));
  t('J4 无 name → 不带 modelLabel', by('m-no-name')?.modelLabel === undefined, String(by('m-no-name')?.modelLabel));
  t('J5 ★ 存值/路由字段不受显示名影响', by('m-disp')?.providerName === 'pi-ai-disp:m-disp' && by('m-disp')?.model === 'm-disp');
}

console.log(`\n=== llm-config: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
