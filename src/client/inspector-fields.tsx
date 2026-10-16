// src/client/inspector-fields.tsx — 右侧检查器的按节点类型专属字段表单
// SessionInputFields（会话选择）/ MediaFields（image_generate / video_generate / file_save）/ WebFields（web_search / doc_parse / web_fetch）。
// 只接收 node + onParamsChange 两个 props；必填红星复用 panel-utils 的 reqMark。
// 2026-10-14 重构轮 6 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useEffect, useState } from 'react';
import { reqMark } from './panel-utils';
import { InfoTip } from './info-tip';

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
      createElement('select', {
        className: 'dsh-wf-input',
        value: selectedId,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleId(e.target.value),
      },
        createElement('option', { value: '' }, sessionsLoaded ? '（选择一个会话，按最近活动排序）' : '（加载会话列表...）'),
        sessions.map((s) => {
          const when = fmtSessionTime(s.mtime);
          return createElement('option', { key: s.id, value: s.id }, when ? `${when} · ${s.name}` : s.name);
        }),
      ),
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
  const [imageTesting, setImageTesting] = useState(false);
  const [imageTestMsg, setImageTestMsg] = useState<string | null>(null);
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

  if (node.type === 'image_generate') {
    const runImageTest = async () => {
      setImageTesting(true);
      setImageTestMsg(null);
      try {
        const res = await fetch('/api/dag-flow/test-image-api', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseURL: p.baseURL, apiKey: p.apiKey, apiKeyEnv: p.apiKeyEnv, model: p.model, size: p.size }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; note?: string; hint?: string; detail?: string; error?: string };
        setImageTestMsg(
          data.error ? `✗ ${data.error}`
            : data.ok ? `✓ ${data.note ?? '连接成功且模型可用'}`
              : `✗ ${data.hint ?? '测试失败'}${data.detail ? ` — ${data.detail}` : ''}`.slice(0, 320),
        );
      } catch (e) {
        setImageTestMsg(`✗ ${(e as Error).message}`);
      } finally {
        setImageTesting(false);
      }
    };
    return createElement('div', null,
      row('!画面描述 (prompt)', createElement('textarea', {
        className: 'dsh-wf-input', rows: 3, placeholder: '描述想生成的画面…',
        defaultValue: typeof p.prompt === 'string' ? p.prompt : '',
        onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ prompt: e.target.value }),
      }), '运行后图片直接保存到 <DSH_HOME>/.dag-flow/ 目录，输出含相对路径。测试会真实生成 1 张最小图（产生少量费用）。'),
      row('!API 地址 (baseURL)', text('baseURL', 'https://…/compatible-mode/v1'), 'OpenAI images/generations 兼容接口'),
      row('模型', text('model', 'wanx-v1'), '必须是该 API 服务支持的图片模型（用下方测试验证）'),
      row('尺寸', text('size', '1024*1024')),
      row('API Key（或留空用环境变量）', text('apiKey', 'sk-…；留空则用 apiKeyEnv')),
      row('Key 环境变量名', text('apiKeyEnv', 'DASHSCOPE_API_KEY')),
      row('🔍 提前测试（验证 API 与模型）', createElement('button', {
        className: 'dsh-wf-btn',
        onClick: () => void runImageTest(),
        disabled: imageTesting,
        title: '真实发一次最小生成请求，验证 baseURL/Key/模型组合是否可用',
      }, imageTesting ? '⏳ 测试中…' : '🔍 测试连接')),
      imageTestMsg && createElement('div', { className: 'dsh-wf-panel-hint' }, imageTestMsg),
    );
  }
  if (node.type === 'video_generate') {
    return createElement('div', null,
      row('!任务提交地址', text('submitUrl', 'https://…/video/generation（POST）'), '异步任务模式：提交 → 按 interval 轮询 statusPath → videoUrlPath 有值即完成，视频直接下载到 <DSH_HOME>/.dag-flow/ 目录。'),
      row('!任务查询地址', text('pollUrl', 'https://…/video/task?taskId={taskId}'), '支持 {taskId} 占位符'),
      row('Key 环境变量名 / apiKey', text('apiKeyEnv', 'DASHSCOPE_API_KEY')),
      row('轮询间隔 (ms)', text('pollIntervalMs', '5000')),
      row('最长等待 (ms)', text('maxWaitMs', '600000'), '超时后节点失败并给出最后任务状态'),
    );
  }
  // file_save
  return createElement('div', null,
    row('内容来源', createElement('select', {
      className: 'dsh-wf-input',
      value: typeof p.source === 'string' ? p.source : 'text',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ source: e.target.value }),
    },
      createElement('option', { value: 'text' }, '文本内容（text）'),
      createElement('option', { value: 'base64' }, 'Base64（base64）'),
      createElement('option', { value: 'url' }, 'URL 下载（url）'),
    )),
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
      }), '内置 5 个免 key 引擎，任何 DSH 零配置可用；auto 模式下若宿主装有 dsh-free-search 会优先走宿主（自动继承你配置的付费引擎与密钥），失败自动回落内置引擎链（Bing→DDG Lite→DDG→SearXNG→AnySearch）。query 留空时节点不执行、流程在此中断。'),
      row('搜索引擎', createElement('select', {
        className: 'dsh-wf-input',
        value: typeof p.provider === 'string' ? p.provider : 'auto',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ provider: e.target.value }),
      },
        createElement('option', { value: 'auto' }, 'auto（宿主优先 + 内置兜底，推荐）'),
        createElement('option', { value: 'bing' }, 'Bing（免 key）'),
        createElement('option', { value: 'ddg-lite' }, 'DuckDuckGo Lite（免 key）'),
        createElement('option', { value: 'ddg' }, 'DuckDuckGo HTML（免 key）'),
        createElement('option', { value: 'searxng' }, 'SearXNG（公共实例，免 key）'),
        createElement('option', { value: 'anysearch' }, 'AnySearch（免费匿名额度）'),
        createElement('option', { value: 'host' }, '仅宿主（要求已装 dsh-free-search）'),
      )),
      row('结果条数', text('count', '8', 'number'), '1-20 条'),
      row('时间范围', createElement('select', {
        className: 'dsh-wf-input',
        value: typeof p.timeRange === 'string' ? p.timeRange : '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ timeRange: e.target.value || undefined }),
      },
        createElement('option', { value: '' }, '不限'),
        createElement('option', { value: 'day' }, '一天内'),
        createElement('option', { value: 'week' }, '一周内'),
        createElement('option', { value: 'month' }, '一月内'),
        createElement('option', { value: 'year' }, '一年内'),
      )),
    );
  }
  if (node.type === 'doc_parse') {
    return createElement('div', null,
      row('!文件路径 (path)', text('path', 'documents/公告.pdf 或 D:\\文件\\报告.docx（可引用 {{u.out.path}}）'),
        '相对路径锚定 <DSH_HOME>/.dag-flow/；支持 pdf / docx / xlsx / pptx / txt / md / csv / json / html。\n把 PDF / Office 文档 / 图片抽成纯文本喂给下游（PDF / Office 零依赖，不需要装任何库；图片和扫描版 PDF 走 OCR 引擎）。扫描版 PDF 有文本层就直接读、没有文本层才转图片识别（OCR 选「关」时它会明确报错告诉你怎么开）；旧版 .doc/.xls/.ppt 请先另存为 docx/xlsx/pptx。path 与 url 都为空时节点不执行、流程在此中断。'),
      row('或：下载地址 (url)', text('url', 'https://…/公告.pdf'),
        '填了 url 就忽略 path（会先下载再解析，60s 超时）'),
      row('文本上限 (字符)', text('maxChars', '200000', 'number'), '默认 20 万；超出会截断并把 truncated 置为 true'),
      row('OCR（图片识别）', createElement('select', {
        className: 'dsh-wf-input',
        value: (p.ocr === 'auto' || p.ocr === 'force') ? String(p.ocr) : 'off',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ ocr: e.target.value }),
      },
        createElement('option', { value: 'off' }, '关（默认）'),
        createElement('option', { value: 'auto' }, '自动 —— 图片识别；扫描版 PDF 自动转图片识别'),
        createElement('option', { value: 'force' }, '强制 —— 连有文本层的 PDF 也重新识别'),
      ), '图片（png / jpg / webp / bmp / tif）与扫描版 PDF（没有文本层的）都走 OCR 引擎；有文本层的 PDF 默认直接读文本、不做无用功（想强制重识别选「强制」）。扫描版 PDF 按页栅格化，最多 20 页（参数 ocrMaxPages 可调），页多会慢。'),
      row('抽取内嵌图片', createElement('select', {
        className: 'dsh-wf-input',
        value: p.extractImages === 'off' ? 'off' : 'auto',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ extractImages: e.target.value }),
      },
        createElement('option', { value: 'auto' }, '自动（默认）—— 抽到就存进统一图片目录，并在文本相应位置标注文件名'),
        createElement('option', { value: 'off' }, '关 —— 只解析文本，不抽取图片'),
      ), '抽出的图片存到 <DSH_HOME>/.dag-flow/images/（与 AI 节点 images 参数同一个目录，可直接被 AI 节点引用）；文档文本里会在图片原来的位置插入「[图片：文件名]」。Word / PPT 能定位到段落、页；Excel 的浮动图统一标在文末。反复解析同一份文档不会堆副本（同名同内容不重写）。'),
    );
  }
  // web_fetch
  return createElement('div', null,
    row('!抓取地址 (url)', text('url', 'https://…（可引用 {{u.out.url}}）'), '抓取网页：HTML 自动剥离标签取正文文本，JSON 自动解析为对象；常与「网页搜索→网页抓取→AI」串联。url 留空时节点不执行、流程在此中断。'),
    row('正文上限 (字符)', text('maxChars', '8000', 'number'), 'HTML 自动剥标签取正文；200-200000'),
    row('原样返回', createElement('select', {
      className: 'dsh-wf-input',
      value: p.raw ? '1' : '0',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ raw: e.target.value === '1' }),
    },
      createElement('option', { value: '0' }, '否（剥 HTML / 解析 JSON，推荐）'),
      createElement('option', { value: '1' }, '是（返回原始响应体）'),
    )),
  );
}
