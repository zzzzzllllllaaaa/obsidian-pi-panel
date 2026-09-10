/**
 * 模型管理 —— 读取/编辑 `~/.pi/agent/models.json`，并提供一个选择器
 *
 * 重要坑（2026-09-04 踩过）：models.json 里**任何**一个模型校验失败，pi 的
 * ModelRegistry 会丢弃整个文件的所有自定义模型（无部分加载、界面无报错）。
 * 所以这里的写盘路径必须先跑 validateModelsFile()，有错就不写。
 *
 * 只用惰性 require("fs"/"path"/"os")，避免移动端加载即崩。
 */

import { App, Modal, Notice, Setting } from "obsidian";

export const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  compat?: Record<string, any>;
  [key: string]: any;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, any>;
  models?: ModelEntry[];
  [key: string]: any;
}

export interface ModelsFile {
  providers: Record<string, ProviderEntry>;
}

/** 运行时可用模型（来自 RPC get_available_models，含内置） */
export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  source?: "config" | "builtin";
}

// ── 路径 / 读写 ──────────────────────────────────────────────────────────

function nodeRequire(name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(name);
}

export function piAgentDir(): string {
  const os = nodeRequire("os");
  const path = nodeRequire("path");
  return path.join(os.homedir(), ".pi", "agent");
}

export function modelsJsonPath(): string {
  const path = nodeRequire("path");
  return path.join(piAgentDir(), "models.json");
}

export function loadModelsFile(): { data: ModelsFile; error: string; missing: boolean } {
  const fs = nodeRequire("fs");
  const file = modelsJsonPath();
  if (!fs.existsSync(file)) return { data: { providers: {} }, error: "", missing: true };
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    const data: ModelsFile = parsed && typeof parsed === "object" ? parsed : { providers: {} };
    if (!data.providers || typeof data.providers !== "object") data.providers = {};
    return { data, error: "", missing: false };
  } catch (e: any) {
    return { data: { providers: {} }, error: String(e?.message || e), missing: false };
  }
}

/** 备份后写盘；失败抛异常 */
export function saveModelsFile(data: ModelsFile): string {
  const fs = nodeRequire("fs");
  const path = nodeRequire("path");
  const file = modelsJsonPath();
  const errors = validateModelsFile(data);
  if (errors.length) throw new Error("校验未通过，已阻止写入：\n" + errors.join("\n"));

  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let backup = "";
  if (fs.existsSync(file)) {
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    backup = `${file}.bak-${ts}`;
    fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return backup;
}

/** 用系统默认程序打开 models.json */
export function openModelsJson(): void {
  const fs = nodeRequire("fs");
  const file = modelsJsonPath();
  try {
    if (!fs.existsSync(file)) {
      const dir = nodeRequire("path").dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ providers: {} }, null, 2) + "\n", "utf8");
    }
    const electron = nodeRequire("electron");
    if (electron?.shell?.openPath) electron.shell.openPath(file);
  } catch (e: any) {
    new Notice(`打开 models.json 失败：${String(e?.message || e)}`);
  }
}

// ── 校验（防止一处错 → 整个文件被 pi 丢弃）────────────────────────────────

export function validateModelEntry(m: ModelEntry, providerName: string): string[] {
  const errs: string[] = [];
  const at = `${providerName}/${m?.id || "?"}`;
  if (!m || typeof m !== "object") return [`${at}: 模型必须是对象`];
  if (typeof m.id !== "string" || !m.id.trim()) errs.push(`${at}: 缺少 id`);
  else if (/\s/.test(m.id)) errs.push(`${at}: id 不能含空格`);
  if (m.api !== undefined && !API_TYPES.includes(String(m.api)))
    errs.push(`${at}: api "${m.api}" 非法（可选 ${API_TYPES.join(" / ")}）`);
  if (m.reasoning !== undefined && typeof m.reasoning !== "boolean")
    errs.push(`${at}: reasoning 必须是 true/false`);
  if (m.input !== undefined) {
    if (!Array.isArray(m.input) || m.input.some((x) => x !== "text" && x !== "image"))
      errs.push(`${at}: input 只能是 ["text"] / ["text","image"]`);
  }
  for (const k of ["contextWindow", "maxTokens"] as const) {
    const v = (m as any)[k];
    if (v !== undefined && (typeof v !== "number" || !isFinite(v) || v <= 0))
      errs.push(`${at}: ${k} 必须是正数（当前 ${JSON.stringify(v)}）`);
  }
  if (m.cost !== undefined) {
    if (!m.cost || typeof m.cost !== "object" || Array.isArray(m.cost)) {
      errs.push(`${at}: cost 必须是对象，且四个字段全填（pi 不支持空对象 {} 或部分字段）`);
    } else {
      for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) {
        const v = (m.cost as any)[k];
        if (typeof v !== "number" || !isFinite(v) || v < 0)
          errs.push(`${at}: cost.${k} 必须是 >= 0 的数字（四个字段全必填）`);
      }
    }
  }
  if (m.compat !== undefined && (typeof m.compat !== "object" || m.compat === null))
    errs.push(`${at}: compat 必须是对象`);
  return errs;
}

