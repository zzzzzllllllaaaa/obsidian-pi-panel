/**
 * 冒烟测试：pi-panel 的「AI 操作记录」面板在 deferred leaf 下能不能被建出来并渲染。
 * 不需要真 Obsidian：把 require("obsidian") 指向桩，跑 onload + refreshOpsViews。
 *
 * 跑法：node _ops_smoke.js H:/kaifa/obsidian-pi-panel/main.js F:/obsidianwenjian/.obsidian/plugins/pi-panel/data.json
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");

const bundlePath = process.argv[2];
const dataPath = process.argv[3];

// 浏览器全局（插件里用 window.setTimeout / addEventListener）
global.window = global.window || {};
global.window.setTimeout = setTimeout;
global.window.clearTimeout = clearTimeout;
global.window.setInterval = setInterval;
global.window.clearInterval = clearInterval;
global.window.addEventListener = () => {};
global.document = global.document || { createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }), body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {} };
global.localStorage = global.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

// ── 桩 ────────────────────────────────────────────────────────────────
const created = { views: [], events: [], setViewState: [], logs: [] };

class Events {
  constructor() { this.h = {}; }
  on(name, cb) { (this.h[name] = this.h[name] || []).push(cb); return { name, cb }; }
  off() {}
  trigger(name, ...a) { (this.h[name] || []).forEach((f) => f(...a)); }
}

class TFile {
  constructor(p, c) { this.path = p; this._c = c || ""; }
}

class WorkspaceLeaf {
  constructor(stateType, deferred) {
    this.stateType = stateType;
    this.deferred = deferred;
    // deferred 视图：getViewType() 直接返回延后的类型，但身上没有任何方法（真实现象）
    this.view = deferred ? { getViewType: () => stateType } : null;
  }
  getViewState() { return { type: this.stateType, state: {} }; }
  async setViewState(s) {
    created.setViewState.push(s.type);
    if (this.leafHost) await this.leafHost.instantiate(this, s.type);
  }
}

class View {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.hostApp; this.contentEl = makeEl(); }
  getViewType() { return this.constructor.VIEW_TYPE; }
  async onOpen() {}
  async onClose() {}
}

class ItemView extends View {}

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  registerView(type, fn) { this._views = this._views || {}; this._views[type] = fn; }
  registerViewType() {}
  registerEvent(e) { created.events.push(e); }
  registerInterval() {}
  addRibbonIcon() {}
  addCommand(c) { (this._cmds = this._cmds || []).push(c); }
  addSettingTab(t) { this._tab = t; }
  async loadData() { return JSON.parse(fs.readFileSync(dataPath, "utf8")); }
  async saveData(d) { this._saved = d; }
}

const makeEl = () => ({
  children: [], cls: "", text: "",
  empty() { this.children = []; },
  createDiv(o) { const e = makeEl(); e.cls = o && o.cls ? o.cls : (typeof o === "string" ? o : ""); e.text = (o && o.text) || ""; this.children.push(e); return e; },
  createSpan(o) { return this.createDiv(o); },
  createEl(t, o) { return this.createDiv(o); },
  addClass(c) { this.cls += " " + c; },
  setText(t) { this.text = t; },
  setAttr() {}, addEventListener() {}, toggleClass() {}, setCssProps() {},
});
const setIcon = () => {};
const noop = function () {};
class Setting { constructor() {} setName() { return this; } setDesc() { return this; } addText() { return this; } addTextArea() { return this; } addToggle() { return this; } addDropdown() { return this; } addButton() { return this; } addExtraButton() { return this; } setValue() { return this; } onChange() { return this; } setPlaceholder() { return this; } setDisabled() { return this; } }
class Modal { constructor() {} open() {} close() {} }
class PluginSettingTab {}
class Notice { constructor(m) { created.logs.push(String(m)); } }
const Platform = { isWin: true, isMacOS: false, isLinux: false, isMobile: false };
const requestUrl = async () => ({ status: 200, json: {} });

const obsidianStub = {
  App: class {}, Plugin, ItemView, View, WorkspaceLeaf, TFile, Setting, Modal,
  PluginSettingTab, Notice, Platform, EventRef: class {}, setIcon, requestUrl,
  normalizePath: (p) => p, debounce: (f) => f, addIcon: () => {}, moment: () => ({}),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "obsidian") return obsidianStub;
  if (req === "electron") return { clipboard: { writeText() {} } };
  return origLoad.apply(this, arguments);
};

// ── 假 workspace ──────────────────────────────────────────────────────
const vaultEvents = new Events();
const opsLeaf = new WorkspaceLeaf("pi-ops-view", true);
const otherLeaf = new WorkspaceLeaf("file-explorer", false);

const viewRegistry = {};
const host = {
  instantiate: async (leaf, type) => {
    const maker = viewRegistry[type];
    if (!maker) { created.logs.push("!! 没有注册 " + type); return; }
    const v = maker(leaf);
    leaf.view = v;
    await v.onOpen();
    leaf.loaded = true;
  },
};

opsLeaf.leafHost = host;
opsLeaf.hostApp = null;

const app = {
  vault: Object.assign(vaultEvents, {
    cachedRead: async (f) => f._c,
    getAbstractFileByPath: () => null,
    adapter: { getBasePath: () => "F:\\obsidianwenjian" },
  }),
  workspace: {
    iterateAllLeaves: (cb) => [opsLeaf, otherLeaf].forEach(cb),
    getLeavesOfType: (t) => [opsLeaf, otherLeaf].filter((l) => l.getViewState().type === t && l.view && l.loaded),
    getRightLeaf: () => new WorkspaceLeaf("empty", false),
    revealLeaf: () => {},
    onLayoutReady: (cb) => cb(),
    on: () => ({}),
    getActiveFile: () => null,
  },
};

// ── 加载插件 ──────────────────────────────────────────────────────────
const mod = require(bundlePath);
const PluginClass = mod.default || mod;

(async () => {
  const plugin = new PluginClass(app, { version: "0.6.0" });
  // 捕获注册的 view creator
  const origRegister = plugin.registerView.bind(plugin);
  plugin.registerView = (type, fn) => { viewRegistry[type] = fn; return origRegister(type, fn); };

  await plugin.onload();

  const entries = plugin.opsLog ? plugin.opsLog.entries.length : -1;
  const rendered = created.logs.filter((l) => l.indexOf("!!") === 0);
  console.log("opsLog 加载条数      :", entries);
  console.log("setViewState 调用    :", JSON.stringify(created.setViewState));
  console.log("deferred leaf 已实例化:", !!opsLeaf.loaded, "| view =", opsLeaf.view && opsLeaf.view.constructor && opsLeaf.view.constructor.name);
  console.log("面板 listEl 子节点数  :", opsLeaf.view && opsLeaf.view.listEl ? opsLeaf.view.listEl.children.length : "n/a");
  if (rendered.length) console.log("错误                 :", rendered.join("; "));

  // 再模拟一次 vault 变更 → 面板应自动重画
  vaultEvents.trigger("create", new TFile("小助理工作区/反馈/新笔记.md", "# hi"));
  await new Promise((r) => setTimeout(r, 50));
  console.log("变更后面板 childCount :", opsLeaf.view.listEl ? opsLeaf.view.listEl.children.length : "n/a");
  console.log("opsLog 条数(变更后)   :", plugin.opsLog.entries.length);

  const ok = opsLeaf.loaded && entries > 0;
  console.log(ok ? "SMOKE: PASS" : "SMOKE: FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("SMOKE: ERROR", e && e.stack || e); process.exit(2); });
