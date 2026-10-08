// 找出 ai_policy / ai_bank 提示词里到底什么字符串命中了模态检测（读宿主运行日志，不花钱）
const BASE = 'http://127.0.0.1:3080';
const EXTS = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)\b/gi,
  video: /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)\b/gi,
  file: /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi,
};

const res = await fetch(`${BASE}/api/dag-flow/run/log?name=${encodeURIComponent('金融政策日报')}`);
const data = await res.json();
const entries = data.entries ?? [];
const sample = entries.find((e) => e.id === 'ai_policy') ?? entries[5];
console.log(`样例 ${sample?.id}：params 类型=${Array.isArray(sample?.params) ? 'array' : typeof sample?.params}，rawParams 类型=${Array.isArray(sample?.rawParams) ? 'array' : typeof sample?.rawParams}`);
if (sample) console.log('params 键：', Object.keys(sample.params ?? {}).slice(0, 12).join(', '), '｜rawParams 键：', Object.keys(sample.rawParams ?? {}).slice(0, 12).join(', '));

const pickPrompt = (e) => {
  for (const bag of [e.params, e.rawParams]) {
    if (bag && typeof bag.prompt === 'string') return bag.prompt;
  }
  return '';
};

for (const e of entries) {
  if (!/^ai_/.test(e.id)) continue;
  const prompt = pickPrompt(e);
  if (!prompt) { console.log(`${e.id}: 取不到 prompt（params 形状 ${JSON.stringify(e.params).slice(0, 80)}）`); continue; }
  const hits = [];
  for (const [modality, re] of Object.entries(EXTS)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(prompt)) !== null) {
      const s = Math.max(0, m.index - 50);
      hits.push(`${modality}: …${prompt.slice(s, m.index + m[0].length + 30).replace(/\s+/g, ' ')}…`);
      if (hits.length > 5) break;
    }
  }
  console.log(`\n=== ${e.id}（${e.status}，提示词 ${prompt.length} 字）命中 ${hits.length} 处`);
  for (const h of hits.slice(0, 5)) console.log('   ' + h);
}
