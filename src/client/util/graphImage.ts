// src/client/util/graphImage.ts — 「导出图片」：把工作流画成一张自包含的 SVG，再光栅化成 PNG。
//
// 需求（用户原话）：「导出 json 已经有导出按钮了，导出图片可以集成到一起」。
//
// 为什么自己画 SVG 而不是截图 DOM：
//   ① **R3 零依赖**——官方 `@flowgram.ai/free-export-plugin` 未安装（npm 上也查不到），
//      而 html2canvas 这类库要新增依赖 ✗；
//   ② 画布是 DOM+SVG 混合，DOM→图片需要逐元素内联计算样式（脆弱 ✗），而本项目的样式来自
//      运行时注入的 <style> + CSS 变量，foreignObject 方案会丢样式；
//   ③ 自己画**矢量**更清晰、体积更小、可离线单测（buildGraphSvg 是纯函数 ✓），
//      且不掺画布 UI 杂物（工具栏/缩略图/选中态都不进图）。
//
// 分工：`buildGraphSvg` 是**纯函数**（离线单测）；`svgToPngBlob` 只在浏览器里用（img + canvas）。
import type { ClientNode } from '../types';

export interface GraphImageNode {
  id: string;
  type: string;
  label?: string;
  x: number;
  y: number;
}

export interface GraphImageEdge {
  from: string;
  to: string;
  when?: string;
}

export interface GraphImageMeta {
  label?: string;
  emoji?: string;
  color?: string;
}

export interface BuildGraphSvgOptions {
  /** 图标题（工作流名） */
  title: string;
  nodes: GraphImageNode[];
  edges: GraphImageEdge[];
  /** 由节点 type 查显示名/图标/类型色（客户端传 NODE_PALETTE 的 findMeta） */
  metaOf: (type: string) => GraphImageMeta | undefined;
  /** 右上角小字（默认导出时间） */
  subtitle?: string;
}

const NODE_W = 210;
const NODE_H = 78;
const PAD = 48;
const TITLE_H = 76;
const BG = '#0b1120';
const PANEL = '#101a2b';
const TEXT = '#e6edf7';
const MUTED = '#8b9bb3';
const BORDER = '#22304a';

/** XML 文本转义（工作流名/标签里可能有 & < > " '） */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 长文本按「估算宽度」截断（SVG 没有自动省略号，宁可截断也不要溢出卡片） */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 分支键 → 标签色（与画布连线标签同色系：true 绿 / false 红 / 其它蓝） */
function whenColor(when: string): string {
  if (when === 'true') return '#10b981';
  if (when === 'false') return '#f43f5e';
  if (when === '*') return '#fbbf24';
  return '#4f8cff';
}

/**
 * 把工作流画成 SVG 字符串（纯函数，可离线单测）。
 * 坐标用画布的 RF 坐标（可能为负）→ 统一平移到 (PAD, PAD + TITLE_H)。
 */
