// src/client/inspector-fields.tsx — 右侧检查器的按节点类型专属字段表单
// SessionInputFields（会话选择）/ MediaFields（image_generate / video_generate / file_save）/ WebFields（web_search / doc_parse / web_fetch）。
// 只接收 node + onParamsChange 两个 props；必填红星复用 panel-utils 的 reqMark。
// 2026-10-14 重构轮 6 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useEffect, useState } from 'react';
import { reqMark } from './panel-utils';
import { InfoTip } from './info-tip';
import { SelectBox } from './select-box';

export function SessionInputFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const [sessions, setSessions] = useState<{ id: string; name: string; mtime?: string }[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(() => (node.params?.sessionId as string) ?? '');
  const [limit, setLimit] = useState<string>(() => String((node.params?.limit as number) ?? 10));

  useEffect(() => {
    if (sessionsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/sessions', { credentials: 'include' });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        const data = await res.json();
        if (!cancelled) {
          setSessions(data.sessions ?? []);
          setSessionsLoaded(true);
        }
      } catch (e) {
        console.warn('[dag-flow] load sessions failed:', (e as Error).message);
        if (!cancelled) setSessionsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionsLoaded]);

  const handleId = (val: string) => {
    setSelectedId(val);
    onParamsChange({ sessionId: val, limit: Number(limit) || 10 });
  };
  const handleLimit = (val: string) => {
    setLimit(val);
    onParamsChange({ sessionId: selectedId, limit: Number(val) || 10 });
  };

  // 会话下拉显示「MM-DD HH:mm · 标题」（2026-10-02 用户需求：全是 session id 分不清）；
  // 标题由 host 提取（首条 user 消息摘要），id 仍是 value（执行时按 id 读会话）。
  const fmtSessionTime = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return createElement('div', null,
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '选择会话'),
      createElement(SelectBox, {
        value: selectedId,
        onChange: handleId,
        placeholder: sessionsLoaded ? '（选择一个会话，按最近活动排序）' : '（加载会话列表...）',
        options: [
          { value: '', label: sessionsLoaded ? '（选择一个会话，按最近活动排序）' : '（加载会话列表...）' },
          ...sessions.map((s) => {
            const when = fmtSessionTime(s.mtime);
            return { value: s.id, label: when ? `${when} · ${s.name}` : s.name };
          }),
        ],
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '取最近对话条数',
        createElement(InfoTip, { text: '运行时会读取所选会话最近的对话内容作为本节点输出，可连给后续 AI/其他节点使用。' })),
      createElement('input', {
        className: 'dsh-wf-input',
        type: 'number',
        min: 1,
        max: 500,
        value: limit,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleLimit(e.target.value),
      }),
    ),
  );
}

