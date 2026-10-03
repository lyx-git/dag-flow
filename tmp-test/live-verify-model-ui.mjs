// tmp-test/live-verify-model-ui.mjs — 真机验证「模型显示名 + 去重 + 报错文案显示名」
// 用法：node tmp-test/live-verify-model-ui.mjs
const BASE = process.env.DF_BASE ?? 'http://127.0.0.1:3080/api/dag-flow';
const key = (s) => String(s).replace(/^llm:/, '');
let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('== ① /models：显示名 + 去重 ==');
const j = await (await fetch(BASE + '/models')).json();
const models = j.models ?? [];
console.log(`  条数：${models.length}`);
t('每项都有 label（显示名）', models.every((m) => typeof m.label === 'string' && m.label.length > 0));
const dup = models.map((m) => key(m.name ?? m.id));
t('无重复的 provider:model（去重生效）', new Set(dup).size === dup.length,
  `重数 ${dup.length - new Set(dup).size}`);
t('settings 直读的重复项已消失（不再有 dsh:custom-model:*）', !models.some((m) => String(m.id).startsWith('dsh:custom-model:')),
  JSON.stringify(models.filter((m) => String(m.id).startsWith('dsh:custom-model:')).map((m) => m.id).slice(0, 5)));
const ds = models.find((m) => m.id === 'dsh:llm:deepseek-official:deepseek-flash');
t('deepseek-flash 显示名为 DeepSeek-V41-Flash', ds?.label === 'DeepSeek-V41-Flash', String(ds?.label));
t('providerLabel 不再是内部串（host 源=DeepSeek）', ds?.providerLabel === 'DeepSeek', String(ds?.providerLabel));
const onlySettings = models.find((m) => m.id === 'dsh:llm-deepseek');
t('仅 settings 源也带 providerLabel（llm-deepseek）', onlySettings ? onlySettings.providerLabel === 'llm-deepseek' : true,
  JSON.stringify(onlySettings));
const textOnly = models.find((m) => m.hasImage === false && /deepseek/i.test(String(m.id)));
console.log(`  用于下一条测试的纯文本模型：${textOnly?.id}（label=${textOnly?.label}）`);

console.log('\n== ② 报错文案用显示名（纯文本模型 + 图片 prompt）==');
if (!textOnly) {
  console.log('  ⚠ 没找到纯文本 deepseek 模型，跳过');
} else {
  const r = await fetch(BASE + '/run-node', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeType: 'subagent', params: { model: textOnly.id, prompt: '请分析这张图 photo.png', timeoutMs: 8000 } }),
  });
  const body = await r.json().catch(() => ({}));
  const tg = body?.summary?.results?.target;
  const msg = String(tg?.error?.message ?? '');
  console.log(`  HTTP ${r.status} status=${tg?.status} code=${tg?.error?.code}`);
  console.log(`  message: ${msg.slice(0, 200)}`);
  t('错误码为 MODEL_MODALITY_MISMATCH', tg?.error?.code === 'MODEL_MODALITY_MISMATCH', String(tg?.error?.code));
  t('消息里是显示名（' + textOnly.label + '）', msg.includes(String(textOnly.label)), msg.slice(0, 160));
  t('消息里不再出现内部串（llm:<provider>:<model>）', !/llm:[a-z0-9-]+:[a-z0-9.-]+/i.test(msg), msg.slice(0, 160));
}

console.log(`\n=== 真机模型 UI 验证：${pass} passed, ${fail} failed ===`);
if (fail) console.log('失败项：见上');