export function validateProviderEntry(name: string, p: ProviderEntry): string[] {
  const errs: string[] = [];
  if (!name || !name.trim()) errs.push("provider 名字不能为空");
  if (/\s/.test(name || "")) errs.push(`provider "${name}": 名字不能含空格`);
  if (!p || typeof p !== "object") return [...errs, `provider "${name}": 必须是对象`];
  if (p.api !== undefined && !API_TYPES.includes(String(p.api)))
    errs.push(`provider "${name}": api "${p.api}" 非法`);
  for (const k of ["baseUrl", "apiKey"] as const) {
    const v = (p as any)[k];
    if (v !== undefined && typeof v !== "string") errs.push(`provider "${name}": ${k} 必须是字符串`);
  }
  if (p.models !== undefined && !Array.isArray(p.models))
    errs.push(`provider "${name}": models 必须是数组`);
  const seen = new Set<string>();
  for (const m of p.models || []) {
    if (m && typeof m.id === "string") {
      if (seen.has(m.id)) errs.push(`provider "${name}": 重复的模型 id "${m.id}"`);
      seen.add(m.id);
    }
    errs.push(...validateModelEntry(m, name));
  }
  return errs;
}

export function validateModelsFile(data: ModelsFile): string[] {
  const errs: string[] = [];
  if (!data || typeof data !== "object" || !data.providers || typeof data.providers !== "object") {
    return ["根对象必须形如 {\"providers\": { ... }}"];
  }
  for (const [name, p] of Object.entries(data.providers)) {
    errs.push(...validateProviderEntry(name, p as ProviderEntry));
  }
  return errs;
}

// ── 常用模型（收藏）────────────────────────────────────────────────────────

export const modelKey = (provider: string, id: string) => `${provider}/${id}`;

// ── 模型选择器 ────────────────────────────────────────────────────────────

export interface ModelPickerOptions {
  current?: { provider?: string; id?: string };
  load: () => Promise<ModelInfo[]>;
  favorites: string[];
  onPick: (provider: string, id: string) => void;
  onToggleFavorite: (key: string) => void;
  onManage: () => void;
}

export class ModelPickerModal extends Modal {
  private opts: ModelPickerOptions;
  private all: ModelInfo[] = [];
  private listEl!: HTMLElement;
  private filter = "";

  constructor(app: App, opts: ModelPickerOptions) {
    super(app);
    this.opts = opts;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-model-modal");
    contentEl.createEl("h3", { text: "选择模型" });

    const bar = contentEl.createDiv("pi-model-bar");
    const input = bar.createEl("input", { type: "text", cls: "pi-model-filter" });
    input.placeholder = "搜索 provider / 模型…";
    input.addEventListener("input", () => {
      this.filter = input.value.trim().toLowerCase();
      this.renderList();
    });
    const manage = bar.createEl("button", { text: "管理模型…" });
    manage.addEventListener("click", () => { this.close(); this.opts.onManage(); });

    this.listEl = contentEl.createDiv("pi-model-list");
    this.listEl.createDiv({ cls: "pi-session-empty", text: "正在读取模型列表…" });
    input.focus();

    void this.opts.load().then((models) => {
      this.all = Array.isArray(models) ? models : [];
      this.renderList();
    }).catch((e: any) => {
      this.listEl.empty();
      this.listEl.createDiv({ cls: "pi-session-empty", text: `读取失败：${String(e?.message || e)}` });
    });
  }

