// src/adapter/cron.ts — 分钟级 cron 解析与「下次触发时间」（纯函数模块：宿主 + 浏览器端共用）
//
// 需求来源：docs/SCHEDULE-PLAN.md §1「兼容 cron 表达式」——自研解析器，支持标准 5 字段
//   （分 时 日 月 周）与语法 `*` `,` `-` `/`；不支持 `L` `W` `#` `?` 与秒级 6 字段（一律给中文报错）。
//   §8 明确：只按**本机时区**（不做多时区）；解析失败给中文错误 + 列清支持范围。
//
// ★ R3 零依赖红线：不引第三方 cron 库，不碰 node:fs / node:child_process 等 Node API；
//   本文件只用标准 JS/TS 语法与 Date，因此能被 client bundle 复用（弹窗里实时预览 + 红字提示）。
//
// 语义口径（与 POSIX / 主流 JS cron 库一致，测试锁死见 test/cron.test.mjs）：
//   · 字段顺序：分 时 日 月 周；多于/少于 5 个 → 报错（消息写明当前字段数）。
//   · 取值范围：分 0-59、时 0-23、日 1-31、月 1-12、周 0-6（**7 也表示周日**，解析时归一化为 0）。
//   · 语法：`*`、单值 `5`、范围 `1-5`、步长 `*/15`、范围步长 `1-5/2`、逗号列表 `1,3,5`
//     （列表元素可为单值/范围/带步长）；步长必须 ≥1 的整数（`*/0` 报错）；范围起点 > 终点报错。
//   · parseCron 返回的数组**去重并升序**。
//   · 「日」与「周」**都被限定**（都不是 `*`）→ 取 **OR**（满足其一即可）；只有其中一个被限定时按 AND。
//   · nextRunAt 严格晚于 from（from 正好落在触发点 → 返回**下一个**）；按天推进（最多 4 年），
//     天内按「小时 × 分钟」升序拼 Date 取第一个命中——不逐分钟暴力扫。
//
// 错误消息：一律中文（项目约定 message 中文；本模块 API 只回消息字符串，不引入 code 字段）。
// 行为锁定：test/cron.test.mjs（离线：node test/cron.test.mjs）

/** 解析结果：5 个字段各自的取值列表（均去重升序；周日的 7 已归一化为 0） */
export type CronSpec = {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
};

/** 字段定义：min/max 是**可解析**范围（「周」允许写 7，解析后归一化为 0） */
type FieldDef = {
  key: keyof CronSpec;
  /** 中文名，用于报错定位（分/时/日/月/周） */
  name: string;
  min: number;
  max: number;
  /** 报错时展示的合法范围文案 */
  rangeText: string;
  /** 归一化（仅「周」用：7 → 0） */
  normalize?: (v: number) => number;
};

const FIELDS: FieldDef[] = [
  { key: 'minutes', name: '分', min: 0, max: 59, rangeText: '0-59' },
  { key: 'hours', name: '时', min: 0, max: 23, rangeText: '0-23' },
  { key: 'days', name: '日', min: 1, max: 31, rangeText: '1-31' },
  { key: 'months', name: '月', min: 1, max: 12, rangeText: '1-12' },
  { key: 'weekdays', name: '周', min: 0, max: 7, rangeText: '0-6（7 也表示周日）', normalize: (v) => (v === 7 ? 0 : v) },
];

/** 支持范围文案（报错里反复用到，保证口径统一） */
const SUPPORT_HINT = '本解析器只支持 5 字段分钟级（分 时 日 月 周）与语法 * , - /';
/** 搜索上限：最多向前找 4 年（闰年 2 月 29 之类也够用） */
const MAX_YEARS = 4;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 闰年判定（纯算术，避免跨时区构造 Date） */
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 某年某月的天数（1-12 月） */
function daysInMonth(y: number, month: number): number {
  return month === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[month - 1];
}

/** 取值越界检查：越界即报错（消息里带字段名、原文与合法范围） */
function checkRange(v: number, field: FieldDef, raw: string): number {
  if (!Number.isInteger(v) || v < field.min || v > field.max) {
    throw new Error(`cron「${field.name}」字段取值 ${v} 越界（原文「${raw}」）——合法范围 ${field.rangeText}`);
  }
  return v;
}

