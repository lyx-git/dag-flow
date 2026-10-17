// src/client/flowgram/problems.tsx — 问题面板（#5：校验/孤立节点，点击定位）
// computeProblems = 画布侧的快速预检（缺参/孤立/缺分支键/goto 指向已跑过的节点），纯函数；
// ProblemPanel = 结果列表 UI（点击问题选中对应节点）。
// 2026-10-14 重构轮 4 自 FlowGramCanvas.tsx 纯搬运拆出。

import { createElement } from 'react';

export interface FlowProblem { level: 'error' | 'warn'; nodeId?: string; msg: string }

export function computeProblems(nodes: any[], edges: any[]): FlowProblem[] {
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));
  const problems: FlowProblem[] = [];
  for (const n of nodes) {
    if (n.type !== 'start' && !hasIn.has(n.id)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 无入边（不可达）` });
    if (n.type !== 'end' && !hasOut.has(n.id)) problems.push({ level: 'warn', nodeId: n.id, msg: `${n.id} 无出边（死路）` });
    const d = n.data ?? {};
    if (n.type === 'python' && !String(d.code ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} Python 代码为空` });
    if (n.type === 'bash' && !String(d.code ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} Bash 代码为空` });
    if (n.type === 'http' && !String(d.url ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} HTTP URL 为空` });
    if (n.type === 'web_search' && !String(d.query ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 搜索词（query）为空` });
    if (n.type === 'web_fetch' && !String(d.url ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 抓取地址（url）为空` });
    if (n.type === 'subagent' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 提示词为空` });
    if (n.type === 'image_generate' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 画面描述（prompt）为空` });
    if (n.type === 'image_generate' && !String(d.baseURL ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 图片 API 地址（baseURL）为空` });
    if (n.type === 'video_generate' && !String(d.submitUrl ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 任务提交地址（submitUrl）为空` });
    if (n.type === 'video_generate' && !String(d.pollUrl ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 任务查询地址（pollUrl）为空` });
    if (n.type === 'file_save' && !String(d.filename ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 保存文件名（filename）为空` });
    if (n.type === 'if' && !String(d.condition ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 条件表达式（condition）为空——会静默走 false 分支` });
    if (n.type === 'switch' && !String(d.value ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 匹配值（value）为空——会静默匹配不到任何分支` });
    if (n.type === 'switch' && (!d.cases || typeof d.cases !== 'object' || Array.isArray(d.cases) || Object.keys(d.cases).length === 0)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 分支表（cases）为空——至少配置一个分支或 "*" 兜底` });
    if (n.type === 'log' && !String(d.message ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 日志内容（message）为空` });
    if (n.type === 'manual' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 等待说明（prompt）为空` });
    if (n.type === 'set_var' && (!d.vars || typeof d.vars !== 'object' || Array.isArray(d.vars) || Object.keys(d.vars).length === 0)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 变量表（vars）为空——没有要写入的变量` });
    if (n.type === 'subflow' && !String(d.workflowName ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 子工作流名（workflowName）为空` });
    if (n.type === 'session_input' && !String(d.sessionId ?? '').trim()) problems.push({ level: 'warn', nodeId: n.id, msg: `${n.id} 未选择会话——运行时会报「session not found」` });
    // ★ loop 循环边界（P1，2026-10-03）：count/over 全缺 → 运行必然 LOOP_NO_BOUND 失败，
    //   提前在问题面板显形（引擎优先级 over > count；2026-10-19 while 条件循环已移除）
    if (n.type === 'loop') {
      const hasOver = Array.isArray(d.over) || (typeof d.over === 'string' && d.over.trim() !== '');
      const hasCount = typeof d.count === 'number';
      const hasWhile = typeof d.while === 'string' && d.while.trim() !== '';
      if (!hasOver && !hasCount && !hasWhile) {
        problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 循环边界缺失（count / over 至少配置一个）——运行时会报 LOOP_NO_BOUND` });
      } else if (!hasOver && !hasCount && hasWhile) {
        // ★ 2026-10-19：只有老 while 的节点现在跑不起来 —— 明确告警并给出改法（不然用户以为它还能跑）
        problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 用的是已移除的「条件循环 while」——请改成 count / over；要"满足条件就停"，在循环体里用条件节点判断并让 end 输出 break: true` });
      }
    }
  }
  // ★ 分支线缺分支键（2026-10-03 方案 C）：执行器对「if/switch 出边没有 when」按恒激活处理——
  //   也就是说两条分支都会跑。这是静默错误，必须在问题面板里显形（点击该问题会选中源节点）。
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = byId.get(e.source) as any;
    const t = src?.type;
    if (t !== 'if' && t !== 'switch') continue;
    if (e.sourceHandle) continue;
    problems.push({
      level: 'warn',
      nodeId: e.source,
      msg: `${e.source} → ${e.target} 这条分支线没设分支键——运行时会当作恒激活（所有分支都会执行）。点画布上该线中点的「未设分支」标签可设置`,
    });
  }
  // ★ 失败后跳转（onError.goto）指向**本节点之前**的节点（2026-10-04 轮 5）：
  //   轮 3 起 goto 是"失败边"语义，**目标只执行一次**——目标若在本节点之前（已经跑过）或同层，
  //   跳转不会生效、按「停止这条支路」处理。这类配置在画布上完全看不出来，运行后才发现，
  //   所以提前用祖先集合判出来（祖先必然在更早的层）；自跳也一并报。
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = parentsOf.get(e.target);
    if (list) list.push(e.source); else parentsOf.set(e.target, [e.source]);
  }
  for (const n of nodes) {
    // ★ 取法：onError 是 RFNode 的**顶层字段**（见 util/flowDef.ts 的 RFNode 契约），不在 data 里
    const oe = (n as any).onError;
    const goto = oe && typeof oe === 'object' ? (oe as { goto?: string }).goto : undefined;
    if (!goto) continue;
    // 反向 BFS 收集祖先
    const seen = new Set<string>([n.id]);
    const q = [n.id];
    let isAncestor = false;
    while (q.length && !isAncestor) {
      const cur = q.shift() as string;
      for (const p of parentsOf.get(cur) ?? []) {
        if (p === goto) { isAncestor = true; break; }
        if (!seen.has(p)) { seen.add(p); q.push(p); }
      }
    }
    if (isAncestor || goto === n.id) {
      problems.push({
        level: 'warn',
        nodeId: n.id,
        msg: `${n.id} 失败后跳转的目标「${goto}」在本节点之前${goto === n.id ? '（就是它自己）' : ''}——跳转只在目标还没跑到时生效（目标只执行一次），这里不会生效、会按「停止这条支路」处理。要"失败后回跳重试"请用循环区（loop 的循环体）`,
      });
    }
  }
  return problems;
}

export function ProblemPanel(props: { problems: FlowProblem[]; onClose: () => void; onSelect: (id: string) => void }) {
  return createElement(
    'div',
    { className: 'dsh-wf-fg-problems' },
    createElement('div', { className: 'dsh-wf-fg-problems-head' },
      createElement('span', null, `问题（${props.problems.length}）`),
      createElement('button', { className: 'dsh-wf-fg-problems-close', onClick: props.onClose }, '✕'),
    ),
    createElement('div', { className: 'dsh-wf-fg-problems-list' },
      props.problems.length === 0
        ? createElement('div', { className: 'dsh-wf-fg-problems-empty' }, '✓ 未发现问题')
        : props.problems.map((p, i) =>
            createElement('div', {
              key: i,
              className: `dsh-wf-fg-problem ${p.level}`,
              onClick: () => { if (p.nodeId) props.onSelect(p.nodeId); },
            }, `${p.level === 'error' ? '✕' : '⚠'} ${p.msg}`),
          ),
    ),
  );
}