  onClose() { this.contentEl.empty(); }

  private renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const cur = this.opts.current || {};
    const favs = this.opts.favorites || [];

    const matches = this.all.filter((m) => {
      if (!this.filter) return true;
      const hay = `${m.provider || ""}/${m.id} ${m.name || ""}`.toLowerCase();
      return hay.includes(this.filter);
    });

    const sections: Array<{ title: string; items: ModelInfo[] }> = [];
    const favItems = matches.filter((m) => favs.includes(modelKey(m.provider || "", m.id)));
    if (favItems.length) sections.push({ title: "常用", items: favItems });
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of matches) {
      if (favItems.includes(m)) continue;
      const p = m.provider || "(未知)";
      if (!byProvider.has(p)) byProvider.set(p, []);
      byProvider.get(p)!.push(m);
    }
    for (const [p, items] of [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      sections.push({ title: p, items });
    }

    if (!sections.length) {
      this.listEl.createDiv({ cls: "pi-session-empty", text: this.all.length ? "没有匹配的模型" : "没有读到任何模型。pi 未连接时可先「管理模型…」里的 models.json 添加。" });
      return;
    }

    for (const sec of sections) {
      this.listEl.createDiv({ cls: "pi-model-sec", text: sec.title });
      for (const m of sec.items) {
        const isCur = cur.provider === m.provider && cur.id === m.id;
        const row = this.listEl.createDiv("pi-model-row" + (isCur ? " is-current" : ""));
        const star = row.createEl("button", { cls: "pi-star", text: favs.includes(modelKey(m.provider || "", m.id)) ? "★" : "☆" });
        star.title = "常用 / 取消常用";
        star.addEventListener("click", (e) => {
          e.stopPropagation();
          this.opts.onToggleFavorite(modelKey(m.provider || "", m.id));
        });
        const main = row.createDiv("pi-model-main");
        main.createDiv({ cls: "pi-model-name", text: m.name && m.name !== m.id ? `${m.name}` : m.id });
        const bits = [m.provider, m.reasoning ? "thinking" : "", m.contextWindow ? `ctx ${Math.round(m.contextWindow / 1000)}k` : "", m.source === "builtin" ? "内置" : ""].filter(Boolean);
        main.createDiv({ cls: "pi-model-meta", text: `${m.id} · ${bits.join(" · ")}` });
        if (isCur) row.createDiv({ cls: "pi-model-cur", text: "当前" });
        row.addEventListener("click", () => {
          this.close();
          this.opts.onPick(m.provider || "", m.id);
        });
      }
    }
  }
}

// ── models.json 管理 ──────────────────────────────────────────────────────

export class ModelManagerModal extends Modal {
  private onChanged: () => void;
  private error = "";

  constructor(app: App, onChanged: () => void) {
    super(app);
    this.onChanged = onChanged;
  }

  onOpen() {
    this.render();
  }

  onClose() { this.contentEl.empty(); }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-model-modal");
    contentEl.createEl("h3", { text: "模型管理" });
    contentEl.createDiv({ cls: "pi-session-cwd", text: modelsJsonPath() });

    const top = contentEl.createDiv("pi-session-top");
    const mk = (label: string, fn: () => void) => {
      const b = top.createEl("button", { text: label });
      b.addEventListener("click", fn);
      return b;
    };
    mk("+ 新增供应商", () => this.editProvider(null));
    mk("打开 models.json", () => openModelsJson());

    const { data, error, missing } = loadModelsFile();
    if (error) {
      contentEl.createDiv({ cls: "pi-model-warn", text: `models.json 解析失败（pi 会忽略整个文件）：${error}` });
    }
    if (missing) {
      contentEl.createDiv({ cls: "pi-model-warn", text: "还没有 models.json —— 新增供应商时会自动创建。" });
    }
    if (this.error) contentEl.createDiv({ cls: "pi-model-err", text: this.error });