/** 展开列表里的一个元素（单值 / 范围 / 步长 / 范围步长 / 星号），结果并入 out */
function expandItem(item: string, field: FieldDef, raw: string, out: number[]): void {
  const slashIdx = item.indexOf('/');
  let base = item;
  let step = 1;
  if (slashIdx >= 0) {
    base = item.slice(0, slashIdx);
    const stepRaw = item.slice(slashIdx + 1);
    if (!/^\d+$/.test(stepRaw) || Number(stepRaw) < 1) {
      throw new Error(`cron 步长必须是不小于 1 的整数（「${field.name}」字段「${raw}」里的「${stepRaw}」）`);
    }
    step = Number(stepRaw);
  }

  let start: number;
  let end: number;
  if (base === '*') {
    // 星号 = 整个合法范围（「周」的 0-7 会由 normalize 把 7 归到 0，随后去重）
    start = field.min;
    end = field.max;
  } else if (/^\d+$/.test(base)) {
    start = checkRange(Number(base), field, raw);
    // 「5/15」按主流库口径 = 从 5 起每 15 直到上界；不带步长就是单值本身
    end = slashIdx >= 0 ? field.max : start;
  } else {
    const m = /^(\d+)-(\d+)$/.exec(base);
    if (!m) {
      throw new Error(
        `cron「${field.name}」字段「${raw}」格式非法——只支持 *、单值（5）、范围（1-5）、步长（*/15）、范围步长（1-5/2）与逗号列表（1,3,5）`,
      );
    }
    start = checkRange(Number(m[1]), field, raw);
    end = checkRange(Number(m[2]), field, raw);
    if (start > end) {
      throw new Error(`cron 范围起点不能大于终点（「${field.name}」字段「${raw}」里的「${base}」）`);
    }
  }

  for (let v = start; v <= end; v += step) out.push(field.normalize ? field.normalize(v) : v);
}

