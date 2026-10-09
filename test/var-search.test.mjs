// test/var-search.test.mjs — 变量面板「口语化搜索」的纯函数（2026-10-09 用户拍板方案 C）
//   用户原话：「…如果上游比较多的情况下，平铺就显得很乱，有没有好的方案，避免平铺，然后也能根据
//   口语化搜索这些变量，方便快速使用」→ 三方案原型里选了 C（按来源节点分组 + 搜索）。
//   本文件测 varSearch.ts：拼音首字母（Intl collation 反推，零依赖）+ 四路匹配 + 多 token 与匹配。
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

let pass = 0, fail = 0;
const t = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => t(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const root = 'D:/workspace/pluginspace/dag-flow';
const outfile = path.join(root, 'tmp-test', 'var-search.test-bundle.mjs');
await build({
  entryPoints: [path.join(root, 'src/client/util/varSearch.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile, logLevel: 'silent',
});
const { pinyinInitials, varHaystack, varMatch } = await import(pathToFileURL(outfile).href);
fs.rmSync(outfile, { force: true });

console.log('== A. 拼音首字母（Intl collation 反推，无字典无依赖）==');
{
  // ★ 期望值 = 每个字的声母（zh/ch/sh 并入 z/c/s）
  eq(pinyinInitials('取日期'), 'qrq', 'A1. 取日期 → qrq');
  eq(pinyinInitials('分析·政策'), 'fxzc', 'A2. 分析·政策 → fxzc（· 非汉字跳过）');
  eq(pinyinInitials('投资建议'), 'tzjy', 'A3. 投资建议 → tzjy');
  eq(pinyinInitials('央视新闻正文'), 'ysxwzw', 'A4. 央视新闻正文 → ysxwzw');
  eq(pinyinInitials('收件邮箱'), 'sjyx', 'A5. 收件邮箱 → sjyx');
  eq(pinyinInitials('终稿·投资建议报告'), 'zgtzjybg', 'A6. 终稿·投资建议报告 → zgtzjybg');
  eq(pinyinInitials('中文abc混排'), 'zwhp', 'A7. 只取汉字声母（abc 跳过；中=z 文=w 混=h 排=p）');
  eq(pinyinInitials(''), '', 'A8. 空串 → 空');
  eq(pinyinInitials('hello'), '', 'A9. 纯 ASCII → 空');
}
{
  // 缓存路径也要正确（同串第二次调用走 Map 缓存 ✓）
  eq(pinyinInitials('取日期'), 'qrq', 'A10. 第二次调用（走缓存）结果一致');
}

console.log('\n== B. varHaystack：原文小写 + 拼音首字母都在 ==');
{
  const h = varHaystack(['分析·政策', '政策维度分析结论']);
  t(h.includes('分析·政策'.toLowerCase()), 'B1. 含原文（小写）');
  t(h.includes('fxzc'), 'B2. 含节点名拼音 fxzc');
  t(h.includes('zcwd'), 'B3. 含字段说明拼音 zcwd（政策维度…）');
  t(varHaystack([undefined, null, '']).trim() === '', 'B4. 全空 → 空串');
}

console.log('\n== C. varMatch：四路口语化匹配 ==');
{
  const node = ['ai_policy', '分析·政策', 'subagent'];
  t(varMatch('', node), 'C1. 空查询 → 全部命中');
  t(varMatch('   ', node), 'C2. 空白查询 → 全部命中');
  t(varMatch('政策', node), 'C3. ①按节点显示名（政策）');
  t(varMatch('ai_policy', node), 'C4. ②按节点 id');
  t(varMatch('fxzc', node), 'C5. ③按拼音首字母（fxzc）');
  t(!varMatch('汇率', node), 'C6. 不相关词不命中');
}
{
  const field = ['out.conclusion', '一句话结论', '政策底已现…', 'ai_final.out.conclusion'];
  t(varMatch('结论', field), 'C7. ①按字段中文说明（结论）');
  t(varMatch('conclusion', field), 'C8. ②按字段路径');
  t(varMatch('jl', field), 'C9. ③按拼音首字母（jl=结论）');
  // ★ 多 token AND：像路径一样打出来也能命中（用户更可能直接粘 {{a.b.c}}）
  t(varMatch('ai_final.out.conclusion', field), 'C10. ★整条路径（点号切词）能命中');
  t(varMatch('{{ai_final.out.conclusion}}', field), 'C11. ★带 {{}} 也能命中（花括号是分隔符）');
  t(varMatch('ai_final conclusion', field), 'C12. ★空格分词的 AND 匹配');
  t(!varMatch('ai_final out missing', field), 'C13. 有 token 缺失 → 不命中（AND 语义）');
}
{
  const glob = ['{{inputs.收件邮箱}}', '报告发送到的邮箱'];
  t(varMatch('收件邮箱', glob), 'C14. 全局变量按路径中文命中');
  t(varMatch('sjyx', glob), 'C15. 全局变量按拼音命中（sjyx）');
  t(varMatch('邮箱', glob), 'C16. 按说明命中（邮箱）');
}

console.log(`\n=== varSearch 变量口语化搜索：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
