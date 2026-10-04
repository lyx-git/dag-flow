// tmp-test/patch-cdp-confirm.mjs — 一次性：给"点了 ▶ 就等结果"的 CDP 用例补上「越过自检确认」这一步
//   （2026-10-04 轮 2 行为变更：点运行 → 先自检「自检中」→ 通过后人工确认 → 才真跑）
// 用法：node tmp-test/patch-cdp-confirm.mjs [--apply]
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
/** 每个文件：要匹配的"点运行"片段 → 补上 confirmSelfcheck 之后的新片段 */
const JOBS = [
  ['tmp-test/cdp/test-run-button.mjs', [
    ["const btn = document.querySelector('.dsh-wf-btn-success');\n    btn.click();",
      "const btn = document.querySelector('.dsh-wf-btn-success');\n    btn.click();\n    await confirmSelfcheck(cdp);   // ★ 点运行 → 先自检，通过后要人工确认"],
    ["btn.click(); // 再跑一次，确认可重复运行且结果刷新",
      "btn.click(); // 再跑一次，确认可重复运行且结果刷新\n    await confirmSelfcheck(cdp);   // ★ 同上：越过自检确认闸门"],
  ]],
  ['tmp-test/cdp/test-manual-confirm.mjs', [
    ["await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);",
      "await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);\n  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认"],
  ]],
  ['tmp-test/cdp/test-loop-visible.mjs', [
    ["await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);",
      "await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); })(); true;`);\n  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认"],
  ]],
  ['tmp-test/cdp/test-var-refs.mjs', [
    ["await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);",
      "await evaluate(cdp, `(() => { document.querySelector('.dsh-wf-btn-success').click(); return true; })()`);\n  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认"],
  ]],
  ['tmp-test/cdp/test-node-result-tip.mjs', [
    ["await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);",
      "await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);\n  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认"],
  ]],
  ['tmp-test/cdp/test-live-status.mjs', [
    ["await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);",
      "await evaluate(cdp, `document.querySelector('.dsh-wf-btn-success').click(); true;`);\n  await confirmSelfcheck(cdp);   // ★ 越过运行前自检的人工确认"],
  ]],
];

let changed = 0;
for (const [file, pairs] of JOBS) {
  let src = readFileSync(file, 'utf8');
  const before = src;
  for (const [from, to] of pairs) {
    if (!src.includes(from)) { console.log(`  跳过（未匹配）: ${file} ← ${JSON.stringify(from.slice(0, 50))}`); continue; }
    if (src.includes(to)) { console.log(`  已有: ${file}`); continue; }
    src = src.split(from).join(to);
  }
  // 补 import
  if (src !== before && !/confirmSelfcheck/.test(before)) {
    src = src.replace(/import \{([^}]*)\} from '\.\/driver\.mjs';/, (m, inner) => `import {${inner.trim().replace(/,$/, '')}, confirmSelfcheck } from './driver.mjs';`);
  }
  if (src !== before) {
    changed++;
    console.log(`${APPLY ? '改写' : '待改写'}: ${file}`);
    if (APPLY) writeFileSync(file, src);
  } else {
    console.log(`无需改动: ${file}`);
  }
}
console.log(`\n共 ${changed} 个文件${APPLY ? ' 已改写' : ' 需要改写（加 --apply 生效）'}`);
