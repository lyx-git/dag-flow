// src/adapter/yaml-lite.ts — 极简 YAML 解析（仅够解析 ~/.dsh/settings.yaml 和 .credentials.yaml）
//
// 为什么不用 js-yaml：R3 零依赖约束，npm 包体积最小化。
// 支持：缩进嵌套对象、数组（- item / - key: value 对象项）、字符串/数字/布尔/null、
//       key: value、引号字符串（单/双）、# 注释、**块状字符串（`|` 字面 / `>` 折叠）**。
// 不支持：锚点/别名、复杂 flow 语法、多文档。够用即可。

export function parse(yaml: string): unknown {
  const lines = yaml.split(/\r?\n/);
  // ★ 2026-10-01 顶层数组支持：dsh 0.2.0 把配置段落迁入 profile 的 cordis.patch.yml
  //   （顶层数组：- id: ... / name: ... / config: ...），文档首行有效行以 "- " 开头 → root 为数组。
  const firstMeaningful = lines.find((l) => l.trim() && !l.trim().startsWith('#'));
  const rootIsArray = !!firstMeaningful && firstMeaningful.trim().startsWith('- ');
  const root: Record<string, unknown> = rootIsArray ? [] as unknown as Record<string, unknown> : {};
  // 栈：每层 { indent, container, isArray, lastKey, parentContainer, parentKey }
  // parentContainer/parentKey：供「key: 打开的子层级遇到 - 数组项」时做对象→数组的惰性转换
  type Frame = {
    indent: number;
    container: Record<string, unknown> | unknown[];
    isArray: boolean;
    lastKey?: string;
    parentContainer?: Record<string, unknown>;
    parentKey?: string;
  };
  const stack: Frame[] = [{ indent: -1, container: root, isArray: rootIsArray }];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    const trimmed = line.trim();

    // —— 数组项：- item 或 - key: value ——
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim();
      const colonIdx = findColon(rest);
      // 确保数组容器：parent 已是数组 → 用之；parent 是 "key:" 打开的子层级 → 惰性转数组；否则丢弃
      let arr: unknown[];
      if (parent.isArray) {
        arr = parent.container as unknown[];
      } else if (parent.lastKey) {
        arr = [];
        (parent.container as Record<string, unknown>)[parent.lastKey] = arr;
        parent.container = arr;
        parent.isArray = true;
      } else if (parent.parentContainer && parent.parentKey) {
        // 「key:」子层级首行即数组项 → 该子层级实为数组：把父容器中的空对象替换为数组
        arr = [];
        (parent.parentContainer as Record<string, unknown>)[parent.parentKey] = arr;
        parent.container = arr;
        parent.isArray = true;
      } else {
        continue;
      }
      const obj: Record<string, unknown> = {};
      if (colonIdx >= 0) {
        const key = rest.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
        const rawVal = rest.slice(colonIdx + 1).trim();
        if (rawVal === '') {
          // - key: （下一行是更深缩进的子字段/子数组）→ 建立 key 这一层，并把该层入栈
          //
          // ★ 2026-10-11 修复第三个同族 bug：原实现只 `arr.push(obj)` 就把 **obj 本身**入栈，
          //   从未建立 `obj[key]`。于是官方 patch 的标准形状
          //     - insert:
          //         - id: x
          //   解析出来 insert 层完全不存在（实测 dsh-base 的 529 行 patch 里 94 行嵌套 - id 全丢）。
          //   现在 `obj[key] = child` 并把 child 入栈，且带上 parentContainer/parentKey —— 下一行
          //   若是更深缩进的 `- `，就走上面那条既有的「对象→数组」惰性转换，把 obj[key] 换成数组。
          const child: Record<string, unknown> = {};
          obj[key] = child;
          arr.push(obj);
          stack.push({ indent, container: child, isArray: false, parentContainer: obj, parentKey: key });
        } else {
          obj[key] = parseScalar(rawVal);
          arr.push(obj);
          // ★ 2026-09-26 修复：数组项对象也要入栈——否则其后更深缩进的子字段
          //   （如 models 项的 name:/contextWindow:/input: 及 input 下的嵌套列表）
          //   会因 parent.isArray 被整体丢弃（- key: value 只保留 key 一个字段）。
          //   入栈后：同缩进的下一个 `- ` 行会 pop 回数组 Frame 推新项；更深缩进的
          //   key: value 写入当前项；key: 的嵌套列表走既有惰性对象→数组转换。
          stack.push({ indent, container: obj, isArray: false });
        }
        (parent as { lastKey?: string }).lastKey = key;
      } else {
        arr.push(parseScalar(rest));
      }
      continue;
    }

    // —— key: value 或 key: ——
    const colonIdx = findColon(trimmed);
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (!parent.isArray && parent.container) {
      const obj = parent.container as Record<string, unknown>;
      // 块状字符串的**头部规格**：`|` / `>` 后面还能跟缩进指示数字与 chomping 指示符（`|-` / `>-` / `|2-`，顺序可互换）。
      // ★ 实测本机 dsh 自带 patch 里真实用到三种：`section: |`（4 处）、`description: |-`（4 处）、`personaPrefix: >-`（4+1 处）
      //   —— 只认裸 `|`/`>` 的话，`|-` / `>-` 会被当成普通标量、原样存成字符串 "|-"，同样是**静默给错值**。
      const blockSpec = /^([|>])(\d?)([+-]?)$/.exec(rawVal) ?? /^([|>])([+-]?)(\d?)$/.exec(rawVal);
      if (blockSpec) {
        const style = blockSpec[1];
        const opt = blockSpec.slice(2) as string[];
        const indentDigit = opt.find((x) => /^\d$/.test(x)) ?? '';
        const chomp = opt.find((x) => x === '-' || x === '+') ?? '';
        // ★ 2026-10-11 新增（用户要求修 ①）：块状字符串（literal `|` / folded `>`）。
        //   旧实现把它当"进入子层级"→ 正文行没有冒号被整段丢弃，`key` 变成一个空对象 {}：
        //   **静默给错值**（实测 dsh-base 与三个 preset patch 共 4 处 `config.section` 命中，
        //   section 本来是长提示词，被解析成 {}）。
        //   规则（够用即止，不做 YAML 全套）：正文缩进以**第一条非空行**为准（给了数字指示符就按 key 缩进 + N）；
        //   缩进回到 key 同级或更浅即块结束；`|` 保留换行、`>` 折叠成空格（空行 = 段落分隔）；
        //   尾部空行去掉；chomping：默认 clip 补一个换行、`-` strip 不补、`+` 同 clip（无实际用例）。
        const collected: Array<string | null> = [];   // null = 空行
        let blockIndent = indentDigit ? indent + Number(indentDigit) : -1;
        let bi = li + 1;
        for (; bi < lines.length; bi++) {
          const bl = lines[bi].replace(/\t/g, '  ');
          const bt = bl.trim();
          const bind = bl.length - bl.trimStart().length;
          if (bt === '') { collected.push(null); continue; }
          if (blockIndent < 0) {
            if (bind <= indent) break;      // `key: |` 后面直接是同级内容 → 空块
            blockIndent = bind;
          }
          if (bind < blockIndent) break;    // 回到父层级 → 块结束
          collected.push(bl.slice(blockIndent));
        }
        while (collected.length && collected[collected.length - 1] === null) collected.pop();
        const block = style === '|'
          ? collected.map((c) => c ?? '').join('\n')
          : foldBlock(collected);
        obj[key] = collected.length ? block + (chomp === '-' ? '' : '\n') : '';
        li = bi - 1;                        // 主循环接着处理块后面的那一行
        (parent as { lastKey?: string }).lastKey = key;
      } else if (rawVal === '') {
        // 进入子层级（暂建对象；若下一行是 - 数组项，上面会惰性转数组）
        const child: Record<string, unknown> = {};
        obj[key] = child;
        stack.push({ indent, container: child, isArray: false, parentContainer: obj, parentKey: key });
      } else {
        obj[key] = parseScalar(rawVal);
        (parent as { lastKey?: string }).lastKey = key;
      }
    }
  }
  return rootIsArray ? (root as unknown as unknown[]) : root;
}

/** 折叠块（`>`）：相邻非空行用空格连成一行；空行保留为换行（段落分隔）。 */
function foldBlock(collected: Array<string | null>): string {
  let out = '';
  let prevBlank = true;   // 块首不补空格
  for (const c of collected) {
    if (c === null) { out += '\n'; prevBlank = true; continue; }
    out += (prevBlank ? '' : ' ') + c.trim();
    prevBlank = false;
  }
  return out;
}

function findColon(s: string): number {
  // 跳过引号内的冒号
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ':' && (i + 1 >= s.length || s[i + 1] === ' ' || s[i + 1] === '\t')) return i;
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  // 引号字符串
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\n/g, '\n');
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  // 数字
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  // 内联数组/对象（简化为字符串，settings.yaml 里少见关键字段用 flow 语法）
  return s;
}
