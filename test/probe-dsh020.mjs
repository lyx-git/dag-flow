// test/probe-dsh020.mjs — dsh 0.2.0-rc.2 升级伤害实测探针（只读，不改任何数据）
// 用真实 DSH_HOME（C:\Users\lmz\.dsh）实测三个断点：
//   1) listAllEndpoints() —— settings.yaml 被 0.2.0 移除后，AI 端点发现是否扑空
//   2) listSessions()/readSessionContent() —— v4 会话文件名缺口 + zstd 多帧只解第一帧的伤害
//   3) yaml-lite 能否直接解析真实 cordis.patch.yml（修复方案可行性：llm-pi-ai 条目已在 patch 层）
// 运行：workdir = dag-flow 项目根，node test/probe-dsh020.mjs（需提权：读 C:\Users\lmz\.dsh）
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'dagflow-probe-'));

// ★ 真机 DSH_HOME（不重定向——就是要测真实环境）；清掉 env 逃生舱，测纯 dsh 发现链
process.env.DSH_HOME = 'C:\\Users\\lmz\\.dsh';
delete process.env.DAG_FLOW_LLM_BASEURL;
delete process.env.DAG_FLOW_LLM_KEY;
delete process.env.DAG_FLOW_LLM_MODEL;

async function bundle(entry, outfile) {
  await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true, format: 'esm', platform: 'node', target: 'node20',
    outfile, logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

// —— 1) settings 发现链（0.1.x 读 ~/.dsh/settings.yaml；0.2.0 该文件已被移除）——
try {
  const sa = await bundle('src/adapter/subagent.ts', join(fixture, 'subagent.mjs'));
  console.log('=== 1) listAllEndpoints()（真实 DSH_HOME） ===');
  const eps = await sa.listAllEndpoints();
  console.log('endpoints: ' + eps.length);
  for (const e of eps) {
    // 只打端点元信息，绝不打印 key
    console.log('  - provider=' + e.providerName + ' model=' + e.model + ' baseURL=' + e.baseURL + ' keyEnv=' + (e.apiKeyEnv || '-'));
  }
} catch (e) { console.log('settings probe throw: ' + e.message); }

// —— 2) 会话读取（v4 文件名缺口 + 多帧 zstd 只解第一帧）——
try {
  const se = await bundle('src/adapter/sessions.ts', join(fixture, 'sessions.mjs'));
  console.log('=== 2) listSessions()（真实会话根目录） ===');
  const list = await se.listSessions('D:\\workspace\\pluginspace');
  console.log('listed: ' + (list ? list.length : 'null'));
  for (const s of (list || [])) console.log('  - ' + s.id);

  console.log('=== 3) readSessionContent() 抽测 ===');
  const tryRead = async (id) => {
    try {
      const c = await se.readSessionContent(id, 3, 'D:\\workspace\\pluginspace');
      if (c === null) return 'null（文件未命中）';
      return 'len=' + c.length + ' head=' + JSON.stringify(c.slice(0, 60));
    } catch (e) { return 'throw: ' + e.message; }
  };
  console.log('  bcffb1e5（仅v4，当前会话）: ' + await tryRead('session-bcffb1e5-9703-47cc-9a7c-91041c58b76b'));
  console.log('  b54666a9（v3+v4，2MB/640帧）: ' + await tryRead('session-b54666a9-fc98-4077-a99b-9032ac6b3249'));
  console.log('  bb7b053a（v3，7MB/4189帧）: ' + await tryRead('session-bb7b053a-af3d-4df0-ad42-7665b6a13fe4'));
} catch (e) { console.log('sessions probe throw: ' + e.message); }

// —— 3) 修复可行性：yaml-lite vs 真实 cordis.patch.yml（llm-pi-ai 条目已在 patch 层）——
try {
  const yl = await bundle('src/adapter/yaml-lite.ts', join(fixture, 'yaml.mjs'));
  console.log('=== 4) yaml-lite 解析真实 cordis.patch.yml ===');
  const patchText = readFileSync('C:\\Users\\lmz\\.dsh\\profiles\\web\\cordis.patch.yml', 'utf8');
  let parsed = null, err = null;
  try { parsed = yl.parse(patchText); } catch (e) { err = e.message; }
  if (err) { console.log('parse THROW: ' + err); }
  else {
    console.log('top-type: ' + (Array.isArray(parsed) ? 'array(' + parsed.length + ')' : typeof parsed));
    const entry = Array.isArray(parsed) ? parsed.find((x) => x && x.id === 'llm-pi-ai') : null;
    if (!entry) console.log('llm-pi-ai entry: NOT FOUND');
    else {
      const provs = entry.config && entry.config.providers;
      const cm = provs ? provs['custom-model'] : null;
      console.log('provider keys: ' + (provs ? Object.keys(provs).join(',') : 'none'));
      if (cm) {
        console.log('custom-model: baseURL=' + cm.baseURL + ' apiKeyEnv=' + cm.apiKeyEnv + ' api=' + (cm.api || '-') + ' models=' + (cm.models ? cm.models.length : 'none'));
        if (cm.models) console.log('model ids: ' + cm.models.map((m) => m.id || m.name).join(', '));
        if (cm.models) console.log('input 标注: ' + cm.models.filter((m) => Array.isArray(m.input)).map((m) => (m.id || m.name) + ':' + m.input.join('+')).join(', '));
      }
    }
  }
} catch (e) { console.log('yaml probe throw: ' + e.message); }
