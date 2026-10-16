// src/client/flowgram/node-palette.tsx — 左侧节点面板（FlowGram 拖拽服务）
// 分类分组 + 口语化搜索 + 最小化 + 八向几何调节（localStorage 记忆）；
// 拖拽 = 按下后位移超阈值才 startDragCard（仅拖拽添加语义，原位单击不建节点），shim 事件修拖影定位。
// 2026-10-14 重构轮 5 自 FlowGramCanvas.tsx 纯搬运拆出。

import { createElement, useRef, useState } from 'react';
import {
  useClientContext,
  useService,
  WorkflowDocument,
  WorkflowDragService,
} from '@flowgram.ai/free-layout-editor';
import { NODE_PALETTE } from '../types';
import { startResize8, readStoredJSON, saveJSON, clampNum, type PaletteGeom } from '../util/edge-drag';
// ★ 新建节点身份（id + label）的唯一生成器：合法 id 由它保证，调用方不要再自己拼字符串
import { flowgramNodeIdentity } from '../util/flowDef';

const CATEGORY_ORDER = ['control', 'script', 'io', 'ai', 'media', 'data', 'misc'];
const CATEGORY_LABELS: Record<string, string> = {
  control: '控制流', script: '脚本', io: 'IO', ai: 'AI', media: '多模态', data: '数据', misc: '杂项',
};

