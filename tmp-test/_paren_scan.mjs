// tmp-test/_paren_scan.mjs — 定位 _inline.js 中未闭合的括号（剥离字符串/注释后按行统计深度）
import { readFileSync } from 'node:fs';
const s = readFileSync('tmp-test/_inline.js', 'utf8')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  .replace(/\/\/.*$/gm, '');
const ls = s.split('\n');
let d = 0;
const marks = [];
ls.forEach((l, i) => {
  const before = d;
  for (const ch of l) {
    if (ch === '(') d++;
    if (ch === ')') d--;
  }
  if (i > 60 && d !== before) marks.push(`line ${i + 1}: depth ${before} -> ${d}  | ${l.trim().slice(0, 90)}`);
});
console.log('final depth =', d);
for (const m of marks) console.log(m);