export function buildGraphSvg(opts: BuildGraphSvgOptions): string {
  const { title, nodes, edges, metaOf } = opts;
  const subtitle = opts.subtitle ?? new Date().toLocaleString('zh-CN', { hour12: false });

  // 边界（空图给一个最小尺寸，避免 0 宽高）
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = nodes.length ? Math.min(...xs) : 0;
  const minY = nodes.length ? Math.min(...ys) : 0;
  const maxX = nodes.length ? Math.max(...xs) + NODE_W : NODE_W;
  const maxY = nodes.length ? Math.max(...ys) + NODE_H : NODE_H;
  const width = Math.max(360, Math.round(maxX - minX + PAD * 2));
  const height = Math.max(200, Math.round(maxY - minY + PAD * 2 + TITLE_H));
  const ox = PAD - minX;
  const oy = PAD + TITLE_H - minY;

  const box = new Map<string, { cx: number; cy: number }>();
  for (const n of nodes) box.set(n.id, { cx: n.x + ox + NODE_W / 2, cy: n.y + oy + NODE_H / 2 });

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${BG}"/>`,
    // 标题
    `<text x="${PAD}" y="40" fill="${TEXT}" font-size="20" font-weight="600">${esc(clip(title || '工作流', 60))}</text>`,
    `<text x="${PAD}" y="62" fill="${MUTED}" font-size="12">${esc(`${nodes.length} 个节点 · ${edges.length} 条连线 · ${subtitle}`)}</text>`,
    `<line x1="0" y1="${TITLE_H}" x2="${width}" y2="${TITLE_H}" stroke="${BORDER}" stroke-width="1"/>`,
  );

  // 连线（先画，节点盖在上面）
  for (const e of edges) {
    const a = box.get(e.from);
    const b = box.get(e.to);
    if (!a || !b) continue;
    const x1 = a.cx + NODE_W / 2;
    const y1 = a.cy;
    const x2 = b.cx - NODE_W / 2;
    const y2 = b.cy;
    const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
    const color = e.when ? whenColor(e.when) : '#4a5f80';
    parts.push(
      `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="1.6" opacity="0.85"/>`,
      // 箭头（指向目标左侧）
      `<path d="M ${x2} ${y2} l -9 -4.5 l 0 9 z" fill="${color}" opacity="0.9"/>`,
    );
    if (e.when) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const w = Math.max(24, e.when.length * 7 + 12);
      parts.push(
        `<rect x="${mx - w / 2}" y="${my - 9}" width="${w}" height="18" rx="9" fill="${BG}" stroke="${color}" stroke-width="1" opacity="0.95"/>`,
        `<text x="${mx}" y="${my + 4}" fill="${color}" font-size="11" text-anchor="middle">${esc(clip(e.when, 12))}</text>`,
      );
    }
  }

  // 节点卡（与画布同语言：类型色描边 + 图标方块 + 显示名 + id/类型）
  for (const n of nodes) {
    const meta = metaOf(n.type) ?? {};
    const color = meta.color ?? '#64748b';
    const x = n.x + ox;
    const y = n.y + oy;
    const name = n.label || meta.label || n.type;
    parts.push(
      `<g>`,
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="12" fill="${PANEL}" stroke="${color}" stroke-width="1.5"/>`,
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="12" fill="${color}" opacity="0.10"/>`,
      // 图标方块
      `<rect x="${x + 12}" y="${y + 14}" width="28" height="28" rx="8" fill="${color}" opacity="0.9"/>`,
      `<text x="${x + 26}" y="${y + 34}" font-size="15" text-anchor="middle">${esc(meta.emoji ?? '⚙️')}</text>`,
      // 显示名
      `<text x="${x + 50}" y="${y + 32}" fill="${TEXT}" font-size="14" font-weight="600">${esc(clip(name, 14))}</text>`,
      // id + 类型
      `<text x="${x + 50}" y="${y + 50}" fill="${MUTED}" font-size="11">${esc(clip(n.id, 20))}</text>`,
      `<text x="${x + 12}" y="${y + 68}" fill="${MUTED}" font-size="10">${esc(meta.label ?? n.type)}</text>`,
      `</g>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** 从 ClientNode + RF 位置整理成 buildGraphSvg 的入参（纯函数） */
export function graphInputOf(
  nodes: ClientNode[],
  layout: Record<string, { x: number; y: number }>,
  fallback: { x: number; y: number }[],
  edges: GraphImageEdge[],
): { nodes: GraphImageNode[]; edges: GraphImageEdge[] } {
  const out: GraphImageNode[] = nodes.map((n, i) => {
    const p = layout[n.id] ?? fallback[i] ?? { x: i * 240, y: 0 };
    return { id: n.id, type: n.type, ...(n.label ? { label: String(n.label) } : {}), x: p.x, y: p.y };
  });
  return { nodes: out, edges };
}

/** SVG 字符串 → PNG Blob（浏览器：img + canvas；含显式宽高所以 img 能拿到尺寸） */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 渲染失败'));
      img.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('SVG 尺寸为空');
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) throw new Error('PNG 生成失败');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
