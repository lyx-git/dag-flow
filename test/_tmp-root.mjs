// test/_tmp-root.mjs — 测试临时目录的**统一入口**（建 + 退出即回收）
//
// ★ 为什么需要它（2026-10-16）：各测试都用 `mkdtempSync(tmpdir())` 造隔离数据根防污染真机（对），
//   但**从不回收** ⇒ 本机 TEMP 累积了约 8600 个 `dag-*` / `df-*` / `dsh-*` 残留目录（离线链每跑一次多几十个）。
//   本助手把"建"和"删"收成一处：进程退出时（**含断言失败/抛异常**）同步清掉本次建的目录。
//
// ★ 隔离性不变：仍然**无条件**新建临时目录，绝不继承外部 DSH_HOME / 缓存目录等
//   （2026-10-11 的事故教训见 test/_isolate-home.mjs 顶部）。
//
// 逃生舱：`DAG_FLOW_KEEP_TMP=1` → 保留现场，并在退出时打印目录清单（排障用）。
//
// 用法：`import { tmpRoot } from './_tmp-root.mjs';` 然后 `const dir = tmpRoot('flowdef');`
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = new Set();
const KEEP = process.env.DAG_FLOW_KEEP_TMP === '1';
let hooked = false;

/** 挂 exit 钩子（只挂一次；exit 里只能做同步操作 ⇒ 用 rmSync） */
function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', () => {
    if (created.size === 0) return;
    if (KEEP) {
      console.log(`[tmp-root] DAG_FLOW_KEEP_TMP=1 → 保留 ${created.size} 个临时目录：\n  ${[...created].join('\n  ')}`);
      return;
    }
    // ★ Windows 不允许删除"当前工作目录"：部分测试会 `process.chdir(自己的临时根)`
    //   （api-e2e / search 等），不先把 CWD 挪开就会删除失败、留下残壳（2026-10-16 实测 delta=2）。
    try { process.chdir(tmpdir()); } catch { /* ignore */ }
    let failed = 0;
    for (const dir of created) {
      // 收尾失败（文件锁等）不改变测试结论，也不抛；但失败要**可见**（否则又变成静默残留）
      try { rmSync(dir, { recursive: true, force: true }); } catch { failed++; }
    }
    created.clear();
    if (failed) console.warn(`[tmp-root] 有 ${failed} 个临时目录未能删除（被占用？）—— 可加 DAG_FLOW_KEEP_TMP=1 复现排查`);
  });
}

/** 建一个本次运行专属的临时目录（进程退出时自动删除）。tag 只用于人读，一般传被测主题名。 */
export function tmpRoot(tag = 'tmp') {
  hook();
  const safe = String(tag).replace(/[^a-zA-Z0-9_-]/g, '') || 'tmp';
  const dir = mkdtempSync(join(tmpdir(), safe.endsWith('-') ? safe : `${safe}-`));
  created.add(dir);
  return dir;
}

/** 把已经建好的目录也纳入清理（给不走 tmpRoot 的历史路径用） */
export function trackTmp(dir) {
  hook();
  if (typeof dir === 'string' && dir) created.add(dir);
  return dir;
}

export const tmpRequestedKeep = KEEP;
