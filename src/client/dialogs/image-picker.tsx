// src/client/dialogs/image-picker.tsx — 🖼 选择图片弹窗（2026-10-16 用户拍板「方案 A」）
// 场景：AI 子代理节点的 `images` 参数——从**统一图片目录** `<DSH_HOME>/.dag-flow/images/` 里勾选多张，
//   不用再一个一个复制文件名（用户原话：「现在一个一个复制名称有点麻烦，有解决办法吗」）。
// 数据源：只读路由 `GET /api/dag-flow/images`（列白名单扩展名，按修改时间倒序）。
// 形态遵循本项目弹窗约定：右上 ✕ 关闭、无底部按钮行；主操作「✓ 写入已选（N）」放在工具条里。
// 关联：src/client/params-editor.tsx（唯一调用方）、src/adapter/routes/meta.ts（路由）、
//   src/adapter/image-inputs.ts（listImageFiles）。
import { createElement, useCallback, useEffect, useState } from 'react';
import { ensurePickerStyles } from '../workflow-picker';

/** 与 host `listImageFiles()` 的返回形状一致（结构化最小接口，不 import 宿主类型） */
interface ImageFileInfo {
  name: string;
  bytes: number;
  mtime: number;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function humanTime(ms: number): string {
  const d = new Date(ms);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ImagePickerDialog({ current, onClose, onConfirm }: {
  /** 当前 images 行里已有的条目（用于预勾选；只按文件名匹配，路径/URL 类条目自然勾不上） */
  current: string[];
  onClose: () => void;
  /** names = 勾选的文件名（按列表顺序）；replace=true 表示调用方先清空原内容再写 */
  onConfirm: (names: string[], replace: boolean) => void;
}) {
  const [images, setImages] = useState<ImageFileInfo[]>([]);
  const [dir, setDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(current));
  const [replace, setReplace] = useState(false);

  useEffect(() => { ensurePickerStyles(); }, []);
  /** 读清单（可重试：用「📁 打开图片目录」放完图后点「↻ 重新读取」，不必关弹窗重开） */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dag-flow/images', { credentials: 'include' });
      if (!res.ok) {
        // ★ 2026-10-16 实测：宿主还是旧版本（没有这条清单路由）时返回 401/空 body，
        //   `res.json()` 会抛 "Unexpected end of JSON input" 这种看不懂的错误 ⇒ 先判 ok，再给可执行的下一步。
        const tip = res.status === 401 || res.status === 404 ? '（图片清单接口还没生效——重启 dsh web 后重试）' : '';
        throw new Error(`HTTP ${res.status}${tip}`);
      }
      const j = (await res.json()) as { dir?: string; images?: ImageFileInfo[] };
      setDir(j.dir ?? '');
      setImages(j.images ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const q = query.trim().toLowerCase();
  const visible = q ? images.filter((i) => i.name.toLowerCase().includes(q)) : images;
  const toggle = useCallback((name: string) => {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);
  /** 用系统文件管理器打开统一图片目录（复用既有路由，sub='images'）——方便往里丢新图 */
  const openFolder = (): void => {
    void fetch('/api/dag-flow/open-folder', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'images' }),
    }).catch(() => { /* 打开失败不影响选图 */ });
  };

  const hint = loading
    ? '正在读取图片目录…'
    : error
      ? `读取失败：${error}`
      : images.length === 0
        ? '统一图片目录里还没有图片——点右边「📁 打开图片目录」把图片放进去，回来后重新打开本弹窗即可。'
        : `目录：${dir}（共 ${images.length} 张，按最近修改排序；点一行即勾选）`;

  return createElement('div', {
    className: 'dag-flow-picker-overlay',
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    createElement('div', { className: 'dag-flow-picker dsh-wf-imgpick' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        `🖼 选择图片（已选 ${picked.size}）`,
        createElement('button', { className: 'dag-flow-picker-close', title: '关闭', onClick: onClose }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body dsh-wf-imgpick-body' },
        createElement('div', { className: 'dsh-wf-imgpick-bar' },
          // ★ 2026-10-17 用户要求：「重新读取是不是放到输入框里面，点击重新加载一下就行」
          //   ⇒ 刷新做成**搜索框内右侧的图标按钮**（与参数行框内把手 .dsh-wf-params-grow 同规格 22×22），
          //     不再占工具条里的一颗文字按钮；工具条只留同规格的文字按钮，大小自然一致。
          createElement('div', { className: 'dsh-wf-imgpick-searchwrap' },
            createElement('input', {
              className: 'dsh-wf-input dsh-wf-imgpick-search', value: query, placeholder: '按文件名搜索…',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
            }),
            createElement('button', {
              className: 'dsh-wf-imgpick-reload', title: '重新读取图片目录（刚往目录里放图时用）', onClick: () => void load(),
            }, '↻'),
          ),
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-imgpick-openfolder', title: '用系统文件管理器打开统一图片目录', onClick: openFolder,
          }, '📁 打开图片目录'),
          createElement('button', {
            className: 'dsh-wf-btn', title: '把当前列表里的图片全部勾上',
            onClick: () => setPicked(new Set(visible.map((i) => i.name))),
          }, '全选'),
          createElement('button', { className: 'dsh-wf-btn', title: '取消所有勾选', onClick: () => setPicked(new Set()) }, '清空勾选'),
          createElement('label', { className: 'dsh-wf-imgpick-replace', title: '勾上后写入时会先清空该行原有内容' },
            createElement('input', {
              type: 'checkbox', checked: replace,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setReplace(e.target.checked),
            }),
            '覆盖原有内容'),
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-btn-primary', disabled: picked.size === 0, title: '把勾选的图片按「每行一个」写进 images',
            onClick: () => onConfirm(images.filter((i) => picked.has(i.name)).map((i) => i.name), replace),
          }, `✓ 写入已选（${picked.size}）`),
        ),
        // 说明区只放文字（其淡化只作用于文字，不再波及按钮）
        createElement('div', { className: 'dsh-wf-panel-hint dsh-wf-imgpick-hint' }, hint),
        visible.length === 0
          ? null
          : createElement('div', { className: 'dsh-wf-imgpick-list' },
              ...visible.map((i) => createElement('div', {
                key: i.name,
                className: `dsh-wf-imgpick-row${picked.has(i.name) ? ' is-on' : ''}`,
                title: i.name,
                onClick: () => toggle(i.name),
              },
                createElement('span', { className: 'dsh-wf-imgpick-check' }, picked.has(i.name) ? '✓' : ''),
                createElement('span', { className: 'dsh-wf-imgpick-name' }, i.name),
                createElement('span', { className: 'dsh-wf-imgpick-meta' }, `${humanSize(i.bytes)} · ${humanTime(i.mtime)}`),
              ))),
      ),
    ),
  );
}
