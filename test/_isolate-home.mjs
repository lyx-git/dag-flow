// test/_isolate-home.mjs — 测试隔离：把 DSH_HOME 指向**本次测试专属的临时目录**
//
// ★ 为什么必须隔离（2026-10-11 存储锚点变更的配套）：
//   存储根现在是 **<DSH_HOME>/.dag-flow/**（固定，不跟工作区/cwd 走）。测试如果不管 DSH_HOME，
//   就会直接写进**真机的 <DSH_HOME>/.dag-flow**（工作流、runs/、logs/、定时配置全混进用户真实数据）。
//
// ★★ 为什么**不能**沿用环境里已存在的 DSH_HOME（2026-10-11 真机事故，血泪）：
//   本机 harness 自己就把 `DSH_HOME` 设成了用户真实主目录（C:\Users\lmz\.dsh）。最初这行写成
//   `process.env.DSH_HOME ?? mkdtemp(...)`，于是"隔离"形同虚设：整套离线测试把 demo-flow /
//   每日简报 / test / 测试 / sched-visible 等**测试夹具**写进了用户的真机 <DSH_HOME>/.dag-flow，
//   还写了一份测试用的 schedules.json —— 而旧位置迁移是"目标已存在就跳过"，
//   这份假的 schedules.json 会让用户真实的定时配置（金融政策日报 06:00）**迁不过来**。
//   ⇒ 结论：隔离必须**无条件**新建临时目录，绝不继承外部 DSH_HOME。
//   确实需要指定 home 的测试，用下面的 useHomeAs(dir) 显式指定（各测试自己的 fixture）。
//
// 用法（两种）：
//   ① 只要隔离（不关心具体路径）：把 `import './_isolate-home.mjs';` 放在文件最顶部 ——
//      它会新建一个临时目录并设为 DSH_HOME（不看外部环境变量）。
//   ② 需要断言路径（<DSH_HOME>/.dag-flow 要等于自己的临时工作区）：`useHomeAs(dir)`，
//      dir 传该测试自己的临时工作区 → 沿用既有断言语义（数据仍落在 <ws>/.dag-flow）。
//
// 注意：本模块必须**先于**被测 bundle 被 import（storage.ts 模块级会读 dshHome()）。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 本次测试专属的隔离 home（无条件新建；只有显式 DAG_FLOW_TEST_HOME 才复用，便于排查） */
export const ISOLATED_HOME = process.env.DAG_FLOW_TEST_HOME || mkdtempSync(join(tmpdir(), 'dsh-home-test-'));

process.env.DSH_HOME = ISOLATED_HOME;

/** 把 DSH_HOME 指到指定目录（<DSH_HOME>/.dag-flow 就落在它下面）。 */
export function useHomeAs(dir) {
  process.env.DSH_HOME = dir;
  return dir;
}