/** 内部完整解析：除 CronSpec 外，额外回传「日/周是否字面 `*`」——nextRunAt 的 OR 语义要用 */
function parseFull(expr: string): { spec: CronSpec; domStar: boolean; dowStar: boolean } {
  if (typeof expr !== 'string') throw new Error('cron 表达式必须是字符串');
  const text = expr.trim();
  if (!text) throw new Error(`cron 表达式为空——应为 5 个字段（分 时 日 月 周），如「0 9 * * 1-5」`);

  const parts = text.split(/\s+/);
  if (parts.length !== 5) {
    const extra =
      parts.length > 5
        ? `——不支持秒级（6 字段）等写法，${SUPPORT_HINT}`
        : '——字段不足，应为「分 时 日 月 周」5 个';
    throw new Error(`cron 表达式应为 5 个字段（分 时 日 月 周），当前 ${parts.length} 个${extra}：${text}`);
  }

  const lists: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const raw = parts[i];
    const field = FIELDS[i];
    if (!raw) throw new Error(`cron「${field.name}」字段为空（第 ${i + 1} 个字段）——字段不能留白`);
    const vals: number[] = [];
    for (const item of raw.split(',')) {
      if (item === '') {
        throw new Error(`cron「${field.name}」字段「${raw}」里存在空项——逗号列表不能有连续逗号或首尾逗号`);
      }
      const bad = /[^0-9*\-/]/.exec(item);
      if (bad) {
        throw new Error(
          `不支持 cron 方言「${bad[0]}」（「${field.name}」字段「${raw}」）——${SUPPORT_HINT}，不支持 L、W、#、? 与月份/星期英文名`,
        );
      }
      expandItem(item, field, raw, vals);
    }
    // 去重 + 升序（`1,1,3` → [1,3]；`0-7` 在「周」上会把 7 折叠成 0）
    lists.push([...new Set(vals)].sort((a, b) => a - b));
  }

  const spec: CronSpec = {
    minutes: lists[0],
    hours: lists[1],
    days: lists[2],
    months: lists[3],
    weekdays: lists[4],
  };
  // OR 语义只认**字面 `*`**（POSIX 口径）：`0-6` 之类算「被限定」
  return { spec, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

/** 解析 5 字段 cron（分 时 日 月 周）；非法时 throw new Error('中文原因') */
export function parseCron(expr: string): CronSpec {
  return parseFull(expr).spec;
}

/** 不抛异常的合法性判断（UI 用；输入非字符串也算非法） */
export function isValidCron(expr: string): boolean {
  try {
    parseFull(expr);
    return true;
  } catch {
    return false;
  }
}

/** 非法时返回中文原因，合法返回 null（UI 红字用） */
export function cronError(expr: string): string | null {
  try {
    parseFull(expr);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg || 'cron 表达式非法';
  }
}

/**
 * 下一次触发时间（本机时区）；from 缺省 = now；**严格晚于** from；非法表达式 throw。
 * 实现：从 from 之后的第一分钟起，外层按天推进（最多 4 年），天内按 spec 的小时 × 分钟升序取第一个命中。
 */
export function nextRunAt(expr: string, from?: Date): Date {
  const { spec, domStar, dowStar } = parseFull(expr);
  const fromMs = from === undefined ? Date.now() : from.getTime();
  if (!Number.isFinite(fromMs)) throw new Error('nextRunAt 的起始时间非法——from 不是有效日期');

  // 下取整到分钟再 +1 分钟：既保证「严格晚于 from」，也让 from 正好落在触发点时取下一个
  let cursor = new Date(Math.floor(fromMs / 60_000) * 60_000 + 60_000);
  const limitMs = new Date(cursor.getFullYear() + MAX_YEARS, cursor.getMonth(), cursor.getDate()).getTime();

  while (cursor.getTime() < limitMs) {
    const y = cursor.getFullYear();
    const mo = cursor.getMonth() + 1;
    const d = cursor.getDate();

    // 整月跳过：月份不匹配，或「日」最小取值都超过本月天数（如 31 在小月 / 2 月在平年）
    if (!spec.months.includes(mo) || spec.days[0] > daysInMonth(y, mo)) {
      cursor = new Date(y, mo, 1); // mo 是 1-based 月号，直接当 0-based 索引即「下月 1 日」
      continue;
    }

    const domMatch = spec.days.includes(d);
    const dowMatch = spec.weekdays.includes(cursor.getDay());
    // 日/周都限定 → OR；只限定其一 → 对该字段做 AND（另一个视为不限）
    const dayOk = domStar && dowStar
      ? true
      : !domStar && !dowStar
        ? domMatch || dowMatch
        : domStar
          ? dowMatch
          : domMatch;

    if (dayOk) {
      for (const h of spec.hours) {
        for (const mi of spec.minutes) {
          const t = new Date(y, mo - 1, d, h, mi, 0, 0);
          if (t.getTime() <= fromMs) continue;
          // 夏令时把不存在的本地时刻平移后可能落到别的日子——落到别天就跳过（本机时区无 DST 时恒等）
          if (t.getFullYear() === y && t.getMonth() + 1 === mo && t.getDate() === d) return t;
        }
      }
    }

    cursor = new Date(y, mo - 1, d + 1); // 跨月/跨年由 Date 自行进位
  }

  throw new Error(
    `未来 ${MAX_YEARS} 年内没有匹配的触发时间（cron：${expr}）——请检查日/月/周字段是否永远无法同时成立`,
  );
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 「周」字段的人类可读描述（工作日 / 周末 / 每周一 / 每周一、周三 / 每天） */
function weekdayDesc(weekdays: number[]): string {
  if (weekdays.length === 7) return '每天';
  if (weekdays.length === 5 && weekdays.every((w, i) => w === i + 1)) return '工作日';
  if (weekdays.length === 2 && weekdays[0] === 0 && weekdays[1] === 6) return '周末';
  return '每' + weekdays.map((w) => WEEKDAY_NAMES[w]).join('、');
}

// 等差步长识别：仅当形如「0, N, 2N, … 一直到 59 的完整序列」才认（星号斜杠步长认，`1,3,5` 不认）
// ★ 用行注释而非块注释：正文里要写「星号 + 斜杠」的示例，块注释会被 `*/` 提前闭合。
function uniformStepMinutes(minutes: number[]): number | null {
  if (minutes.length < 2) return null;
  const step = minutes[1] - minutes[0];
  if (step < 1) return null;
  for (let i = 2; i < minutes.length; i++) if (minutes[i] - minutes[i - 1] !== step) return null;
  if (minutes[0] !== 0) return null;
  if (minutes[minutes.length - 1] + step <= 59) return null;
  return step;
}

/** 人类可读中文预览，如「工作日 09:00」「每 30 分钟」「每天 09:00」「每月 1 日 09:00」「每周一 08:30」 */
export function describeCron(expr: string): string {
  const { spec, domStar, dowStar } = parseFull(expr);
  const monthStar = spec.months.length === 12;
  const hourAll = spec.hours.length === 24;

  // —— 时分描述 ——
  let timeDesc: string;
  if (hourAll) {
    if (spec.minutes.length === 1) {
      timeDesc = spec.minutes[0] === 0 ? '每小时整点' : `每小时 ${pad2(spec.minutes[0])} 分`;
    } else {
      const step = uniformStepMinutes(spec.minutes);
      timeDesc = step !== null
        ? (step === 1 ? '每分钟' : `每 ${step} 分钟`)
        : `每小时的 ${spec.minutes.map(pad2).join('、')} 分`;
    }
  } else {
    const times: string[] = [];
    for (const h of spec.hours) for (const mi of spec.minutes) times.push(`${pad2(h)}:${pad2(mi)}`);
    timeDesc = times.length <= 4 ? times.join('、') : `${times.slice(0, 4).join('、')}…（共 ${times.length} 个时间点）`;
  }

  // —— 日期描述 ——
  const dayParts: string[] = [];
  if (!monthStar && !domStar) {
    dayParts.push(`每年 ${spec.months.join('、')} 月 ${spec.days.join('、')} 日`);
  } else if (!monthStar) {
    dayParts.push(`每年 ${spec.months.join('、')} 月每天`);
  } else if (!domStar) {
    dayParts.push(`每月 ${spec.days.join('、')} 日`);
  }
  if (!dowStar) dayParts.push(weekdayDesc(spec.weekdays));
  const dayDesc = dayParts.length === 0 ? '每天' : dayParts.join(' 或 ');

  // 「每天 + 每 N 分钟」这类说法本身已含频次，不再重复「每天」
  if (dayDesc === '每天' && timeDesc.startsWith('每')) return timeDesc;
  return `${dayDesc} ${timeDesc}`;
}
