/**
 * 冒烟测试：pi-panel「AI 操作记录」面板在**后台 tab**下能不能出内容。
 * 不需要真 Obsidian：require("obsidian") → 桩，跑 plugin.onload() + 一次假 vault 变更。
 *
 * 后台 tab 的真实形态有两种，都测：
 *   A. deferred：leaf.view 是空壳（getViewType() 已是 pi-ops-view，但没有任何方法）
 *   B. warm-noopen：视图对象建好了、但 Obsidian 没叫 onOpen（不显示就不 open）→ DOM 没建
 *
 * 跑法（在插件仓库根）：
 *   node smoke_ops.js ./main.js <vault>/.obsidian/plugins/pi-panel/data.json [a|b|both]
 */
const Module = require("module");
const fs = require("fs");

const bundlePath = process.argv[2];
const dataPath = process.argv[3];
const mode = process.argv[4] || "both";

global.window = global.window || {};
global.window.setTimeout = setTimeout;
global.window.clearTimeout = clearTimeout;
global.window.setInterval = setInterval;
global.window.clearInterval = clearInterval;
global.window.addEventListener = () => {};
global.document = global.document || {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }),
  body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {},
};
global.localStorage = global.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

// ── 桩 ────────────────────────────────────────────────────────────────
const created = { events: [], setViewState: [], logs: [] };

class Events {
  constructor() { this.h = {}; }
  on(name, cb) { (this.h[name] = this.h[name] || []).push(cb); return { name, cb }; }
  off() {}
  trigger(name, ...a) { (this.h[name] || []).forEach((f) => f(...a)); }
}

class TFile { constructor(p, c) { this.path = p; this._c = c || ""; } }

class WorkspaceLeaf {
  constructor(stateType, kind, host) {
    this.stateType = stateType;
    this.kind = kind;           // "deferred" | "warm" | "plain"
    this.host = host;
    // deferred：有类型没方法的空壳（实测现象）
    this.view = kind === "deferred" ? { getViewType: () => stateType } : null;
  }
  getViewState() { return { type: this.stateType, state: {} }; }
  async setViewState(s) {
    created.setViewState.push(s.type);
    if (this.host) this.host.instantiate(this, s.type);   // 注意：不调 onOpen（后台 tab 就不会 open）
  }
}

const makeEl = () => ({
  children: [], cls: "", text: "", title: "",
  empty() { this.children = []; },
  createDiv(o) { const e = makeEl(); e.cls = typeof o === "string" ? o : (o && o.cls) || ""; e.text = (o && o.text) || ""; this.children.push(e); return e; },
  createSpan(o) { return this.createDiv(o); },
  createEl(t, o) { return this.createDiv(o); },
  addClass(c) { this.cls += " " + c; },
  setText(t) { this.text = t; },
  setAttr() {}, addEventListener() {}, toggleClass() {}, setCssProps() {}, remove() {},
});

class View {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.host ? leaf.host.app : null; this.contentEl = makeEl(); }
  getViewType() { return ""; }
  async onOpen() {}
  async onClose() {}
}
class ItemView extends View {}

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  registerView(type, fn) { (this._views = this._views || {})[type] = fn; }
  registerEvent(e) { created.events.push(e); }
  registerInterval() {}
  addRibbonIcon() {}
  addCommand(c) { (this._cmds = this._cmds || []).push(c); }
  addSettingTab() {}
  async loadData() { return JSON.parse(fs.readFileSync(dataPath, "utf8")); }
  async saveData(d) { this._saved = d; }
}

class Setting { setName() { return this; } setDesc() { return this; } addText() { return this; } addTextArea() { return this; } addToggle() { return this; } addDropdown() { return this; } addButton() { return this; } addExtraButton() { return this; } setValue() { return this; } onChange() { return this; } setPlaceholder() { return this; } setDisabled() { return this; } }
class Modal { open() {} close() {} }
class PluginSettingTab {}
class Notice { constructor(m) { created.logs.push(String(m)); } }
const Platform = { isWin: true, isMacOS: false, isLinux: false, isMobile: false };
const requestUrl = async () => ({ status: 200, json: {} });
const setIcon = () => {};

