// src/client/JsonView.tsx
// JSON 编辑视图：优先 Monaco Editor，不可用时回退 textarea；
// 右侧 ajv 实时 schema 校验。改动时双向同步到 FlowPanel 状态。

import { useEffect, useRef, useState, createElement } from 'react';
import type { WorkflowDef } from './types';
import { getThemeMode } from './theme';
// ★ 2026-10-11（审计②）：名字规则的唯一事实源是 src/name-rule.ts（client 另外 4 处都引它），
//   这里此前把 pattern 抄了一份硬编码副本——两处当前恰好相同，改规则时必漂移（症状会是
//   「保存得了、JSON 页报错」这类反向不一致）。改为一律引唯一源。
import { WORKFLOW_NAME_PATTERN } from '../name-rule';
// ★ ajv 中文映射的唯一源（与 host `executor/parse.ts` 共用同一模块；2026-10-16 规范整改前是两份副本）
import { zhAjvMessage } from '../ajv-zh';

interface JsonViewProps {
  def: WorkflowDef;
  onChange: (def: WorkflowDef) => void;
  /** 2026-10-15 大 JSON 提速：视图是否可见（FlowPanel 常驻挂载、隐藏时 display:none）。
   *  隐藏时**跳过全部同步**（不 stringify、不校验）⇒ 画布上的 def 变化在 JSON 隐藏期间零开销；
   *  切到可见的那一刻才与 def 对齐。缺省视为可见（兼容旧用法）。 */
  visible?: boolean;
}

/** monaco 内核的 vs 基址。★2026-10-16：`@monaco-editor/loader` 的默认值是
 *  `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`，而**本机实测 jsdelivr 不可达**
 *  （unpkg / npmmirror 均 200）⇒ 显式换到 unpkg。版本与 loader 默认一致（0.55.1），
 *  不用 `latest`，避免新内核与 `@monaco-editor/react@4.7.0` 不兼容。 */
const MONACO_VS_BASE = 'https://unpkg.com/monaco-editor@0.55.1/min/vs';
/** 首次加载 monaco 内核的等待上限（正常 1–5s）：超过就按「Monaco 不可用」处理、回退 textarea——
 *  宁可用大字板，也不要把用户永远挂在「编辑器加载中…」（2026-10-16 修的正是这个）。 */
const MONACO_LOAD_TIMEOUT_MS = 8000;
/** Monaco 编辑器选项（★ 模块常量：写在 render 里等于每次渲染都新建对象、Monaco 每次都收到新
 *  options 引用而重跑 options 更新——规范"render 里不建大常量/新对象引用"）。 */
const MONACO_OPTIONS: Record<string, unknown> = { minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' };

/** 超时竞速（★ 必须在 finally 清掉定时器）：内核通常 1s 就绪，裸 setTimeout 会让这个 8s 的 timer
 *  一直挂到卸载之后（虽无 setState 副作用，但属定时器泄漏；规范"超时/竞速类必须统一清理"）。 */
async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = window.setTimeout(() => resolve(onTimeout()), ms); }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

// ★ 2026-10-11：改为 export —— 仅供一致性探针（tmp-test/verify-schema-parity.mjs）与将来的一致性
//   测试对比 host src/types.ts 的 WORKFLOW_SCHEMA；对 bundle 无影响（index.tsx 才是入口）。
export const WORKFLOW_SCHEMA = {
  $id: 'https://dag-flow/schemas/workflow.json',
  type: 'object',
  required: ['name', 'version', 'nodes'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', pattern: WORKFLOW_NAME_PATTERN },
    version: { const: 1 },
    description: { type: 'string' },
    inputs: { type: 'object', additionalProperties: true },
    nodes: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        required: ['id', 'type'],
        additionalProperties: true,
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
          type: { type: 'string', minLength: 1 },
          params: { type: 'object', additionalProperties: true },
          // 与 host WORKFLOW_SCHEMA.next 同步（2026-10-02）：if 的 {true,false} 与 switch 的
          // { case值: 目标 } 共用同一 object 形状，必须是单个分支（并列会撞 oneOf）
          next: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } },
              { type: 'null' },
            ],
          },
          // ★ 2026-10-11（审计①）：此前写的是宽松的 { type: ['string','object'] }——任何 object 都放行，
          //   而 host WORKFLOW_SCHEMA 是严格 oneOf（goto 分支要求 goto:string 且不许有其它键）。
          //   结果：JSON 页显示 ✅、一点运行才被 host 拒（用户视角＝「这里说没问题，一运行就报错」）。
          //   下面与 host src/types.ts 的 onError **逐字同形**，改一边必须改另一边。
          onError: {
            oneOf: [
              { enum: ['stop', 'continue'] },
              {
                type: 'object',
                required: ['goto'],
                additionalProperties: false,
                properties: { goto: { type: 'string' } },
              },
            ],
          },
          tolerate: { type: 'boolean' },
          label: { type: 'string' },
        },
      },
    },
    layout: { type: 'object', additionalProperties: true },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          when: { type: 'string' },
        },
      },
    },
  },
} as const;