    const errors = error ? [] : validateModelsFile(data);
    if (errors.length) {
      const box = contentEl.createDiv("pi-model-err");
      box.createDiv({ text: "⚠️ 现有配置有校验问题（pi 会丢弃整个 models.json）：" });
      for (const e of errors) box.createDiv({ text: "· " + e });
    }

    const names = Object.keys(data.providers);
    if (!names.length) {
      contentEl.createDiv({ cls: "pi-session-empty", text: "还没有自定义供应商。点「+ 新增供应商」添加（中转 / Ollama / vLLM 等）。" });
      return;
    }

    const list = contentEl.createDiv("pi-model-list");
    for (const name of names) {
      const p = data.providers[name];
      const card = list.createDiv("pi-prov-card");
      const head = card.createDiv("pi-prov-head");
      const info = head.createDiv("pi-prov-info");
      info.createDiv({ cls: "pi-model-name", text: name });
      info.createDiv({
        cls: "pi-model-meta",
        text: [p.api, p.baseUrl, `${(p.models || []).length} 个模型`].filter(Boolean).join(" · "),
      });
      const acts = head.createDiv("pi-prov-acts");
      const mkBtn = (label: string, cls: string, fn: () => void) => {
        const b = acts.createEl("button", { text: label, cls });
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        return b;
      };
      mkBtn("+ 模型", "", () => this.editModel(name, null));
      mkBtn("编辑", "", () => this.editProvider(name));
      mkBtn("删除", "mod-warning", () => {
        if (!confirm(`删除供应商「${name}」及其 ${(p.models || []).length} 个模型？`)) return;
        this.mutate((d) => { delete d.providers[name]; });
      });

      for (const m of p.models || []) {
        const row = card.createDiv("pi-model-row pi-model-row-inline");
        const main = row.createDiv("pi-model-main");
        main.createDiv({ cls: "pi-model-name", text: m.name && m.name !== m.id ? m.name : m.id });
        const bits = [
          m.id,
          m.reasoning ? "thinking" : "",
          m.contextWindow ? `ctx ${Math.round(m.contextWindow / 1000)}k` : "",
          m.maxTokens ? `out ${Math.round(m.maxTokens / 1000)}k` : "",
          m.api || p.api || "",
        ].filter(Boolean);
        const bad = validateModelEntry(m, name);
        main.createDiv({ cls: "pi-model-meta" + (bad.length ? " pi-bad" : ""), text: bad.length ? "⚠️ " + bad[0] : bits.join(" · ") });
        const acts2 = row.createDiv("pi-prov-acts");
        const mk2 = (label: string, cls: string, fn: () => void) => {
          const b = acts2.createEl("button", { text: label, cls });
          b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
          return b;
        };
        mk2("编辑", "", () => this.editModel(name, m.id));
        mk2("删除", "mod-warning", () => {
          if (!confirm(`删除模型「${name}/${m.id}」？`)) return;
          this.mutate((d) => {
            d.providers[name].models = (d.providers[name].models || []).filter((x) => x.id !== m.id);
          });
        });
      }
    }
  }

  private mutate(fn: (data: ModelsFile) => void) {
    const { data, error } = loadModelsFile();
    if (error) {
      this.error = `不写入：当前 models.json 解析失败（${error}）。先修好文件再改。`;
      this.render();
      return;
    }
    try {
      fn(data);
      const backup = saveModelsFile(data);
      this.error = "";
      new Notice(`已保存 models.json${backup ? "（已备份旧文件）" : ""}；pi 每次打开 /model 会重读，面板重连后生效`);
      this.onChanged();
    } catch (e: any) {
      this.error = String(e?.message || e);
    }
    this.render();
  }

  private editProvider(name: string | null) {
    const { data } = loadModelsFile();
    const existing = name ? data.providers[name] : undefined;
    new ProviderFormModal(this.app, name, existing, (newName, values) => {
      this.mutate((d) => {
        if (name && name !== newName) delete d.providers[name];
        d.providers[newName] = { ...(name === newName ? d.providers[name] : {}), ...values } as ProviderEntry;
      });
    }).open();
  }

  private editModel(provider: string, id: string | null) {
    const { data } = loadModelsFile();
    const p = data.providers[provider];
    if (!p) return;
    const existing = id ? (p.models || []).find((m) => m.id === id) : undefined;
    new ModelFormModal(this.app, provider, p, existing, (values) => {
      this.mutate((d) => {
        const prov = d.providers[provider];
        prov.models = prov.models || [];
        const idx = id ? prov.models.findIndex((m) => m.id === id) : -1;
        if (idx >= 0) prov.models[idx] = { ...prov.models[idx], ...values } as ModelEntry;
        else prov.models.push(values as ModelEntry);
      });
    }).open();
  }
}

