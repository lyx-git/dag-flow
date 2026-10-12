// src/client/var-picker.tsx
// 变量引用列表（2026-10-11 抽出）：口语化搜索 + 上游按来源节点分组默认收起 + 点击 chip 回调。
// ★ 2026-10-11（用户拍板「删掉画布右侧编辑画板里面的变量引用」之后）：**这是变量唯一的出现处**——
//   它现在只服务「🧪 参数与试跑」弹窗右侧的变量抽屉：点 chip 触发 `onPick`，由 ParamsEditor 把
//   `{{引用}}` 插入到「最近聚焦的那个值框」的光标处（不是复制语义）。原来那个 `.dsh-wf-var-dlg` 独立
//   变量弹窗与 `.dsh-wf-copy-toast` 复制浮窗已随之删除。
// ★ 检索沿用 util/varSearch 的四路匹配（节点显示名 / 字段中文说明 / 变量路径 / 拼音首字母）。
import { useState } from 'react';
import { createElement } from 'react';
import { varMatch } from './util/varSearch';

export type VarChip = { text: string; desc: string; isOut?: boolean };
export type VarPickGroup = {
  key: string;
  /** 分组标题（如「AI 子代理 · ai_final · 6 个字段（字段取自上次运行的真实输出）」） */
  title: string;
  chips: VarChip[];
  /** 分组下方的说明（实测字段 / 字段说明 / 本节点输出是什么） */
  legend?: string;
  /** true = 可点击标题收起（上游节点组）；false/缺省 = 常显 */
  collapsible?: boolean;
  /** 分组标题右侧的小注（如「点击插入」） */
  note?: string;
};

export function VarPicker({ groups, onPick, actionHint, placeholder, emptyHint }: {
  groups: VarPickGroup[];
  onPick: (chip: VarChip) => void;
  /** 顶部一行说明（如「点变量插入到当前值框的光标处」） */
  actionHint?: string;
  placeholder?: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim();

  const chipMatches = (c: VarChip): boolean => varMatch(q, [c.text, c.desc]);
  /** 组内命中：不搜=全给；搜=按 chip 过滤（标题也参与命中判断） */
  const visibleGroups = groups.map((g) => {
    const titleHit = varMatch(q, [g.title]);
    const chips = !q ? g.chips : (titleHit ? g.chips : g.chips.filter(chipMatches));
    return { g, chips, show: !q || titleHit || chips.length > 0 };
  }).filter((v) => v.show);
  const hitCount = visibleGroups.reduce((n, v) => n + v.chips.length, 0);

  return createElement('div', { className: 'dsh-wf-varpick' },
    createElement('input', {
      className: 'dsh-wf-var-search',
      value: query,
      placeholder: placeholder ?? '口语化搜：政策 · 日期 · rq · tzjy · ai_policy.out …',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    }),
    createElement('div', { className: 'dsh-wf-panel-hint' },
      q
        ? (hitCount > 0 ? `命中 ${hitCount} 项（已自动展开；清空搜索回到分组收起）` : (emptyHint ?? '没有匹配的变量——换个词试试（支持拼音首字母，如 rq=日期）'))
        : (actionHint ?? '点变量即填入当前值框的光标处')),
    visibleGroups.length === 0
      ? null
      : createElement('div', { className: 'dsh-wf-var-groups' },
          ...visibleGroups.map(({ g, chips }) => {
            const isOpen = q ? true : (g.collapsible ? open[g.key] === true : true);
            const toggle = g.collapsible
              ? () => setOpen((m) => ({ ...m, [g.key]: !(m[g.key] === true) }))
              : undefined;
            return createElement('div', { key: g.key, className: 'dsh-wf-var-group' },
              createElement('div', {
                className: `dsh-wf-var-node${g.collapsible ? ' is-toggle' : ''}${isOpen ? '' : ' is-closed'}`,
                title: g.collapsible ? (isOpen ? '点击收起该节点字段' : '点击展开该节点字段') : undefined,
                onClick: toggle,
              }, `${g.collapsible ? (isOpen ? '▾' : '▸') + ' ' : ''}${g.title}${g.note ? ` · ${g.note}` : ''}`),
              isOpen
                ? createElement('div', { className: 'dsh-wf-var-list' },
                    ...chips.map((c) => createElement('span', {
                      key: c.text,
                      className: `dsh-wf-var-chip${c.isOut ? ' is-out' : ''}`,
                      title: `点击填入：${c.text}\n作用：${c.desc}`,
                      onClick: () => onPick(c),
                    }, c.text)),
                  )
                : null,
              isOpen && g.legend ? createElement('div', { className: 'dsh-wf-var-legend' }, g.legend) : null,
            );
          }),
        ),
  );
}
