// tmp-test/show-save-doc-refs.mjs — 打印所有仍含 save_doc 的字符串位置（定位漏改点）
import { readFileSync } from 'node:fs';
const FILE = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow\\金融政策日报.json';
const def = JSON.parse(readFileSync(FILE, 'utf8'));
const walk = (v, path) => {
  if (typeof v === 'string') {
    if (v.includes('save_doc')) {
      const idx = v.indexOf('save_doc');
      console.log(`\n[${path}]`);
      console.log('  …' + v.slice(Math.max(0, idx - 160), idx + 120).replace(/\n/g, ' ⏎ ') + '…');
    }
    return;
  }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k);
};
walk(def, '');
