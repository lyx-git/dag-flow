// 复核 政策/银行 两维材料里命中的文件名字样（这次带上 UTF-8 环境，避免输出被编码打断）
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const WF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const PY = 'D:/workspace/pluginspace/dag-flow/runtime/python/3.12.14+20260901/win-x64/python.exe';
const def = JSON.parse(readFileSync(WF, 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'dagflow-modality2-'));
const re = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi;

for (const id of ['py_policy', 'py_bank']) {
  const node = def.nodes.find((n) => n.id === id);
  const f = join(dir, `${id}.py`);
  writeFileSync(f, node.params.code, 'utf8');
  let out = '';
  try {
    out = execFileSync(PY, [f], {
      encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
  } catch (e) { out = String(e.stdout ?? ''); }
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(out)) !== null && hits.length < 5) {
    hits.push(`…${out.slice(Math.max(0, m.index - 55), m.index + m[0].length + 20).replace(/\s+/g, ' ')}…`);
  }
  console.log(`\n${id}：输出 ${out.length} 字，命中 ${hits.length} 处`);
  for (const h of hits) console.log('   ' + h);
}