// 多模态节点（image_generate / video_generate / file_save）的专属配置表单
export function MediaFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const p = node.params ?? {};
  // label 以「!」开头 = 必填行：名称前渲染红星标识（纯视觉，2026-10-02 用户需求）
  // ★ 2026-10-16（用户：「解释的信息统一放到合适的地方用个小问号，单击显示解释内容，现在平铺解释信息很乱」）：
  //   `hint` 不再平铺在行下方，而是变成**标签右侧的小问号**（单击展开解释）。
  const row = (label: string, el: any, hint?: string) =>
    createElement('div', { className: 'dsh-wf-panel-row', key: label },
      createElement('label', { className: 'dsh-wf-panel-label' },
        label.startsWith('!') ? reqMark() : null, label.replace(/^!/, ''),
        hint ? createElement(InfoTip, { text: hint }) : null), el,
    );
  const text = (key: string, placeholder: string, type = 'text') =>
    createElement('input', {
      className: 'dsh-wf-input', type, placeholder,
      defaultValue: typeof p[key] === 'string' ? (p[key] as string) : '',
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => onParamsChange({ [key]: e.target.value }),
    });

  // ★ 2026-10-19（用户拍板 A：「图片/视频生成的参数既在右面板又在参数与试跑弹窗里，感觉多余，只想保留弹窗那份」）：
  //   这两个节点的**参数统一收进「🧪 参数与试跑」弹窗**（那边每个参数都有中文名 + 问号释义，见 param-meta.ts）。
  //   ★ 同日用户补一句「右侧面板参数删除掉之后，就不用留下备注信息了，没必要」⇒ 面板这边**一句说明都不留**。
  //   ★★ 同日再拍板 B：「图片生成节点里面的提前测试，是不是利用参数与试跑弹窗里面的试跑本节点也能完成，
  //   是否可以直接删掉提前测试按钮」→ 直接删掉 ⇒ 这两个节点的面板**整块不渲染**（视频节点本来也是空的）。
  //   「验证 API / Key / 模型」改由弹窗底部的「▶ 试跑本节点」完成（它真跑一遍节点，顺带验通路 + 落盘输出）。
  //   宿主路由 `POST /api/dag-flow/test-image-api` **保留**（纯后台能力，离线测试 modality.test.mjs C 段仍覆盖它，
  //   与 `skipSelfcheck` 的"只作 API 保留"同一口径），只是不再有 UI 入口。
  if (node.type === 'image_generate' || node.type === 'video_generate') return null;
  // file_save
  return createElement('div', null,
    row('内容来源', createElement(SelectBox, {
      value: typeof p.source === 'string' ? p.source : 'text',
      onChange: (v: string) => onParamsChange({ source: v }),
      options: [
        { value: 'text', label: '文本内容（text）' },
        { value: 'base64', label: 'Base64（base64）' },
        { value: 'url', label: 'URL 下载（url）' },
      ],
    })),
    p.source === 'url'
      ? row('!文件 URL', text('url', 'https://…（可引用 {{u.out.url}}）'))
      : row('文件内容', createElement('textarea', {
          className: 'dsh-wf-input', rows: 4,
          // ★ source → p.source（2026-10-02 用户反馈：点击 file_save 节点整个画布白屏——
          //   此前误写成裸 source，ReferenceError 把整棵 React 树打卸载）
          placeholder: p.source === 'base64' ? 'Base64 内容…' : '文本内容…（可引用 {{u.out.xxx}}）',
          defaultValue: typeof p.content === 'string' ? p.content : '',
          onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ content: e.target.value }),
        })),
    row('!保存文件名', text('filename', 'output.txt'), '可含子目录（如 reports/周报.md）；直接保存到 <DSH_HOME>/.dag-flow/ 目录下'),
  );
}