export function NodePalette() {
  const dragService = useService(WorkflowDragService);
  const document = useService(WorkflowDocument);
  const ctx = useClientContext();
  const [query, setQuery] = useState('');
  const [min, setMin] = useState(false); // ★ 最小化：收成竖条，点展开
  // ★ 面板几何可拖八向调节（2026-10-01 夜用户需求：四周边缘线和角），localStorage 记忆；
  //   h=null 表示高度拉伸态（top/bottom 双锚），拖过 n/s 边后转为定高
  const [geom, setGeom] = useState<PaletteGeom>(() => readStoredJSON<PaletteGeom>(
    'dag-flow:palette-geom',
    { x: 12, y: 12, w: 200, h: null },
    (raw) => ({
      x: clampNum(raw?.x, 12, 0, 2000),
      y: clampNum(raw?.y, 12, 0, 2000),
      w: clampNum(raw?.w, 200, 160, 420),
      h: typeof raw?.h === 'number' ? clampNum(raw.h, 400, 220, 1400) : null,
    }),
  ));
  const paletteRef = useRef<HTMLElement | null>(null);
  const startResize = (dir: string) => (e: any) => {
    const el = paletteRef.current;
    const measured = el ? el.getBoundingClientRect().height : 600;
    startResize8(
      // ★ 原生 mousedown 事件（运行时一直是 DOM MouseEvent；edge-drag 只用 clientX/Y/preventDefault，
      //   声明层写的是 React 合成事件类型——@ts-nocheck 时代掩盖，strict 下以 any 过桥，行为不变）
      e as any, dir,
      { x: geom.x, y: geom.y, w: geom.w, h: geom.h ?? measured },
      { minW: 160, maxW: 420, minH: 220, maxH: 1400 },
      (g) => setGeom({ x: g.x, y: g.y, w: g.w, h: g.h }),
      (g) => {
        const out: PaletteGeom = { x: g.x, y: g.y, w: g.w, h: g.h };
        setGeom(out);
        saveJSON('dag-flow:palette-geom', out);
      },
    );
  };

  // ★ 仅拖拽添加（2026-10-02 用户需求）：startDragCard 是「松手即落卡」语义——按下即接管的话
  //   原位单击松开也会创建节点。改为按下后先记起点，位移超过阈值才真正起拖；原位单击松开
  //   = 清理监听、无副作用。监听挂 window capture（FlowGram document capture 会吞合成事件，
  //   见 lesson 0mupqrlf）。
  // ★ 拖影修复：startDragCard 的 onDragStart 克隆 event.currentTarget 当拖影并用它的
  //   getBoundingClientRect 定位——原生 move 事件的 currentTarget 是 window（拿不到元素、
  //   定位崩），必须构造以面板项为 currentTarget 的 shim 事件、坐标用原 mousedown 坐标
  //   （dragger.start 起点），拖影从面板项原位出发、delta 跟手，与官方按下即拖行为一致。
  const DRAG_THRESHOLD = 4; // px
  const onItemMouseDown = (e: any, type: string) => {
    if (e.button !== 0) return;
    const meta = NODE_PALETTE.find((m) => m.type === type);
    if (!meta) return;
    e.preventDefault(); // 防文本选择
    const itemEl = e.currentTarget as HTMLElement;
    const downX: number = e.clientX;
    const downY: number = e.clientY;
    let started = false;
    const startCard = () => {
      const shim = new MouseEvent('mousedown', {
        clientX: downX, clientY: downY, bubbles: false, cancelable: true, view: window,
      });
      // startDragCard 内部读 event.currentTarget 克隆拖影并定位——shim 钉死为面板项元素
      Object.defineProperty(shim, 'currentTarget', { value: itemEl });
      // ★ 2026-10-15 修 bug：**新建节点必须显式给 id**。FlowGram 的 `createWorkflowNodeByType`
      //   只在 `json.id === undefined` 时用 `` `1${nanoid()}` `` 兜底 ⇒ id **必然数字开头**，
      //   撞 WORKFLOW_SCHEMA 的 `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`（types.ts + client JsonView 两份）
      //   ⇒ 存盘后引擎解析（executor/parse.ts）直接拦下：**点运行与定时执行全部失败**。
      //   真机实证：用户日报 06:00 定时因新建节点 id `153823` 报「工作流结构校验未通过」。
      //   ★ 2026-10-16 规范整改：id/label 只由 flowgramNodeIdentity 一处产出（两条建节点路径
      //   曾各拼一份，其中一条漏给 id = 本轮事故的结构性根因），合法性由生成器内部保证。
      const identity = flowgramNodeIdentity(type, meta.label);
      try {
        // ★ shim 是**原生** MouseEvent（React 类型声明要合成事件——nocheck 时代掩盖）；
        //   startDragCard 内部只读 clientX/Y + currentTarget（拖影克隆/定位），行为一直如此
        void dragService.startDragCard(type, shim as any, {
          id: identity.id,
          data: {
            label: identity.label,
            ...(meta.defaultParams ?? {}),
          },
        });
      } catch (err) {
        console.warn('[dag-flow] startDragCard failed:', err);
      }
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    const onMove = (ev: MouseEvent): void => {
      if (started) return;
      if (Math.abs(ev.clientX - downX) < DRAG_THRESHOLD && Math.abs(ev.clientY - downY) < DRAG_THRESHOLD) return;
      started = true;
      cleanup();
      startCard();
    };
    const onUp = (): void => { cleanup(); };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    void document; void ctx;
  };

  const groups = CATEGORY_ORDER
    .map((cat) => ({
      cat,
      items: NODE_PALETTE.filter((m) => m.category === cat && m.label.toLowerCase().includes(query.toLowerCase())),
    }))
    .filter((g) => g.items.length > 0);

  if (min) {
    return createElement('aside', { className: 'dsh-wf-fg-palette min' },
      createElement('button', {
        key: 'expand',
        className: 'dsh-wf-fg-palette-min-btn',
        title: '展开节点面板',
        onClick: () => setMin(false),
      }, '»'),
      createElement('div', { className: 'dsh-wf-fg-palette-min-label' }, '节点面板'),
    );
  }
  return createElement(
    'aside',
    {
      className: 'dsh-wf-fg-palette',
      ref: paletteRef,
      style: {
        left: geom.x, top: geom.y, width: geom.w,
        ...(geom.h != null ? { height: geom.h, bottom: 'auto' } : {}),
      } as any,
    },
    // 八向拖拽把手（四边+四角）：e/s 直接改尺寸，w/n 额外移动面板位置
    ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
      createElement('div', {
        key: dir,
        className: `dsh-wf-fg-palette-resize ${dir}`,
        title: '拖动调整面板大小',
        onMouseDown: startResize(dir),
      })),
    createElement('div', { className: 'dsh-wf-fg-palette-head' },
      createElement('input', {
        className: 'dsh-wf-fg-palette-search',
        placeholder: '搜索节点…',
        value: query,
        onChange: (e: any) => setQuery(e.target.value),
        onMouseDown: (e: any) => e.stopPropagation(),
      }),
      createElement('button', {
        className: 'dsh-wf-fg-palette-min',
        title: '最小化节点面板',
        onClick: () => setMin(true),
      }, '«'),
    ),
    createElement('div', { className: 'dsh-wf-fg-palette-list' },
      groups.map((g) => createElement('div', { key: g.cat },
        createElement('div', { className: 'dsh-wf-fg-palette-cat' }, CATEGORY_LABELS[g.cat] ?? g.cat),
        g.items.map((m) => createElement('div', {
          key: m.type,
          className: 'dsh-wf-fg-palette-item',
          style: { ['--kind' as string]: m.color },
          onMouseDown: (e: any) => void onItemMouseDown(e, m.type),
          title: `拖拽「${m.label}」到画布`,
        },
          createElement('span', { className: 'dsh-wf-fg-palette-emoji', style: { background: m.color } }, m.emoji),
          createElement('span', { className: 'dsh-wf-fg-palette-label' }, m.label),
        )),
      )),
    ),
  );
}
