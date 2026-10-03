"use strict";
var DagFlowSidebar = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/sidebar.ts
  var sidebar_exports = {};
  __export(sidebar_exports, {
    ENTRY_ATTR: () => ENTRY_ATTR,
    mountSidebarEntry: () => mountSidebarEntry
  });
  var ENTRY_ATTR = "data-dag-flow-entry";
  var ENTRY_SELECTOR = `[${ENTRY_ATTR}]`;
  var ENTRY_LABEL_ATTR = "data-dag-flow-entry-label";
  var ENTRY_ICON_ATTR = "data-dag-flow-entry-icon";
  var HOST_MARGIN_EXPANDED = "0 2px 12px";
  var HOST_MARGIN_COLLAPSED = "0 0 12px";
  var FALLBACK_CONTENT_GAP = "6px";
  var ENTRY_STYLE_ID = "dag-flow-entry-style";
  var entry = null;
  function hostContentOf(btn) {
    return btn.querySelector('[class*="newSessionContent"]') ?? void 0;
  }
  function ensureInjectedStyles() {
    if (document.getElementById(ENTRY_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = ENTRY_STYLE_ID;
    tag.textContent = `${ENTRY_SELECTOR}[data-sidebar-collapsed="true"]{background:transparent!important;border-color:transparent!important}`;
    document.head.appendChild(tag);
  }
  function copyStyleFrom(btn, target) {
    try {
      const cs = getComputedStyle(btn);
      const props = [
        "backgroundColor",
        "color",
        "fontSize",
        "fontWeight",
        "fontFamily",
        "boxShadow",
        "height",
        "lineHeight"
      ];
      for (const p of props) {
        const v = cs[p];
        if (v && v !== "none" && v !== "normal") target.style[p] = v;
      }
      target.style.padding = cs.padding && cs.padding !== "0px" ? cs.padding : "8px 12px";
      target.style.boxSizing = "border-box";
      target.style.border = cs.border && cs.borderStyle !== "none" ? cs.border : "none";
      target.style.background = cs.backgroundImage !== "none" ? cs.background : cs.backgroundColor;
      if (cs.borderRadius && cs.borderRadius !== "0px") target.style.borderRadius = cs.borderRadius;
      target.style.display = "flex";
      target.style.justifyContent = "center";
      target.style.alignItems = "center";
      const hostContent = hostContentOf(btn);
      const contentGap = hostContent ? getComputedStyle(hostContent).gap : "";
      target.style.gap = contentGap && contentGap !== "normal" ? contentGap : FALLBACK_CONTENT_GAP;
      target.style.cursor = "pointer";
      target.style.transition = "background 0.15s";
    } catch {
    }
  }
  function sidebarIsCollapsed(root) {
    return root.matches('[class*="collapsed"], [data-sidebar-collapsed="true"]') || root.closest('[data-sidebar-collapsed="true"]') !== null || root.getBoundingClientRect().width <= 80;
  }
  function syncEntryLayout(root) {
    if (!entry) return;
    const collapsed = sidebarIsCollapsed(root);
    entry.dataset.sidebarCollapsed = collapsed ? "true" : "false";
    entry.style.alignSelf = collapsed ? "flex-start" : "stretch";
    entry.style.justifyContent = "center";
    entry.style.width = collapsed ? "36px" : "";
    entry.style.height = collapsed ? "36px" : entry.style.height || "auto";
    entry.style.padding = collapsed ? "0" : entry.style.padding || "8px 12px";
    entry.style.margin = collapsed ? HOST_MARGIN_COLLAPSED : HOST_MARGIN_EXPANDED;
    const label = entry.querySelector(`[${ENTRY_LABEL_ATTR}]`);
    if (label) label.hidden = collapsed;
    const icon = entry.querySelector(`[${ENTRY_ICON_ATTR}]`);
    if (icon) {
      const size = collapsed ? "18px" : "14px";
      icon.style.width = size;
      icon.style.height = size;
    }
  }
  function buildEntryInner(label) {
    const svg = '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><circle cx="17.5" cy="6.5" r="2.5"></circle><path d="M10 6.5h5M10 17.5h1.5M17.5 9v5"></path></svg>';
    return `<span aria-hidden="true" ${ENTRY_ICON_ATTR} style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;">${svg}</span><span ${ENTRY_LABEL_ATTR} style="white-space:nowrap;">${label}</span>`;
  }
  function sidebarRoot() {
    const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
    if (!column) return void 0;
    const logoOwner = column.querySelector('[class*="logoRow"]')?.parentElement;
    return logoOwner ?? column.firstElementChild;
  }
  function newSessionButton(root) {
    const nested = root.querySelector('button[class*="newSession"]');
    if (nested) return nested;
    for (const child of root.children) {
      if (child.tagName === "BUTTON") return child;
    }
    return void 0;
  }
  function placeEntry(root) {
    if (!entry) return false;
    const button = newSessionButton(root);
    if (!button) return false;
    if (entry.parentElement !== root) {
      copyStyleFrom(button, entry);
      const row = button.closest('[class*="logoRow"]');
      const base = row !== null && row.parentElement === root ? row : button;
      root.insertBefore(entry, base.nextElementSibling);
    }
    return true;
  }
  function mountSidebarEntry(onClick, label = "\u5DE5\u4F5C\u6D41") {
    if (document.querySelector(ENTRY_SELECTOR)) return () => {
    };
    ensureInjectedStyles();
    entry = document.createElement("button");
    entry.type = "button";
    entry.setAttribute(ENTRY_ATTR, "");
    entry.setAttribute("aria-label", label);
    entry.title = "\u6253\u5F00 / \u65B0\u5EFA\u5DE5\u4F5C\u6D41";
    entry.innerHTML = buildEntryInner(label);
    entry.addEventListener("mouseenter", () => {
      if (entry) entry.style.filter = "brightness(1.15)";
    });
    entry.addEventListener("mouseleave", () => {
      if (entry) entry.style.filter = "";
    });
    entry.addEventListener("click", onClick);
    let root;
    let placed = false;
    let observedRoot;
    const resizeObserver = new ResizeObserver(() => {
      if (root) syncEntryLayout(root);
    });
    const stateObserver = new MutationObserver(() => {
      if (root) syncEntryLayout(root);
    });
    const observeRoot = (next) => {
      if (observedRoot === next) return;
      resizeObserver.disconnect();
      stateObserver.disconnect();
      observedRoot = next;
      resizeObserver.observe(next);
      stateObserver.observe(next, { attributes: true, attributeFilter: ["class", "data-sidebar-collapsed"] });
    };
    const tryPlace = () => {
      if (root !== void 0 && !root.isConnected) {
        resizeObserver.disconnect();
        stateObserver.disconnect();
        observedRoot = void 0;
        root = void 0;
        placed = false;
      }
      if (placed) {
        if (entry && document.body.contains(entry)) return;
        root = void 0;
        placed = false;
      }
      root ??= sidebarRoot();
      if (root === void 0) return;
      observeRoot(root);
      placed = placeEntry(root);
      if (placed) syncEntryLayout(root);
    };
    const waitObserver = new MutationObserver(() => {
      tryPlace();
    });
    waitObserver.observe(document.body, { childList: true, subtree: true });
    tryPlace();
    return () => {
      waitObserver.disconnect();
      resizeObserver.disconnect();
      stateObserver.disconnect();
      entry?.remove();
      entry = null;
    };
  }
  return __toCommonJS(sidebar_exports);
})();
