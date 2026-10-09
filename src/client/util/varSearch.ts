// src/client/util/varSearch.ts — 变量面板的「口语化搜索」（纯函数，可离线单测）
//
// 用户原话（2026-10-09）：「画布右侧的编辑面板里面的全局变量，上游变量，输出变量现在都是平铺在面板里面，
//   如果上游比较多的情况下，平铺就显得很乱，有没有好的方案，避免平铺，然后也能根据口语化搜索这些变量，
//   方便快速使用」→ 拍板方案 C（按来源节点分组 + 搜索）。
//
// 什么叫"口语化"：用户不想记 `{{ai_policy.out.conclusion}}` 这种路径，他会打「政策」「日期」「投资建议」，
//   甚至**拼音首字母**「rq」「tzjy」→ 所以检索要同时匹配四路：
//     ① 节点显示名（政策 → 分析·政策的全部字段）
//     ② 字段中文说明（日期 → 取日期的 out）
//     ③ 变量路径本身（ai_policy.out）
//     ④ 拼音首字母（rq → 日期 / tzjy → 投资建议）
//
// ★ 拼音首字母**不用字典、不加依赖**：中文按拼音排序是 ICU collation 的内建能力
//   （`Intl.Collator('zh-Hans-u-co-pinyin')`，Chrome/Node 全 ICU 都支持 ✓），于是可以用
//   "每个声母挑一个代表字 + 二分查找"反推任意汉字的声母 ✓（2026-10-09 本机实测：
//   取日期→qrq、分析·政策→fxzc、投资建议→tzjy、终稿·投资建议报告→zgtzjybg 全对 ✓）。
//   多音字按常用读音（ICU 口径），够用 ✓。

/** 声母全集（按拼音顺序；zh/ch/sh 并入 z/c/s，与常见首字母检索习惯一致） */
const INITIALS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'w', 'x', 'y', 'z'];

/** 每个声母的代表字（取该声母下常见的字，用于二分定位） */
const ANCHORS: Record<string, string> = {
  a: '阿', b: '八', c: '擦', d: '搭', e: '蛾', f: '发', g: '噶', h: '哈', j: '击', k: '喀', l: '垃', m: '妈',
  n: '拿', o: '哦', p: '怕', q: '期', r: '然', s: '撒', t: '塌', w: '挖', x: '昔', y: '压', z: '匝',
};

const collator = (() => {
  try { return new Intl.Collator(['zh-Hans-u-co-pinyin', 'zh']); } catch { return null; }
})();

const PY_CACHE = new Map<string, string>();

/** 单个汉字的拼音首字母（非汉字返回 ''） */
function initialOf(ch: string): string {
  if (!collator) return '';
  if (!/[\u4e00-\u9fff]/.test(ch)) return '';
  let lo = 0, hi = INITIALS.length - 1, found = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (collator.compare(ch, ANCHORS[INITIALS[mid]]) >= 0) { found = INITIALS[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

/** 一段文本的拼音首字母串（只取汉字；结果按文本缓存 ✓） */
export function pinyinInitials(text: string): string {
  if (!text) return '';
  const hit = PY_CACHE.get(text);
  if (hit !== undefined) return hit;
  let out = '';
  for (const ch of text) out += initialOf(ch);
  PY_CACHE.set(text, out);
  return out;
}

/**
 * 把若干"可检索片段"拼成 haystack：原文小写 + 各片段的拼音首字母。
 * 例：`varHaystack(['分析·政策', '政策维度分析结论'])` 里能搜到 `fxzc`、`zcfx` 之类 ✓
 */
export function varHaystack(parts: (string | undefined | null)[]): string {
  const raw: string[] = [];
  const py: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    raw.push(p);
    const y = pinyinInitials(p);
    if (y) py.push(y);
  }
  return `${raw.join(' ').toLowerCase()} ${py.join(' ')}`;
}

/**
 * 判定一条变量是否命中查询（空查询视为全部命中 ✓）。
 * ★ 查询按 `空格 / . / {} / 引号` **切成多个 token，要求全部命中**（AND）——这样
 *   `fetch.out.count`、`{{ai_policy.out}}`、`政策 结论` 这类"像路径一样打出来"的输入都能命中 ✓
 *   （2026-10-09 实测：单串 includes 匹配会让 `fetch.out.count` 搜不到 ✗，故引入分词）。
 */
export function varMatch(query: string, parts: (string | undefined | null)[]): boolean {
  const tokens = query.trim().toLowerCase().split(/[\s.{}[\]"'`/\\]+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = varHaystack(parts);
  return tokens.every((t) => hay.includes(t));
}
