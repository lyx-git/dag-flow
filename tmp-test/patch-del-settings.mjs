// tmp-test/patch-del-settings.mjs — 删掉设置页「工作流配置」分区（2026-10-04 用户拍板：整个删掉）
//   用户原话：「工作流配置设置页面，直接删掉吧，已经没啥用了」
//   背景：该分区自 09-25 模型/密钥配置移除后，只剩「🎨 画布主题」下拉 + 一行「AI 模型自动取自 dsh」说明。
//   它同时是**唯一**能切画布主题的入口 → 删除前已用 ask_user_question 把副作用讲清并拿到确认。
//   做法（严格最小面）：① index.tsx 去掉 registerSettingsSection 调用 + import + re-export；
//   ② 删 src/client/SettingsPage.tsx；③ 删死 CSS `.dsh-wf-settings`（含它上面那行注释）。
//   保留：theme.ts、启动时的 applyTheme(getThemeMode())（主题仍从 localStorage 恢复）、
//        防腐层 dsh-gate.ts 的 registerSettingsSection 能力位（不再被调用，作为 ACL 能力备用）。
//   幂等：已删过会拒绝执行。备份到 tmp-test/backup-del-settings/。
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, copyFileSync } from 'node:fs';

const IDX = 'src/client/index.tsx';
const CSS = 'src/client/styles.css';
const SETTINGS = 'src/client/SettingsPage.tsx';
const BAK = 'tmp-test/backup-del-settings';

const problems = [];
if (!existsSync(IDX) || !existsSync(CSS) || !existsSync(SETTINGS)) {
  console.error('✗ 预期文件缺失（可能已执行过本脚本）'); process.exit(1);
}
let idx = readFileSync(IDX, 'utf8');
let css = readFileSync(CSS, 'utf8');
const origIdx = idx, origCss = css;

// 自检 0：改动前，这 5 处必须都在（证明我们删的是真东西）
for (const [label, hay, needle] of [
  ['index.tsx 的 SettingsPage import', idx, "import { SettingsPage } from './SettingsPage';"],
  ['index.tsx 的 registerSettingsSection import', idx, 'registerSettingsSection,'],
  ['index.tsx 的注册调用', idx, "registerSettingsSection(ctx, { id: 'dag-flow.settings'"],
  ['index.tsx 的 re-export', idx, "export { SettingsPage } from './SettingsPage';"],
  ['styles.css 的 .dsh-wf-settings', css, '.dsh-wf-settings'],
]) {
  if (!hay.includes(needle)) problems.push('改动前未找到：' + label);
}
if (problems.length) { console.error('✗ 前置自检失败：\n  - ' + problems.join('\n  - ')); process.exit(1); }

// ---- 备份 ----
mkdirSync(BAK, { recursive: true });
for (const f of [IDX, CSS, SETTINGS]) copyFileSync(f, BAK + '/' + f.replace(/[\\/]/g, '__'));
console.log('已备份 → ' + BAK);

/** 精确替换一次（多于/少于一次都算失败） */
function once(hay, needle, rep, label) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) { problems.push(`${label}：期望出现 1 次，实际 ${n} 次`); return hay; }
  return hay.replace(needle, rep);
}

// ① index.tsx —— import
idx = once(idx, "import { SettingsPage } from './SettingsPage';\n", '', '删 SettingsPage import');
idx = once(idx, '  registerSettingsSection,\n', '', '删 registerSettingsSection import');
// ② index.tsx —— 注册调用（连它上面那行注释一起删；注释里有全角引号，用「settings.section」这个 ASCII 标记定位整行）
const regLine = idx.split('\n').findIndex((l) => l.includes('settings.section'));
if (regLine < 0) problems.push('找不到 settings.section 注释行');
else {
  const callLine = regLine + 1;
  if (!idx.split('\n')[callLine]?.includes('registerSettingsSection(ctx')) problems.push('注释行下一行不是注册调用');
  else {
    const lines = idx.split('\n');
    // 删「注释行、注册调用行、其后紧跟的空行」
    const delTo = lines[callLine + 1] === '' ? callLine + 2 : callLine + 1;
    lines.splice(regLine, delTo - regLine);
    idx = lines.join('\n');
  }
}
// ③ index.tsx —— 步骤重新编号（1/2/3 → 1/2）
idx = once(idx, '// 2. 侧栏入口', '// 1. 侧栏入口', '重编号 侧栏入口');
idx = once(idx, '// 3. 主区域停靠面板', '// 2. 主区域停靠面板', '重编号 主区域停靠面板');
// ④ index.tsx —— re-export
idx = once(idx, "export { SettingsPage } from './SettingsPage';\n", '', '删 re-export');
// ⑤ index.tsx —— 版本标记 + 变更说明
idx = once(idx, 'client v20261004-text-width', 'client v20261004-nosettings', '版本标记');
const LOG = `// v20261004-nosettings：**删掉设置页「工作流配置」分区**（2026-10-04 用户原话：「工作流配置设置页面，
//   直接删掉吧，已经没啥用了」）。该分区自 09-25 模型/密钥配置移除后只剩「🎨 画布主题」下拉 + 一行说明，
//   是旧功能的残壳。删除：registerSettingsSection 调用 + src/client/SettingsPage.tsx + 它的 re-export + 死 CSS。
//   ★副作用（已 ask_user_question 讲清并获确认后执行）：画布主题从此**没有界面入口**，固定在 localStorage
//   里已保存的值（默认 nodeflow 深空蓝）；theme.ts 与启动时的 applyTheme(getThemeMode()) 保留不动。
//   ★防腐层 dsh-gate.ts 的 registerSettingsSection 能力**保留**（不再被调用，作为 ACL 能力位备用）。
`;
idx = once(idx, '// v20261004-text-width：', LOG + '// v20261004-text-width：', '插入变更说明');

