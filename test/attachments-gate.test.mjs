// test/attachments-gate.test.mjs — 多模态 Step 0：宿主附件服务门面的契约（2026-10-15）
//   为什么需要它：Step 0 的交付物＝「inject 名单加 attachments」+「启动时打一行只读诊断」。
//   真机到底能不能打出 `attachments ok (...)` 要等重启 dsh web 才知道（本机不能自动重启宿主），
//   所以这里把**诊断函数本身的正确性**离线钉死：可用 / 不可用 / 半可用（缺方法）/ 缺限制 /
//   ctx 抛错 五条分支的文案与容错——重启后的日志行才有可解读的语义。
//   手段：esbuild 即时打包（经临时 wrapper 把 host.setHost 与 attachments 门面打进**同一个模块实例**），
//   再用伪造的 0.2.0 ctx 驱动。纯模块、无 React/DOM/网络。
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'df-attgate-'));
const wrapper = join(dir, 'entry.mjs');
writeFileSync(wrapper, [
  `export { setHost, HOST_INJECT } from ${JSON.stringify(join(ROOT, 'src/dsh-gate/host.ts'))};`,
  `export { hostAttachments, describeAttachments } from ${JSON.stringify(join(ROOT, 'src/dsh-gate/attachments.ts'))};`,
].join('\n'));
const OUT = join(dir, 'gate.mjs');
await build({ entryPoints: [wrapper], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { setHost, HOST_INJECT, hostAttachments, describeAttachments } = await import(pathToFileURL(OUT).href);

/** 伪造 0.2.0 cordis ctx：只有 get 可用（其余裸属性访问会抛 inject 错，这里不需要） */
const fakeCtx = (services) => ({ get: (name) => services[name] });

const LIMITS = {
  maxImageBytes: 10485760,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 20971520,
  maxImagePixels: 40000000,
  maxImageDimension: 8000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

console.log('== A. inject 名单（Step 0 的唯一接线改动）==');
{
  ok(HOST_INJECT.includes('attachments'), `A1. HOST_INJECT 含 attachments（实测 ${JSON.stringify(HOST_INJECT)}）`);
  ok(HOST_INJECT.length === new Set(HOST_INJECT).size, 'A2. 名单无重复项');
  // ★ 名单 = index.ts 的 inject：加名字前必须确认宿主确有该服务，否则插件永不 apply（cordis 无 optional inject）。
  //   本机证据：dsh-base 的 cordis.patch.yml 挂了 `- id: attachment-local`；且 read_image 工具只在
  //   ctx.inject(['attachments']) 下注册（能调 ⇒ 服务在）。这条断言只锁"名字写对了"。
  ok(HOST_INJECT.includes('attachments') && HOST_INJECT.includes('llm'), 'A3. attachments 与 llm 并存（llm 的 viaHost 通路要往 messages 里塞 image 块）');
}

console.log('== B. 未接宿主 / 服务缺失 ==');
{
  setHost(null);
  ok(hostAttachments() === undefined, 'B1. 未 apply 时取不到服务（返回 undefined，不抛）');
  ok(describeAttachments() === 'attachments unavailable', `B2. 文案 = attachments unavailable（实测 "${describeAttachments()}"）`);

  setHost(fakeCtx({}));
  ok(hostAttachments() === undefined, 'B3. 宿主没挂该服务时同样 undefined（不误报可用）');
}

console.log('== C. 服务可用（含限制）==');
{
  setHost(fakeCtx({ attachments: { saveImage: async () => ({}), saveImages: async () => [], imageLimits: LIMITS } }));
  const svc = hostAttachments();
  ok(!!svc && typeof svc.saveImage === 'function', 'C1. 取得到服务与 saveImage');
  const line = describeAttachments();
  ok(line === 'attachments ok (saveImage+saveImages; png/jpeg/webp/gif; maxImagesPerMessage=4, maxImageBytes=10485760, maxImageDimension=8000)',
    `C2. ★诊断行格式确定（真机日志按这行判读）：${line}`);
  ok(line.includes('image/') === false, 'C3. mediaTypes 去掉 `image/` 前缀（日志更短）');
}

console.log('== D. 半可用 / 缺限制（宿主改 API 时不误报）==');
{
  setHost(fakeCtx({ attachments: { saveImages: async () => [] } }));
  ok(describeAttachments() === 'attachments ok (saveImages; limits unknown)',
    `D1. 只有 saveImages 且无 limits → ${describeAttachments()}`);

  setHost(fakeCtx({ attachments: { imageLimits: LIMITS } }));
  ok(describeAttachments().includes('no-writer'), `D2. 服务在但没有写方法 → 标 no-writer（实测 ${describeAttachments()}）`);

  setHost(fakeCtx({ attachments: { saveImage: async () => ({}), imageLimits: { ...LIMITS, mediaTypes: [] } } }));
  ok(describeAttachments().includes('; ?;'), `D3. mediaTypes 为空 → 问号占位（不编默认值）（实测 ${describeAttachments()}）`);
}

console.log('== E. 宿主异常不能把启动带崩 ==');
{
  setHost({ get: () => { throw new Error('cannot get property "attachments" without inject'); } });
  let threw = null;
  try { ok(describeAttachments() === 'attachments unavailable', 'E1. ctx.get 抛 inject 错 → 仍给 unavailable 文案'); } catch (e) { threw = e; }
  ok(!threw, `E2. ★诊断绝不抛错（fail-soft；实测 ${threw ? String(threw) : '未抛'}）`);
  let threw2 = null;
  try { ok(hostAttachments() === undefined, 'E3. hostService 抛错时门面仍返回 undefined'); } catch (e) { threw2 = e; }
  ok(!threw2, 'E4. 门面也不抛（宿主升版不该拖垮插件）');
}

console.log(`\n=== 附件门面契约：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
