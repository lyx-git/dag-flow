"use strict";
var DagFlowPicker = (() => {
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

  // src/client/workflow-picker.ts
  var workflow_picker_exports = {};
  __export(workflow_picker_exports, {
    openWorkflowPicker: () => openWorkflowPicker
  });

  // src/name-rule.ts
  function normalizeWorkflowName(raw) {
    return raw.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  }

  // src/client/workflow-picker.ts
  var API = "/api/dag-flow/workflows";
  var PICKER_CSS_ID = "dag-flow-picker-styles";
  var PICKER_CSS = `
.dag-flow-picker-overlay { position: fixed; inset: 0; z-index: 10000; display: flex;
  align-items: flex-start; justify-content: center; padding-top: 14vh;
  background: rgba(4, 9, 20, 0.55); backdrop-filter: blur(2px); }
.dag-flow-picker { width: 680px; max-width: calc(100vw - 40px); border-radius: 14px;
  background: var(--wf-panel, #101a2b); border: 1px solid var(--wf-border-strong, #2a3a56);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45); overflow: hidden;
  font-family: inherit; color: var(--wf-text, #e6edf7); }
.dag-flow-picker-title { padding: 16px 20px 10px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; gap: 8px; }
.dag-flow-picker-body { padding: 4px 20px 16px; position: relative; }
.dag-flow-picker-hint { font-size: 12px; color: var(--wf-muted, #8b9bb3); margin: 2px 0 10px; line-height: 1.6; }
.dag-flow-combo { position: relative; }
.dag-flow-combo input { width: 100%; box-sizing: border-box; padding: 10px 14px; border-radius: 8px;
  border: 1px solid var(--wf-border, #22304a); background: var(--wf-bg, #0b1120);
  color: var(--wf-text, #e6edf7); font-size: 14px; outline: none;
  font-family: ui-monospace, Consolas, monospace; }
.dag-flow-combo input:focus { border-color: var(--wf-accent, #4f8cff); }
.dag-flow-combo-list { margin-top: 4px; max-height: 170px; overflow-y: auto; border-radius: 8px;
  background: var(--wf-panel2, #162135); border: 1px solid var(--wf-border-strong, #2a3a56);
  box-shadow: var(--wf-shadow, 0 4px 16px rgba(0, 0, 0, 0.32)); }
.dag-flow-combo-list::-webkit-scrollbar { width: 8px; }
.dag-flow-combo-list::-webkit-scrollbar-track { background: transparent; }
.dag-flow-combo-list::-webkit-scrollbar-thumb { background: var(--wf-border-strong, #2a3a56); border-radius: 4px; }
.dag-flow-combo-list::-webkit-scrollbar-thumb:hover { background: var(--wf-accent, #4f8cff); }
.dag-flow-combo-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  font-size: 12px; line-height: 20px; cursor: pointer; color: var(--wf-text, #e6edf7);
  max-height: 40px; overflow: hidden;
  transition: opacity 0.15s ease, max-height 0.15s ease, padding 0.15s ease; }
.dag-flow-combo-row.del-out { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.dag-flow-combo-row:hover, .dag-flow-combo-row.hl { background: color-mix(in srgb, var(--wf-accent, #4f8cff) 16%, transparent); }
.dag-flow-combo-row .meta { color: var(--wf-muted, #8b9bb3); font-size: 11px; margin-left: auto; }
.dag-flow-combo-row .del { margin-left: 6px; flex: none; width: 22px; height: 22px; border-radius: 6px;
  border: none; background: transparent; color: var(--wf-muted, #8b9bb3); cursor: pointer;
  font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.dag-flow-combo-row .del:hover { background: color-mix(in srgb, var(--wf-danger, #f87171) 18%, transparent);
  color: var(--wf-danger, #f87171); }
.dag-flow-combo-row.confirming { background: color-mix(in srgb, var(--wf-danger, #f87171) 12%, transparent); }
.dag-flow-combo-row .confirm-text { color: var(--wf-danger, #f87171); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-flow-combo-row .confirm-btn { flex: none; padding: 3px 10px; border-radius: 6px; font-size: 11px;
  cursor: pointer; line-height: 1.4; }
.dag-flow-combo-row .confirm-btn.del-no { background: var(--wf-panel2, #162135);
  border: 1px solid var(--wf-border-strong, #2a3a56); color: var(--wf-text, #e6edf7); }
.dag-flow-combo-row .confirm-btn.del-yes { background: var(--wf-danger, #f87171); color: #fff; border: none; font-weight: 600; }
.dag-flow-combo-row.create { color: var(--wf-accent, #4f8cff); font-weight: 600; }
.dag-flow-combo-empty { padding: 8px 10px; font-size: 12px; color: var(--wf-muted, #8b9bb3); }
.dag-flow-picker-err { color: var(--wf-danger, #f87171); font-size: 11px; margin-top: 6px; min-height: 14px; }
.dag-flow-picker-close { margin-left: auto; flex: none; width: 26px; height: 26px; border-radius: 8px;
  border: none; background: transparent; color: var(--wf-muted, #8b9bb3); cursor: pointer;
  font-size: 13px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.dag-flow-picker-close:hover { background: color-mix(in srgb, var(--wf-accent, #4f8cff) 16%, transparent);
  color: var(--wf-text, #e6edf7); }
`;
  function ensurePickerStyles() {
    if (document.getElementById(PICKER_CSS_ID)) return;
    const s = document.createElement("style");
    s.id = PICKER_CSS_ID;
    s.textContent = PICKER_CSS;
    document.head.appendChild(s);
  }
  function minimalWorkflow(name) {
    return {
      name,
      version: 1,
      nodes: [
        { id: "start", type: "start", next: "end" },
        { id: "end", type: "end" }
      ]
    };
  }
  async function fetchJson(url, init) {
    const res = await fetch(url, { credentials: "include", ...init });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${res.status}\uFF09${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    return res.json();
  }
  function openWorkflowPicker(onOpen) {
    if (document.querySelector(".dag-flow-picker-overlay")) return;
    ensurePickerStyles();
    const overlay = document.createElement("div");
    overlay.className = "dag-flow-picker-overlay";
    const card = document.createElement("div");
    card.className = "dag-flow-picker";
    card.innerHTML = `
    <div class="dag-flow-picker-title">\u26A1 \u6253\u5F00 / \u65B0\u5EFA\u5DE5\u4F5C\u6D41<button class="dag-flow-picker-close" type="button" title="\u5173\u95ED (Esc)">\u2715</button></div>
    <div class="dag-flow-picker-body">
      <div class="dag-flow-picker-hint">\u4E0B\u62C9\u9009\u62E9\u5DF2\u6709\u5DE5\u4F5C\u6D41\u6253\u5F00\uFF1B\u8F93\u5165\u540D\u79F0\u540E\u56DE\u8F66\u521B\u5EFA\uFF08\u652F\u6301\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57/\u8FDE\u5B57\u7B26\uFF09\u3002</div>
      <div class="dag-flow-combo">
        <input type="text" placeholder="\u8F93\u5165\u540D\u79F0\uFF0C\u6216 \u2193 \u9009\u62E9\u5DF2\u6709\u5DE5\u4F5C\u6D41" maxlength="64" autocomplete="off">
        <div class="dag-flow-combo-list" style="display:none"></div>
      </div>
      <div class="dag-flow-picker-err"></div>
    </div>`;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    card.querySelector(".dag-flow-picker-close").addEventListener("click", close);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc);
      }
    });
    const body = card.querySelector(".dag-flow-picker-body");
    const input = body.querySelector("input");
    const listBox = body.querySelector(".dag-flow-combo-list");
    const err = body.querySelector(".dag-flow-picker-err");
    let workflows = [];
    let hlIndex = -1;
    let busy = false;
    let listLoadFailed = false;
    const setOpenErr = (msg) => {
      err.textContent = msg;
    };
    const openExisting = async (name) => {
      busy = true;
      try {
        const data = await fetchJson(`${API}/${encodeURIComponent(name)}`);
        close();
        onOpen(data.workflow);
      } catch (e) {
        busy = false;
        setOpenErr(`\u8BFB\u53D6\u5931\u8D25\uFF1A${e.message}`);
      }
    };
    const createNew = async (rawName) => {
      const name = normalizeWorkflowName(rawName);
      if (!name) {
        setOpenErr("\u540D\u79F0\u4E3A\u7A7A\uFF08\u652F\u6301\u4E2D\u6587/\u5B57\u6BCD/\u6570\u5B57/\u8FDE\u5B57\u7B26\uFF09");
        return;
      }
      busy = true;
      try {
        if (listLoadFailed) {
          const probe = await fetch(`${API}/${encodeURIComponent(name)}`, { credentials: "include" });
          if (probe.ok) {
            const data2 = await probe.json();
            close();
            onOpen(data2.workflow);
            return;
          }
        }
        const def = minimalWorkflow(name);
        const data = await fetchJson(`${API}/save`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, def })
        });
        close();
        onOpen({ ...def, name: data.name ?? name });
      } catch (e) {
        busy = false;
        setOpenErr(`\u521B\u5EFA\u5931\u8D25\uFF1A${e.message}`);
      }
    };
    const buildRowInner = (row, w) => {
      row.classList.remove("confirming");
      row.dataset.name = w.name;
      row.innerHTML = `\u{1F4C4} ${w.name} <span class="meta">${w.nodes} \u8282\u70B9</span>`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.title = `\u5220\u9664\u300C${w.name}\u300D`;
      del.textContent = "\u{1F5D1}";
      del.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        enterConfirm(row, w);
      });
      row.appendChild(del);
    };
    const enterConfirm = (row, w) => {
      row.classList.add("confirming");
      row.innerHTML = "";
      const text = document.createElement("span");
      text.className = "confirm-text";
      text.textContent = `\u5220\u9664\u300C${w.name}\u300D\uFF1F`;
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "confirm-btn del-yes";
      yes.textContent = "\u5220\u9664";
      yes.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      yes.addEventListener("click", (e) => {
        e.stopPropagation();
        void deleteWorkflow(w).then((ok) => {
          if (!ok) buildRowInner(row, w);
        });
      });
      const no = document.createElement("button");
      no.type = "button";
      no.className = "confirm-btn del-no";
      no.textContent = "\u53D6\u6D88";
      no.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
      no.addEventListener("click", (e) => {
        e.stopPropagation();
        buildRowInner(row, w);
      });
      row.append(text, no, yes);
    };
    const deleteWorkflow = async (w) => {
      try {
        const res = await fetch(`${API}/${encodeURIComponent(w.name)}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) {
          const body2 = await res.text().catch(() => "");
          throw new Error(`\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${res.status}\uFF09${body2 ? `: ${body2.slice(0, 120)}` : ""}`);
        }
        workflows = workflows.filter((x) => x.name !== w.name);
        const rowEl = Array.from(listBox.querySelectorAll(".dag-flow-combo-row")).find((r) => r.dataset.name === w.name);
        if (rowEl) {
          rowEl.classList.add("del-out");
          setTimeout(() => {
            rowEl.remove();
          }, 170);
        }
        return true;
      } catch (e) {
        setOpenErr(`\u5220\u9664\u5931\u8D25\uFF1A${e.message}`);
        return false;
      }
    };
    const renderList = () => {
      const text = normalizeWorkflowName(input.value);
      const matches = workflows.filter((w) => !text || w.name.includes(text));
      const exact = workflows.find((w) => w.name === text);
      const rows = [];
      if (text && !exact) {
        const create = document.createElement("div");
        create.className = "dag-flow-combo-row create";
        create.innerHTML = `\u2795 \u521B\u5EFA\u300C${text}\u300D`;
        create.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void createNew(text);
        });
        rows.push(create);
      }
      for (const w of matches.slice(0, 30)) {
        const row = document.createElement("div");
        row.className = "dag-flow-combo-row";
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void openExisting(w.name);
        });
        buildRowInner(row, w);
        rows.push(row);
      }
      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dag-flow-combo-empty";
        empty.textContent = text ? "\u65E0\u5339\u914D\u2014\u2014\u56DE\u8F66\u521B\u5EFA" : "\u5DE5\u4F5C\u533A\u6682\u65E0\u5DE5\u4F5C\u6D41\u2014\u2014\u8F93\u5165\u540D\u79F0\u521B\u5EFA\u7B2C\u4E00\u4E2A";
        rows.push(empty);
      }
      listBox.innerHTML = "";
      rows.forEach((r) => listBox.appendChild(r));
      hlIndex = -1;
    };
    const showList = () => {
      renderList();
      listBox.style.display = "block";
    };
    const hideList = () => {
      listBox.style.display = "none";
    };
    input.addEventListener("focus", showList);
    input.addEventListener("input", () => {
      setOpenErr("");
      showList();
    });
    input.addEventListener("blur", () => setTimeout(hideList, 150));
    input.addEventListener("keydown", (e) => {
      const rows = [...listBox.querySelectorAll(".dag-flow-combo-row")];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!rows.length) return;
        hlIndex = e.key === "ArrowDown" ? Math.min(hlIndex + 1, rows.length - 1) : Math.max(hlIndex - 1, 0);
        rows.forEach((r, i) => r.classList.toggle("hl", i === hlIndex));
        rows[hlIndex]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = hlIndex >= 0 ? rows[hlIndex] : rows.find((r) => r.classList.contains("create")) ?? rows[0];
        target?.dispatchEvent(new Event("mousedown"));
      }
    });
    fetchJson(API).then((data) => {
      workflows = data.workflows ?? [];
      input.focus();
      if (listBox.style.display !== "none") renderList();
    }).catch((e) => {
      listLoadFailed = true;
      setOpenErr(`\u67E5\u8BE2\u5931\u8D25\uFF1A${e.message}\uFF08\u4ECD\u53EF\u8F93\u5165\u540D\u79F0\u521B\u5EFA\uFF09`);
    });
  }
  return __toCommonJS(workflow_picker_exports);
})();