// ⑥ styles.css —— 删 .dsh-wf-settings 块（连同它正上方那行注释；注释是乱码，故用"紧邻关系"匹配，不按内容匹配）
const cssRe = /\/\*[^\n]*\*\/\n\.dsh-wf-settings \{[^}]*\}\n/;
if (!cssRe.test(css)) problems.push('styles.css：匹配不到「注释 + .dsh-wf-settings 块」');
else css = css.replace(cssRe, '');

if (problems.length) { console.error('✗ 自检失败，未写盘：\n  - ' + problems.join('\n  - ')); process.exit(1); }

// 自检 1：目标物必须已消失（★注意：新插入的变更说明注释里**本来就会提到** SettingsPage / registerSettingsSection
//   这两个名字，所以这里必须用"代码锚点"判定，不能用裸词判定——第一版就是踩了这个假阳性）
const after = [
  ['index.tsx 仍 import/export SettingsPage 模块', idx.includes("'./SettingsPage'")],
  ['index.tsx 仍有注册调用', idx.includes('registerSettingsSection(ctx')],
  ['index.tsx 仍有 settings.section', idx.includes('settings.section')],
  ['styles.css 残留 dsh-wf-settings', css.includes('dsh-wf-settings')],
];
for (const [label, bad] of after) if (bad) problems.push('删除后仍有：' + label);
// 自检 2：不许误伤——其余关键内容必须还在
for (const [label, hay, needle] of [
  ['registerMainPanel 调用', idx, 'registerMainPanel(ctx, { key: \'dag-flow\' }'],
  ['CLIENT_INJECT', idx, 'CLIENT_INJECT'],
  ['主题初始化', idx, 'applyTheme(getThemeMode())'],
  ['默认导出', idx, 'export default { apply, inject, mount: mountWorkflowPanel, unmount };'],
  ['侧栏入口', idx, 'mountSidebarEntry('],
  ['新标记', idx, 'v20261004-nosettings'],
  ['CSS 其余内容（.dsh-wf-win 仍在）', css, '.dsh-wf-win'],
  ['CSS 其余内容（.dsh-wf-panel-row 仍在）', css, '.dsh-wf-panel-row'],
]) if (!hay.includes(needle)) problems.push('误伤检查失败，缺少：' + label);
// 自检 3：行数变化必须**精确**等于预期（删 6 行、插入 LOG 的 7 行 → 净 +1）
const LOG_LINES = LOG.split('\n').length - 1;
const dIdx = origIdx.split('\n').length - idx.split('\n').length;
if (dIdx !== 6 - LOG_LINES) problems.push(`index.tsx 行数变化异常：${dIdx}（期望 ${6 - LOG_LINES} = 删6行/插入${LOG_LINES}行）`);

if (problems.length) { console.error('✗ 自检失败，未写盘：\n  - ' + problems.join('\n  - ')); process.exit(1); }

writeFileSync(IDX, idx);
writeFileSync(CSS, css);
unlinkSync(SETTINGS);
console.log('✓ 已删注册/import/re-export/死CSS，并删除 ' + SETTINGS);
console.log('  index.tsx 行数 ' + origIdx.split('\n').length + ' → ' + idx.split('\n').length);
console.log('  styles.css 行数 ' + origCss.split('\n').length + ' → ' + css.split('\n').length);
