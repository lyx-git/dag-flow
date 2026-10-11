// 交付自检：构建产物 + DSH 插件清单校验（不执行安装、不写任何文件）
// ★ 2026-10-11（审计⑥⑫）：文件名从 install-check.mjs 改为 *.test.mjs 并挂进 test:offline 链——
//   此前它躺在链外（手跑 22/22 绿，但没人跑），而且 tmp-test/audit-todos.mjs 的孤儿判据只认
//   `*.test.mjs`，所以"孤儿：无"是假安心。同时补两条**产物标记一致性**断言，专治
//   「改了 src 忘了重建 dist」——那会让真机继续跑旧代码，且看不出任何异常。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');   // 不再写死机器绝对路径
let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('=== 清单与产物校验 ===');
// 1. package.json
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
t('package.name === dag-flow', pkg.name === 'dag-flow');
t('dsh.bundle.patch 指向 cordis.patch.yml', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
t('dsh.client.platform === web', pkg.dsh?.client?.platform === 'web');
t('exports["./client"] → dist/client.js', pkg.exports?.['./client'] === './dist/client.js');
t('exports["."] → dist/index.js', pkg.exports?.['.'] === './dist/index.js');
t('test:offline 含四套测试', /offline.*runtime.*storage.*api-e2e/s.test(pkg.scripts?.['test:offline'] ?? ''));

// 2. cordis.patch.yml（文本级校验：合法的 insert 条目）
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
t('cordis.patch.yml 含 insert + id: dag-flow + name: dag-flow',
  patch.includes('- insert:') && patch.includes('id: dag-flow') && patch.includes('name: dag-flow'));

// 3. dist 产物
for (const f of ['dist/index.js', 'dist/client.js', 'dist/index.d.ts', 'dist/client.js.map']) {
  t(`${f} 存在`, existsSync(join(ROOT, f)));
}
const h = readFileSync(join(ROOT, 'dist/index.js'), 'utf8');
const c = readFileSync(join(ROOT, 'dist/client.js'), 'utf8');
t('host bundle 含 dag-flow 插件名', h.includes('dag-flow'));
t('host 无旧名残留', !h.includes('dsh-workflow-builder'));
t('client 无旧名残留', !c.includes('dsh-workflow-builder'));
t('client 含 CSS 注入（data-source）', c.includes('data-source'));
t('client 含 FlowGram 画布', c.includes('dsh-wf-fg-card'));
t('client 含侧栏入口', c.includes('data-dag-flow-entry'));
t('client 含组合输入弹窗', c.includes('dag-flow-combo-list'));
t('client 无 reactflow 残留', !/reactflow\/dist|from\s*['"]reactflow['"]/.test(c));

// 3.5 dist 全目录旧名扫描（防旧构建管线产物再次混入；
//     2026-09-25 回归曾发现 dist 混有旧 tsc 产物，含 "workflow-builder"/"dsh-workflow-builder" 旧名）
{
  let leaked = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|mjs|d\.ts|map)$/.test(e.name)) {
        const txt = readFileSync(p, 'utf8');
        if (txt.includes('dsh-workflow-builder') || txt.includes('"workflow-builder"')) leaked.push(p);
      }
    }
  };
  walk(join(ROOT, 'dist'));
  t('dist 全目录无旧名残留（含子目录/.d.ts/.map）', leaked.length === 0, leaked.join(', '));
}

// 3.6 ★ 产物标记一致性（2026-10-11 审计⑫）：src 里的版本标记必须出现在对应产物里。
//     「改了 src 忘了重建」不会报任何错，但真机会一直跑旧代码——这两条把它变成红灯。
{
  const srcHost = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
  const hostMarker = /loaded \(host (v[\w.-]+)\)/.exec(srcHost)?.[1];
  t('src/index.ts 能取到宿主版本标记', !!hostMarker, String(hostMarker));
  t(`dist/index.js 含该标记 ${hostMarker ?? ''}（防改了 src 没重建）`, !!hostMarker && h.includes(hostMarker), String(hostMarker));

  const srcClient = readFileSync(join(ROOT, 'src/client/index.tsx'), 'utf8');
  const clientMarker = /client (v[\w.-]+) · apply OK/.exec(srcClient)?.[1];
  t('src/client/index.tsx 能取到客户端版本标记', !!clientMarker, String(clientMarker));
  t(`dist/client.js 含该标记 ${clientMarker ?? ''}（防改了 src 没重建）`, !!clientMarker && c.includes(clientMarker), String(clientMarker));
}

// 4. 宿主/客户端模块加载冒烟
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
global.window = { __ModuleLoader__: { load: (o) => { globalThis.__f = o.factory; } } };
nodeRequire(join(ROOT, 'dist/client.js'));
const cm = globalThis.__f((n) => {
  if (n === 'react') return nodeRequire(join(ROOT, 'node_modules/react'));
  if (n === 'react-dom') return nodeRequire(join(ROOT, 'node_modules/react-dom'));
  if (n === 'react-dom/client') return nodeRequire(join(ROOT, 'node_modules/react-dom/client'));
  throw new Error(`external ${n}`);
});
t('client factory 导出 mount/apply/inject', ['mount', 'apply', 'inject', 'unmount'].every((k) => k in cm));

const hm = await import('file://' + join(ROOT, 'dist/index.js').replace(/\\/g, '/'));
t('host 导出 name=dag-flow + apply', hm.name === 'dag-flow' && typeof hm.apply === 'function');

console.log(`\n=== 清单/产物校验: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
