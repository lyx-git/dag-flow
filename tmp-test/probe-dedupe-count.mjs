// tmp-test/probe-dedupe-count.mjs — 用真机 /models 数据推算「按 provider:model 去重」后的条数
// 用法：node tmp-test/probe-dedupe-count.mjs
const base = process.env.DF_BASE ?? 'http://127.0.0.1:3080/api/dag-flow';
const j = await (await fetch(base + '/models')).json();
const models = j.models ?? [];
const key = (name) => String(name).replace(/^llm:/, '');
const seen = new Set();
const kept = [];
const dropped = [];
for (const m of models) {
  const k = key(m.name ?? m.id);
  if (seen.has(k)) { dropped.push(m.id); continue; }
  seen.add(k);
  kept.push(m.id);
}
const byModelOnly = new Set(models.map((m) => m.model ?? m.id));
console.log(`真机 /models 当前 ${models.length} 条`);
console.log(`按 provider:model 去重后 ${kept.length} 条（去掉 ${dropped.length} 条 settings 直读重复项）`);
console.log(`  —— 被去掉的前 5 条：${dropped.slice(0, 5).join(' , ') || '(无)'}`);
console.log(`若按「model 单独去重」则只剩 ${byModelOnly.size} 条（会误删 custom-model-vision 等不同路由的能力，故未采用）`);
console.log(`保留项里的不同 provider 数：${new Set(kept.map((id) => key(id).split(':')[0])).size}`);
