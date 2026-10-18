// src/client/code-text.tsx — 代码级文本编辑框外壳（**CodeMirror 6 版**，2026-10-19 重写）
// ★ 原来的三层实现（行号槽 + 高亮层 <pre> + **透明 textarea** + 自研高亮/滚动同步/光标计算/Tab 缩进）
//   已整体删除：30 万字符时打一个字符 p50 **1103ms**（textarea 自身排版 ≈420ms 是硬成本，动不了）。
//   现在行号、语法高亮、Tab 缩进、括号匹配、搜索、撤销全由 CM6 提供；本文件只负责外壳：
//   高度、右上角放大把手 + 快捷键小问号、底部工具栏条、状态栏「Ln x, Col y · N 字符」。
// ★ 快捷键说明的形态变过一版：先做成头部提示带（占 24px 高），用户随即要求改回右上角小问号
//   （原话：「编辑区提示信息可以改成放到编辑区内右上角的小问号图标，点击查看，放在放大按钮左边」）
//   ⇒ 现在用 `InfoTip` 气泡，位置在放大把手左边，不占编辑区高度。
import { useState } from 'react';
import { createElement } from 'react';
import { CmCode, type CmLang } from './cm-code';
import { InfoTip } from './info-tip';

export type CodeLang = CmLang;

/** 右上角问号的说明正文（只讲多光标 —— 「怎么操作」放这里，「字段什么意思」才进参数行的问号） */
const KEYS_TIP = [
  '多光标（可同时改多处）',
  '· Ctrl + D：选中下一个相同的词（连按几次就选几处）',
  '· Ctrl + Shift + L：一次选中所有相同项（光标停在词上就行）',
  '· Alt + 拖动：拉出一整列光标（列选）',
  '· 单击代码区：回到单光标',
].join('\n');

/**
 * 代码级文本编辑框。受控：value / onChange。
 * · lang：python | bash | json | text（text = 纯文本，不猜语法，适合提示词这类自然语言）
 * · height：编辑区高度（px）
 * · toolbar：插在编辑区底部工具栏条的节点（可选）
 * · status：右下角「Ln x, Col y · N 字符」状态栏
 */
export function CodeText({ value, onChange, lang = 'text', height = 180, placeholder = '', toolbar = null, status = true, spellCheck = false, expand }: {
  value: string;
  onChange: (v: string) => void;
  lang?: CodeLang;
  /** 编辑区高度：像素数，或 `'100%'`（JSON 视图这类"撑满父容器"的场景） */
  height?: number | string;
  placeholder?: string;
  toolbar?: unknown;
  status?: boolean;
  /** 保留签名兼容旧调用（CM6 无 spellcheck 概念，不生效） */
  spellCheck?: boolean;
  /** ★ 2026-10-11 用户要求：「放大按钮在富文本框里面的**右上角**，斜双箭头，点了放大到弹窗、遮盖其他部分」，
   *  并且在弹窗里同一个把手变成「缩小」。传 { expanded, onToggle } 即渲染该把手（位置固定在编辑区右上角）。 */
  expand?: { expanded: boolean; onToggle: () => void; title?: string };
}) {
  void spellCheck;   // 兼容旧签名，CM6 不使用
  // 光标位置：由 CM6 的 updateListener 上报（原来靠透明的 textarea 自己算，已删）
  const [cursor, setCursor] = useState({ ln: 1, col: 1, len: value.length });

  return createElement('div', { className: 'dsh-wf-codetext' },
    createElement('div', { className: 'dsh-wf-code-ed', style: { height } },
      // ★ 文本区（2026-10-13 用户要求：工具条成为编辑区**内部最底部一条带**，独占空间不遮挡输入）
      createElement('div', { className: 'dsh-wf-code-main' },
        createElement(CmCode, {
          key: 'cm6',
          value,
          lang,
          placeholder,
          onChange,
          onCursor: (at: { ln: number; col: number; len: number }) => setCursor(at),
        }),
        // ★ 快捷键说明：**右上角小问号**（在放大把手左边），点击弹气泡，不占编辑区高度
        createElement('div', { className: 'dsh-wf-code-keys' },
          createElement(InfoTip, { text: KEYS_TIP }),
        ),
        // ★ 放大/缩小把手：**文本区**内部右上角（随文本区而不是随工具条）
        expand
          ? createElement('button', {
              className: `dsh-wf-code-expand${expand.expanded ? ' is-expanded' : ''}`,
              title: expand.title ?? (expand.expanded ? '缩小（回到参数面板里）' : '放大编辑（在大窗口里写，盖住其它部分）'),
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); expand.onToggle(); },
            }, createElement('svg', {
              width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
              strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
            },
              // 斜杠方向（/）的双箭头：向外＝放大；向内＝缩小（★ 两版几何必须真的不同 ——
              //   上一版"向内"其实画的是同一个 L 形，用户真机反馈「缩小按钮样式还是放大，没改变」，已修）
              createElement('path', { d: 'M4.6 11.4 11.4 4.6' }),
              expand.expanded
                ? [
                    // 缩小：两支箭头从两端朝中心汇聚（箭头朝内），与放大明显不同
                    createElement('path', { key: 'ne-shaft', d: 'M11.4 4.6 9.0 7.0' }),
                    createElement('path', { key: 'ne-head', d: 'M11.0 7.0H9.0V5.0' }),
                    createElement('path', { key: 'sw-shaft', d: 'M4.6 11.4 7.0 9.0' }),
                    createElement('path', { key: 'sw-head', d: 'M5.0 9.0h2v2' }),
                  ]
                : [
                    // 放大：两端朝外的箭头
                    createElement('path', { key: 'ne', d: 'M8.2 4.6h3.2v3.2' }),
                    createElement('path', { key: 'sw', d: 'M7.8 11.4H4.6V8.2' }),
                  ],
            ))
          : null,
      ),
      // ★ 工具条（复制 / 清空 / 提示）：编辑区内部最底部一条带、内容靠右
      toolbar ? createElement('div', { className: 'dsh-wf-code-toolbar' }, toolbar as never) : null,
    ),
    status ? createElement('div', { className: 'dsh-wf-code-status' }, `Ln ${cursor.ln}, Col ${cursor.col} · ${cursor.len} 字符`) : null,
  );
}