const obsidianStub = {
  App: class {}, Plugin, ItemView, View, WorkspaceLeaf, TFile, Setting, Modal,
  PluginSettingTab, Notice, Platform, setIcon, requestUrl,
  normalizePath: (p) => p, debounce: (f) => f, addIcon: () => {}, moment: () => ({}),
};

const origLoad = Module._load;
Module._load = function (req) {
  if (req === "obsidian") return obsidianStub;
  if (req === "electron") return { clipboard: { writeText() {} } };
  return origLoad.apply(this, arguments);
};

// ── 假 workspace ──────────────────────────────────────────────────────
const viewRegistry = {};
const vaultEvents = new Events();
const makeVault = (ev) => Object.assign(ev, {
  cachedRead: async (f) => f._c,
  getAbstractFileByPath: () => null,
  adapter: { getBasePath: () => "F:\\obsidianwenjian" },
});
const app = { vault: makeVault(vaultEvents), workspace: null };

function makeWorkspace(opsLeaf) {
  return {
    iterateAllLeaves: (cb) => [opsLeaf, { view: { getViewType: () => "file-explorer" }, getViewState: () => ({ type: "file-explorer", state: {} }) }].forEach(cb),
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    revealLeaf: () => {},
    onLayoutReady: (cb) => cb(),
    on: () => ({}),
    getActiveFile: () => null,
  };
}

const host = {
  app,
  instantiate: (leaf, type) => {
    const maker = viewRegistry[type];
    if (!maker) { created.logs.push("!! 未注册视图 " + type); return; }
    leaf.view = maker(leaf);
  },
};

async function scenario(kind) {
  created.setViewState.length = 0;
  created.logs.length = 0;
  const opsLeaf = new WorkspaceLeaf("pi-ops-view", kind, host);
  app.workspace = makeWorkspace(opsLeaf);
  const ve = new Events();          // 每个场景独立事件源，避免上一个场景的监听串味
  app.vault = makeVault(ve);

  delete require.cache[require.resolve(bundlePath)];
  const mod = require(bundlePath);
  const PluginClass = mod.default || mod;
  const plugin = new PluginClass(app, { version: "0.6.0" });
  const orig = plugin.registerView.bind(plugin);
  const wantWarm = kind === "warm";
  plugin.registerView = (type, fn) => {
    viewRegistry[type] = fn;
    // warm 场景：注册一完成就把视图对象先建好（模拟 Obsidian 建了视图但没叫 onOpen）
    if (wantWarm && type === "pi-ops-view" && !opsLeaf.view) opsLeaf.view = fn(opsLeaf);
    return orig(type, fn);
  };

  await plugin.onload();
  await new Promise((r) => setTimeout(r, 30));

  const n = plugin.opsLog.entries.length;
  const rows = opsLeaf.view && opsLeaf.view.listEl ? opsLeaf.view.listEl.children.length : -1;
  console.log(`[${kind}] opsLog=${n} | setViewState=${JSON.stringify(created.setViewState)} | 面板行数=${rows} | 视图=${opsLeaf.view && opsLeaf.view.constructor.name}`);

  // 再来一条 vault 变更 → 面板应自己长大
  ve.trigger("create", new TFile("小助理工作区/反馈/冒烟测试.md", "# hi"));
  await new Promise((r) => setTimeout(r, 30));
  const rows2 = opsLeaf.view && opsLeaf.view.listEl ? opsLeaf.view.listEl.children.length : -1;
  console.log(`[${kind}] 变更后行数=${rows2} | opsLog=${plugin.opsLog.entries.length}`);
  return rows > 0 && rows2 === rows + 1;
}

(async () => {
  const kinds = mode === "both" ? ["deferred", "warm"] : [mode === "a" ? "deferred" : "warm"];
  let ok = true;
  for (const k of kinds) ok = (await scenario(k)) && ok;
  if (created.logs.length) console.log("notice/err:", created.logs.join(" | "));
  console.log(ok ? "SMOKE: PASS" : "SMOKE: FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log("SMOKE: ERROR", (e && e.stack) || e); process.exit(2); });
