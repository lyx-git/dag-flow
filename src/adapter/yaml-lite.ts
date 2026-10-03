// src/adapter/yaml-lite.ts — 极简 YAML 解析（仅够解析 ~/.dsh/settings.yaml 和 .credentials.yaml）
//
// 为什么不用 js-yaml：R3 零依赖约束，npm 包体积最小化。
// 支持：缩进嵌套对象、数组（- item / - key: value 对象项）、字符串/数字/布尔/null、
//       key: value、引号字符串（单/双）、# 注释。
// 不支持：锚点/别名、复杂 flow 语法、多文档、块状字符串（| 与 >）。够用即可。

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

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
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
          // - key: （下一行是子字段）→ 当前 obj 入栈
          arr.push(obj);
          stack.push({ indent, container: obj, isArray: false, parentContainer: arr as unknown as Record<string, unknown>, parentKey: undefined });
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
      if (rawVal === '' || rawVal === '|' || rawVal === '>') {
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
