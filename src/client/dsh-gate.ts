// @ts-nocheck
// src/client/dsh-gate.ts — 客户端防腐层（Anti-Corruption Layer）
//
// ★ 客户端侧所有「接触 DSH 宿主」的形状假设收敛在本文件：
//   1. inject 名单（slots / layout）——cordis 客户端 inject 校验同 host 侧；
//   2. ctx.slots 契约：inject(slotName, fn) / register(options, component) / entries(slotName)；
//   3. ctx.layout 契约：selectPanel(panelKey)（main 区面板切换，key 必须先注册）；
//   4. main 区 keyed-slot 注册形态（generator + yield，照抄 dsh-client-ui-plugin-manager 成功形态；
//      注册未生效时 selectPanel 抛 "main panel ... not registered"，2026-10-01 真机踩坑）；
//   5. settings.section 分区注册形态；
//   6. bundle 装载协议（window.__ModuleLoader__.load({id, factory}) + react external 清单）
//      属构建期防腐点，落在 scripts/build-client.mjs 的 banner/footer/EXTERNALS——
//      DSH loader 协议变化时改那里，本文件只做运行期形状假设。
//
// 侧栏 DOM 注入（宿主 newSession/logoRow 类名探测、computed-style 拷贝）由
// src/client/sidebar.ts 承担——它本身就是一个专职的宿主 DOM 防腐点。
//
// DSH 客户端升版改 slots/layout API 时只改本文件；FlowPanel/index.tsx 不动。

/** 客户端 inject 名单（= client/index.tsx 的 inject 数组唯一来源）。
 *  只声明实证存在的服务：slots（设置页分区/主区面板）、layout（面板切换）。 */
export const CLIENT_INJECT: string[] = ['slots', 'layout'];

/** ctx.slots 的稳定形状（业务代码只依赖本接口） */
export interface ClientSlots {
  inject: (slotName: string, fn: (this: any) => any) => unknown;
  register: (options: { name?: string; key?: string; id?: string; order?: number; label?: () => string; inject?: () => unknown }, component: any) => unknown;
  entries: (slotName: string) => { options?: { key?: string }; [k: string]: unknown }[];
}

/** ctx.layout 的稳定形状 */
export interface ClientLayout {
  selectPanel: (panelKey: string) => unknown;
}

/** 客户端宿主句柄（DSH loader 注入的 ctx，形状只在探测函数里假设） */
export type ClientHost = unknown;

/** 探测 ctx.slots：形状不符返回 undefined（调用方降级/告警）。
 *  之前版本在这里吃过的亏：inject 了宿主没有的服务 → 抛错被 mountContribution
 *  路径 catch 不住 → 整个插件静默失败——所以探测必须逐个函数形状校验。 */
export function probeSlots(ctx: ClientHost): ClientSlots | undefined {
  try {
    const slots = (ctx as any)?.slots;
    if (!slots) return undefined;
    if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return undefined;
    return slots as ClientSlots;
  } catch {
    return undefined;
  }
}

/** 探测 ctx.layout：selectPanel 可用返回形状，否则 undefined（停靠切换降级为不可用）。 */
export function probeLayout(ctx: ClientHost): ClientLayout | undefined {
  try {
    const layout = (ctx as any)?.layout;
    if (layout && typeof layout.selectPanel === 'function') return layout as ClientLayout;
  } catch { /* 忽略 */ }
  return undefined;
}

/** 注册设置页分区（settings.section 槽位）。失败仅告警，不阻塞其他注册。 */
export function registerSettingsSection(
  ctx: ClientHost,
  spec: { id: string; order?: number; label: string },
  component: any,
  log = console.warn,
): boolean {
  const slots = probeSlots(ctx);
  if (!slots) return false;
  try {
    slots.inject('settings.section', () =>
      slots.register(
        { id: spec.id, name: 'settings.section', order: spec.order ?? 80, label: () => spec.label },
        component,
      ),
    );
    return true;
  } catch (e) {
    log(`[dag-flow] settings.section inject failed: ${e}`);
    return false;
  }
}

/**
 * 注册主区停靠面板（keyed main 槽，与 conversation/plugins 同机制）。
 * 形态照抄 dsh-client-ui-plugin-manager 的成功形态（generator + yield）；
 * key 对应 layout.selectPanel 的面板 key。
 */
export function registerMainPanel(
  ctx: ClientHost,
  spec: { key: string },
  component: any,
  log = console.warn,
): boolean {
  const slots = probeSlots(ctx);
  if (!slots) return false;
  try {
    slots.inject('main', function* () {
      yield slots.register({ name: 'main', key: spec.key, inject: () => ({}) }, component);
    });
    return true;
  } catch (e) {
    log(`[dag-flow] main dock inject failed: ${e}`);
    return false;
  }
}

/** 诊断：dump main 槽当前已注册的 key（真机排障用；失败不影响注册）。 */
export function dumpMainPanelKeys(ctx: ClientHost, tag: string, log = console.log): void {
  try {
    const slots = probeSlots(ctx);
    const keys = (slots?.entries('main') ?? []).map((e) => e?.options?.key).filter(Boolean);
    log(`[dag-flow] main slot keys(${tag}):`, keys.join(', ') || '(none)');
  } catch { /* 诊断失败不影响注册 */ }
}

/** 面板切换（停靠画布 ⇄ 会话）。layout 不可用时静默失败（按钮点了无反应即此形态）。 */
export function selectPanel(ctx: ClientHost | undefined | null, panelKey: string): void {
  const layout = ctx ? probeLayout(ctx) : undefined;
  if (!layout) return;
  try {
    layout.selectPanel(panelKey);
  } catch (e) {
    console.warn(`[dag-flow] selectPanel(${panelKey}) failed: ${e}`);
  }
}