// ★ 2026-10-15 大 JSON 加载/编辑卡顿优化（用户反馈「针对大json加载有点慢」），行为不变：
//   ① ajv validator **模块级只编译一次**（原每次按键都 await import + compile 全量 schema，大 JSON 双倍慢）；
//   ② 校验**防抖 400ms**（原每个按键同步跑全文校验，打字卡）；
//   ③ Monaco CDN 加载期间给占位提示（原白等无反馈）。
// 同步语义不变：外部 def 引用变化 → 重置编辑文本（syncedDefRef 保持原 useMemo [def] 的语义）。

/** schema 是模块常量 ⇒ validator 全程只需编译一次（首键 ~几十 ms，之后复用） */
type Validator = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};
let cachedValidate: Validator | null = null;
async function getValidator(): Promise<Validator | null> {
  if (cachedValidate) return cachedValidate;
  try {
    const Ajv = (await import('ajv')).default;
    const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
    cachedValidate = ajv.compile(WORKFLOW_SCHEMA);
    return cachedValidate;
  } catch {
    return null; // ajv 不可用：调用方回退只校验 JSON.parse
  }
}

export function JsonView({ def, onChange, visible = true }: JsonViewProps) {
  const [text, setText] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [valid, setValid] = useState<boolean>(true);
  // ★ 2026-10-15 大 JSON 提速：只在**可见**时与 def 对齐（隐藏期不 stringify），且同一 def 引用不重排。
  //   语义：外部 def 第一次可见 / 可见期间 def 引用变化 → 重置编辑文本（与改动前的 [def] 语义一致）。
  const syncedDefRef = useRef<WorkflowDef | null>(null);
  useEffect(() => {
    if (!visible) return;                        // 隐藏：零开销
    if (syncedDefRef.current === def) return;    // 同一引用：不重排
    syncedDefRef.current = def;
    setText(JSON.stringify(def, null, 2));
  }, [def, visible]);

  // 校验（防抖 400ms；ajv 单例 + 失败回退手写 JSON.parse）；隐藏时完全不跑（大 JSON 零开销）
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          if (!cancelled) {
            setValid(false);
            setErrors([`JSON 解析失败: ${(e as Error).message}`]);
          }
          return;
        }
        try {
          const validate = await getValidator();
          if (cancelled) return;
          if (!validate) {
            // ajv 不可用：只校验 JSON.parse
            if (!cancelled) {
              setValid(true);
              setErrors([]);
            }
            return;
          }
          const ok = validate(parsed);
          if (cancelled) return;
          if (ok) {
            setValid(true);
            setErrors([]);
          } else {
            setValid(false);
            // 中文映射与 host `executor/parse.ts` **共用同一模块** src/ajv-zh.ts（2026-10-16 规范整改：
            //   原先两份各抄一遍、靠人工同步，本轮就漂移过 ⇒ 现在只有唯一源，改一处两边同时生效）。
            setErrors((validate.errors ?? []).map((e) => `${e.instancePath || '(根)'} ${zhAjvMessage(e.message ?? '')}`));
          }
        } catch {
          // ajv 不可用：只校验 JSON.parse
          if (!cancelled) {
            setValid(true);
            setErrors([]);
          }
        }
      })();
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [text, visible]);

  // 提交：校验通过 → 回写
  const commit = () => {
    try {
      const parsed = JSON.parse(text) as WorkflowDef;
      onChange(parsed);
    } catch { /* ignore */ }
  };

  // 尝试加载 Monaco（不可用就回退 textarea）
  const [MonacoEditor, setMonacoEditor] = useState<React.ComponentType<{
    value: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
    height?: string | number;
    theme?: string;
    options?: Record<string, unknown>;
    loading?: React.ReactNode;
  }> | null>(null);
  const [monacoError, setMonacoError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@monaco-editor/react');
        // ★ 2026-10-16 修：**`import('@monaco-editor/react')` 成功 ≠ monaco 内核就绪**。
        //   内核由 loader 另外从 CDN 拉（默认写死 jsdelivr，本机实测不可达）⇒ 旧实现照样渲染
        //   组件，却永远停在 `loading` 占位，且 `monacoError` 永不置位 ⇒ 回退 textarea 那一路
        //   根本走不到（真机症状＝JSON 视图一直显示「编辑器加载中…」；CDP 用例 json-view 卡死）。
        //   两处修：① vs 基址换成实测可达的 unpkg；② **显式等 loader.init() 就绪**（带超时），
        //   失败或超时一律按「Monaco 不可用」处理 ⇒ 回退纯 textarea。
        mod.loader.config({ paths: { vs: MONACO_VS_BASE } });
        const state = await withTimeout(
          mod.loader.init()
            .then(() => 'ok' as const)
            .catch((e: unknown) => String((e as Error)?.message ?? e ?? 'init-failed')),
          MONACO_LOAD_TIMEOUT_MS,
          () => '加载超时',
        );
        if (cancelled) return;
        if (state !== 'ok') { setMonacoError(state); return; }
        setMonacoEditor(() => mod.default);
      } catch (e) {
        if (!cancelled) setMonacoError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return createElement(
    'div',
    { className: 'dsh-wf-json-root' },
    // 左：编辑器
    createElement(
      'div',
      { className: 'dsh-wf-json-editor' },
      MonacoEditor
        ? createElement(MonacoEditor, {
            value: text,
            language: 'json',
            height: '100%',
            theme: getThemeMode() === 'nodeflow-light' || getThemeMode() === 'dsh' ? 'vs' : 'vs-dark',
            options: MONACO_OPTIONS, // 模块常量，见文件头常量区
            onChange: (v) => setText(v ?? ''),
            loading: createElement('div', { className: 'dsh-wf-text-muted', style: { padding: 12, fontSize: 11 } }, '编辑器加载中…'),
          })
        : createElement('textarea', {
            className: 'dsh-wf-textarea',
            value: text,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
            style: { width: '100%', height: '100%', border: 0, borderRadius: 0, fontSize: 12 },
            spellCheck: false,
          }),
      monacoError && createElement(
        'div',
        { className: 'dsh-wf-json-fallback' },
        `Monaco 不可用 (${monacoError})，回退 textarea`,
      ),
    ),
    // 右：校验 + 提交
    createElement(
      'aside',
      { className: 'dsh-wf-json-side' },
      createElement('div', { className: 'dsh-wf-palette-section' }, 'Schema 校验'),
      valid
        ? createElement('div', { className: 'dsh-wf-json-valid' }, '✓ JSON 校验通过')
        : createElement(
            'div',
            null,
            createElement('div', { className: 'dsh-wf-json-error', style: { marginBottom: 8 } }, `✗ ${errors.length} 个错误`),
            ...errors.map((e, i) => createElement('div', { key: i, className: 'dsh-wf-json-err-item' }, e)),
          ),
      createElement('div', { className: 'dsh-wf-palette-section', style: { marginTop: 16 } }, '操作'),
      createElement(
        'button',
        {
          className: 'dsh-wf-btn dsh-wf-btn-primary',
          disabled: !valid,
          onClick: commit,
          style: { marginTop: 8 },
        },
        '应用 JSON',
      ),
      createElement(
        'p',
        { className: 'dsh-wf-text-muted', style: { fontSize: 11, marginTop: 8 } },
        '失焦 / 点"应用"即提交，校验失败不会写入。',
      ),
    ),
  );
}