// 搜索/抓取节点（web_search / web_fetch）的专属配置表单
export function WebFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const p = node.params ?? {};
  // label 以「!」开头 = 必填行：名称前渲染红星标识（纯视觉，2026-10-02 用户需求）
  // ★ 2026-10-16（用户：「解释的信息统一放到合适的地方用个小问号，单击显示解释内容，现在平铺解释信息很乱」）：
  //   `hint` 不再平铺在行下方，而是变成**标签右侧的小问号**（单击展开解释）。
  const row = (label: string, el: any, hint?: string) =>
    createElement('div', { className: 'dsh-wf-panel-row', key: label },
      createElement('label', { className: 'dsh-wf-panel-label' },
        label.startsWith('!') ? reqMark() : null, label.replace(/^!/, ''),
        hint ? createElement(InfoTip, { text: hint }) : null), el,
    );
  const text = (key: string, placeholder: string, type = 'text') =>
    createElement('input', {
      className: 'dsh-wf-input', type, placeholder,
      defaultValue: typeof p[key] === 'string' ? (p[key] as string) : '',
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => onParamsChange({ [key]: e.target.value }),
    });

  if (node.type === 'web_search') {
    return createElement('div', null,
      row('!搜索词 (query)', createElement('textarea', {
        className: 'dsh-wf-input', rows: 3, placeholder: '要搜索的内容…（可引用 {{u.out.xxx}}）',
        defaultValue: typeof p.query === 'string' ? p.query : '',
        onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ query: e.target.value }),
      }), '内置 5 个免 key 引擎，任何 DSH 零配置可用；auto 按「Bing → AnySearch → DuckDuckGo → DuckDuckGo Lite → SearXNG」的顺序依次尝试、谁先出结果用谁（前两个在国内网络下最稳，2026-10-19 按真机实测重排）。搜索只走内置引擎，不依赖任何外部搜索插件。query 留空时节点不执行、流程在此中断。'),
      row('搜索引擎', createElement(SelectBox, {
        value: typeof p.provider === 'string' ? p.provider : 'auto',
        onChange: (v: string) => onParamsChange({ provider: v }),
        // ★ 2026-10-18（用户：「把长解释挪到列表项下面那行小字说明里」）：名称留 label、解释进 sub ——
        //   闭合态只显示引擎名（不再被省略号截断），点开列表时解释作为灰色小字跟在名称下面，信息一字不丢。
        // ★ 2026-10-19 用户要求「依赖 dsh-free-search 插件的内容都删掉」：原来的「仅宿主」选项已移除；
        //   老节点如果存着 provider='host'，用「当前值」兜底项如实显示（否则下拉会空白），并告诉他改哪里。
        options: [
          { value: 'auto', label: 'auto', sub: '内置引擎链，按顺序自动回落（推荐）' },
          { value: 'bing', label: 'Bing', sub: '免 key' },
          { value: 'ddg-lite', label: 'DuckDuckGo Lite', sub: '免 key' },
          { value: 'ddg', label: 'DuckDuckGo HTML', sub: '免 key' },
          { value: 'searxng', label: 'SearXNG', sub: '公共实例，免 key' },
          { value: 'anysearch', label: 'AnySearch', sub: '免费匿名额度' },
          ...(p.provider === 'host'
            ? [{ value: 'host', label: '（当前值：仅宿主，已移除）', sub: '运行会失败——请改成 auto 或任一内置引擎' }]
            : []),
        ],
      })),
      row('结果条数', text('count', '8', 'number'), '1-20 条'),
      row('时间范围', createElement(SelectBox, {
        value: typeof p.timeRange === 'string' ? p.timeRange : '',
        onChange: (v: string) => onParamsChange({ timeRange: v || undefined }),
        options: [
          { value: '', label: '不限' },
          { value: 'day', label: '一天内' },
          { value: 'week', label: '一周内' },
          { value: 'month', label: '一月内' },
          { value: 'year', label: '一年内' },
        ],
      })),
    );
  }
  if (node.type === 'doc_parse') {
    // ★ 2026-10-18 用户要求：「文件解析节点的文件路径和 url 合并成一个输入框，输入框分为两段，前面选类型，
    //   后面填路径」⇒ 一个 row 内：前段 select 选类型（本地路径 / 下载地址）、后段 input 填值。
    //   切换类型时清掉另一侧（传 null ＝ 删键），避免"两个都填"的歧义（执行层 url 优先，会打架）。
    // ★ 2026-10-19 修 bug（用户报「文件来源的下拉选无法切换」）：以前判类型用 `String(p.url ?? '').trim()`，
    //   而切到「下载地址」时写的正是 **`url: ''`（空串）** ⇒ trim 后为空 ⇒ 判据立刻回退成 path，
    //   下拉一选就弹回「本地路径」（表现就是"切不过去"）。
    //   ⇒ 改成**看键在不在**（null ＝ 删键，见 onParamsChange 的 null 语义）：有 url 键就是 url 模式，哪怕值还空。
    const srcKind = Object.prototype.hasOwnProperty.call(p, 'url') && p.url !== null ? 'url' : 'path';
    return createElement('div', null,
      row('!文件来源', createElement('div', { className: 'dsh-wf-srcrow' },
        createElement(SelectBox, {
          className: 'dsh-wf-srcrow-kind',
          title: '选择这一行填的是本地文件路径，还是下载地址',
          value: srcKind,
          onChange: (next: string) => onParamsChange(next === 'url' ? { url: '', path: null } : { path: '', url: null }),
          options: [
            { value: 'path', label: '本地路径' },
            { value: 'url', label: '下载地址' },
          ],
        }),
        createElement('input', {
          className: 'dsh-wf-input dsh-wf-srcrow-val',
          value: srcKind === 'url' ? String(p.url ?? '') : String(p.path ?? ''),
          // ★ 2026-10-18：两段式后输入框只剩一百多像素宽，旧 placeholder（两种路径示例 + 引用示例）
          //   会被截成「documents/公告.pdf 或」这种半句话 ⇒ 这里只留一个能完整显示的示例，
          //   绝对路径 / {{}} 引用 / 相对路径锚定都搬进问号气泡。
          placeholder: srcKind === 'url' ? 'https://…/公告.pdf' : 'documents/公告.pdf',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange(
            srcKind === 'url' ? { url: e.target.value } : { path: e.target.value }),
        }),
      ), '左侧「本地路径」＝读磁盘文件：相对路径锚定 <DSH_HOME>/.dag-flow/（例：documents/公告.pdf），也可以直接填绝对路径（例：D:\\文件\\报告.docx），还可以引用上游输出 {{u.out.path}}；「下载地址」＝先下载再解析（60s 超时，填了就忽略本地路径）。\n支持 pdf / docx / xlsx / pptx / txt / md / csv / json / html。把 PDF / Office 文档 / 图片抽成纯文本喂给下游（PDF / Office 零依赖，不需要装任何库；图片和扫描版 PDF 走 OCR 引擎）。扫描版 PDF 有文本层就直接读、没有文本层才转图片识别（OCR 选「关」时它会明确报错告诉你怎么开）；旧版 .doc/.xls/.ppt 请先另存为 docx/xlsx/pptx。两者都为空时节点不执行、流程在此中断。'),
      row('文本上限 (字符)', text('maxChars', '200000', 'number'), '默认 20 万；超出会截断并把 truncated 置为 true'),
      row('OCR（图片识别）', createElement(SelectBox, {
        value: p.ocr === 'force' ? 'force' : (p.ocr === 'off' ? 'off' : 'auto'),
        onChange: (v: string) => onParamsChange({ ocr: v }),
        // 名称留 label、解释进 sub（同上）：sub 里的文字与旧 label 的破折号后半**一字不差**
        options: [
          { value: 'off', label: '关', sub: '不跑 OCR（图片会明确报错、扫描版 PDF 只拿到空文本）' },
          { value: 'auto', label: '自动（默认）', sub: '图片识别；扫描版 PDF 自动转图片识别' },
          { value: 'force', label: '强制', sub: '连有文本层的 PDF 也重新识别' },
        ],
      }), '图片（png / jpg / webp / bmp / tif）与扫描版 PDF（没有文本层的）都走 OCR 引擎；有文本层的 PDF 直接读文本、不做无用功（想强制重识别选「强制」）。扫描版 PDF 按页栅格化，最多 20 页（参数 ocrMaxPages 可调），页多会慢。'),
      row('抽取内嵌图片', createElement(SelectBox, {
        value: p.extractImages === 'off' ? 'off' : 'auto',
        onChange: (v: string) => onParamsChange({ extractImages: v }),
        options: [
          { value: 'auto', label: '自动（默认）', sub: '抽到就存进统一图片目录，并在文本相应位置标注文件名' },
          { value: 'off', label: '关', sub: '只解析文本，不抽取图片' },
        ],
      }), '抽出的图片存到 <DSH_HOME>/.dag-flow/images/（与 AI 节点 images 参数同一个目录，可直接被 AI 节点引用）；文档文本里会在图片原来的位置插入「[图片：文件名]」。Word / PPT 能定位到段落、页；Excel 的浮动图统一标在文末。反复解析同一份文档不会堆副本（同名同内容不重写）。'),
    );
  }
  // web_fetch
  return createElement('div', null,
    row('!抓取地址 (url)', text('url', 'https://…（可引用 {{u.out.url}}）'), '抓取网页：HTML 自动剥离标签取正文文本，JSON 自动解析为对象；常与「网页搜索→网页抓取→AI」串联。url 留空时节点不执行、流程在此中断。'),
    row('正文上限 (字符)', text('maxChars', '8000', 'number'), 'HTML 自动剥标签取正文；200-200000'),
    row('原样返回', createElement(SelectBox, {
      value: p.raw ? '1' : '0',
      onChange: (v: string) => onParamsChange({ raw: v === '1' }),
      options: [
        { value: '0', label: '否', sub: '剥 HTML / 解析 JSON（推荐）' },
        { value: '1', label: '是', sub: '返回原始响应体' },
      ],
    })),
  );
}