// ── 表单 ──────────────────────────────────────────────────────────────────

function field(parent: HTMLElement, label: string, hint = ""): HTMLInputElement {
  const wrap = parent.createDiv("pi-field");
  const lab = wrap.createDiv("pi-field-label");
  lab.setText(label);
  if (hint) lab.title = hint;
  return wrap.createEl("input", { type: "text", cls: "pi-field-input" });
}

function actions(parent: HTMLElement, onSave: () => void, onCancel: () => void) {
  const row = parent.createDiv("pi-modal-actions");
  const cancel = row.createEl("button", { text: "取消" });
  cancel.addEventListener("click", onCancel);
  const save = row.createEl("button", { text: "保存", cls: "mod-cta" });
  save.addEventListener("click", onSave);
}

export class ProviderFormModal extends Modal {
  private name: string | null;
  private existing?: ProviderEntry;
  private onSave: (name: string, values: Partial<ProviderEntry>) => void;

  constructor(app: App, name: string | null, existing: ProviderEntry | undefined, onSave: (name: string, values: Partial<ProviderEntry>) => void) {
    super(app);
    this.name = name;
    this.existing = existing;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-model-modal");
    contentEl.createEl("h3", { text: this.name ? `编辑供应商：${this.name}` : "新增供应商" });

    const nameEl = field(contentEl, "名字（标识）", "只能用于 pi 的 provider 名，别含空格");
    nameEl.placeholder = "xianyu";
    nameEl.value = this.name || "";

    const apiEl = field(contentEl, "API 类型", "openai-completions 最通用");
    apiEl.placeholder = "openai-completions";
    apiEl.value = String(this.existing?.api || "openai-completions");

    const urlEl = field(contentEl, "baseUrl", "中转/Ollama 的 /v1 地址");
    urlEl.placeholder = "https://ai.168661.xyz/v1";
    urlEl.value = String(this.existing?.baseUrl || "");

    const keyEl = field(contentEl, "apiKey", "Ollama 随便填（如 ollama）");
    keyEl.placeholder = "sk-...";
    keyEl.value = String(this.existing?.apiKey || "");

    const devRow = contentEl.createDiv("pi-field pi-field-check");
    const devCb = devRow.createEl("input", { type: "checkbox" });
    devCb.checked = this.existing?.compat?.supportsDeveloperRole === false;
    const devLab = devRow.createEl("label", { text: "中转不支持 developer role（compat.supportsDeveloperRole=false）" });
    devLab.title = "reasoning 模型时 pi 会用 developer 角色发 system prompt；旧中转会返回 400，勾上后改用 system";

    const errEl = contentEl.createDiv("pi-model-err");

    actions(contentEl, () => {
      const name = nameEl.value.trim();
      const provider: ProviderEntry = {
        api: apiEl.value.trim() || "openai-completions",
        baseUrl: urlEl.value.trim(),
        apiKey: keyEl.value.trim(),
      };
      if (devCb.checked) provider.compat = { ...(this.existing?.compat || {}), supportsDeveloperRole: false };
      else if (this.existing?.compat) {
        const c = { ...this.existing.compat };
        delete c.supportsDeveloperRole;
        if (Object.keys(c).length) provider.compat = c;
      }
      if (this.existing?.models?.length) provider.models = this.existing.models;

      const errs: string[] = [];
      if (!name) errs.push("名字不能为空");
      if (!provider.baseUrl) errs.push("baseUrl 不能为空");
      if (!provider.apiKey) errs.push("apiKey 不能为空（Ollama 填 ollama）");
      if (errs.length) { errEl.setText(errs.join("；")); return; }

      const { data } = loadModelsFile();
      const merged: ModelsFile = { providers: { ...data.providers, [name]: provider } };
      if (this.name && this.name !== name) delete merged.providers[this.name];
      const all = validateModelsFile(merged);
      if (all.length) { errEl.setText(all.join("\n")); return; }

      this.close();
      this.onSave(name, provider);
    }, () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}

export class ModelFormModal extends Modal {
  private provider: string;
  private providerEntry: ProviderEntry;
  private existing?: ModelEntry;
  private onSave: (values: Partial<ModelEntry>) => void;

  constructor(app: App, provider: string, providerEntry: ProviderEntry, existing: ModelEntry | undefined, onSave: (values: Partial<ModelEntry>) => void) {
    super(app);
    this.provider = provider;
    this.providerEntry = providerEntry;
    this.existing = existing;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    const e = this.existing;
    contentEl.empty();
    contentEl.addClass("pi-model-modal");
    contentEl.createEl("h3", { text: e ? `编辑模型：${this.provider}/${e.id}` : `新增模型（${this.provider}）` });

    const idEl = field(contentEl, "模型 id *", "中转/服务端要求的真实模型名");
    idEl.placeholder = "deepseek-v4-flash";
    idEl.value = e?.id || "";

    const nameEl = field(contentEl, "显示名（可空）");
    nameEl.value = e?.name || "";

    const apiEl = field(contentEl, "api（可空 = 用供应商的）");
    apiEl.placeholder = String(this.providerEntry.api || "openai-completions");
    apiEl.value = e?.api || "";

    const ctxEl = field(contentEl, "contextWindow", "如 128000");
    ctxEl.value = e?.contextWindow ? String(e.contextWindow) : "";
    const outEl = field(contentEl, "maxTokens", "如 16384");
    outEl.value = e?.maxTokens ? String(e.maxTokens) : "";

    const reasonRow = contentEl.createDiv("pi-field pi-field-check");
    const reasonCb = reasonRow.createEl("input", { type: "checkbox" });
    reasonCb.checked = !!e?.reasoning;
    reasonRow.createEl("label", { text: "reasoning / thinking 模型" });

    const imgRow = contentEl.createDiv("pi-field pi-field-check");
    const imgCb = imgRow.createEl("input", { type: "checkbox" });
    imgCb.checked = Array.isArray(e?.input) ? e!.input!.includes("image") : false;
    imgRow.createEl("label", { text: "支持图片输入（input: [text, image]）" });

    contentEl.createDiv({ cls: "pi-field-note", text: "价格 cost 要么四个全填，要么全不填（pi 不允许空对象 {}）。填 0 表示免费。" });
    const costEls = (["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => {
      const el = field(contentEl, `cost.${k}`);
      const v = e?.cost ? (e.cost as any)[k] : undefined;
      el.value = typeof v === "number" ? String(v) : "";
      return el;
    });

    const errEl = contentEl.createDiv("pi-model-err");

    actions(contentEl, () => {
      const m: ModelEntry = { id: idEl.value.trim() };
      if (!m.id) { errEl.setText("模型 id 必填"); return; }
      if (nameEl.value.trim() && nameEl.value.trim() !== m.id) m.name = nameEl.value.trim();
      if (apiEl.value.trim()) m.api = apiEl.value.trim();
      if (ctxEl.value.trim()) m.contextWindow = Number(ctxEl.value.trim());
      if (outEl.value.trim()) m.maxTokens = Number(outEl.value.trim());
      if (reasonCb.checked) m.reasoning = true;
      if (imgCb.checked) m.input = ["text", "image"];
      const costVals = costEls.map((el) => el.value.trim());
      if (costVals.some((v) => v !== "")) {
        if (costVals.some((v) => v === "")) { errEl.setText("cost 四个字段要么全填要么全不填"); return; }
        m.cost = {
          input: Number(costVals[0]),
          output: Number(costVals[1]),
          cacheRead: Number(costVals[2]),
          cacheWrite: Number(costVals[3]),
        };
      }
      if (e?.compat) m.compat = e.compat;

      const errs = validateModelEntry(m, this.provider);
      if (errs.length) { errEl.setText(errs.join("\n")); return; }
      this.close();
      this.onSave(m);
    }, () => this.close());
  }

  onClose() { this.contentEl.empty(); }
}
