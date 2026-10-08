// 用工作流里现成的采集器代码实跑 政策/银行 两维，扫描材料里命中模态正则的字符串（不花 LLM 钱）
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const WF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const PY = 'D:/workspace/pluginspace/dag-flow/runtime/python/3.12.14+20260901/win-x64/python.exe';
const def = JSON.parse(readFileSync(WF, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'dagflow-modality-'));

const EXTS = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)\b/gi,
  video: /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)\b/gi,
  file: /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi,
};

for (const id of ['py_policy', 'py_bank', 'py_stock']) {
  const node = def.nodes.find((n) => n.id === id);
  if (!node) { console.log(`${id} 不存在`); continue; }
  const f = join(dir, `${id}.py`);
  writeFileSync(f, node.params.code, 'utf8');
  let out = '';
  try {
    out = execFileSync(PY, [f], { encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const lines = out.split('\n');
  console.log(`\n===== ${id}：输出 ${out.length} 字｜状态行：${lines.find((l) => l.startsWith('MATERIAL_')) ?? lines[0] ?? '(空)'}`);
  for (const [modality, re] of Object.entries(EXTS)) {
    re.lastIndex = 0;
    let m, n = 0;
    while ((m = re.exec(out)) !== null && n < 4) {
      const s = Math.max(0, m.index - 60);
      console.log(`   [${modality}] …${out.slice(s, m.index + m[0].length + 30).replace(/\s+/g, ' ')}…`);
      n++;
    }
    if (n === 0) console.log(`   [${modality}] 无命中`);
  }
}
