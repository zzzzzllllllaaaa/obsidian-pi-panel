import { App, Modal, Setting } from "obsidian";
import { ModelInfo, ModelManagerModal, ModelPickerModal } from "./models";
import { DEFAULT_OPS_FOLDERS } from "./ops";

export type SessionMode = "ephemeral" | "persist" | "resume";

/** pi 内置工具（--tools 白名单）；bash = 执行任意命令 */
export const BUILTIN_TOOLS: Array<{ id: string; label: string; hint: string; danger?: boolean }> = [
  { id: "read", label: "read", hint: "读文件" },
  { id: "write", label: "write", hint: "写文件" },
  { id: "edit", label: "edit", hint: "改文件" },
  { id: "grep", label: "grep", hint: "搜内容" },
  { id: "find", label: "find", hint: "搜文件名" },
  { id: "ls", label: "ls", hint: "列目录" },
  { id: "bash", label: "bash", hint: "执行命令（跑 python tools/…）", danger: true },
];

export const TOOLS_PRESETS: Array<{ label: string; value: string; hint: string }> = [
  { label: "只读", value: "read,grep,find,ls", hint: "只能看，不能改" },
  { label: "读写", value: "read,write,edit,grep,find,ls", hint: "能改文件，不能跑命令" },
  { label: "全部（含 bash）", value: "read,write,edit,grep,find,ls,bash", hint: "pi 官方默认能力：可执行任意命令" },
];

export function toolsToSet(value: string): Set<string> {
  return new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean));
}

/** 工具权限勾选器（设置页与设置弹窗共用） */
export function renderToolsPicker(
  parent: HTMLElement,
  getValue: () => string,
  setValue: (v: string) => void,
) {
  const box = parent.createDiv("pi-tools");
  const row = box.createDiv("pi-tools-row");
  const boxes = new Map<string, HTMLInputElement>();
  const presetButtons = new Map<string, HTMLElement>();
  const noteEl = box.createDiv({ cls: "pi-tools-note" });
  const presetRow = box.createDiv("pi-tools-presets");

  const refresh = () => {
    const v = getValue();
    const set = toolsToSet(v);
    for (const [id, cb] of boxes) cb.checked = set.has(id);
    for (const [value, btn] of presetButtons) btn.toggleClass("mod-cta", v === value);
    let text = v ? `传给 pi：--tools ${v}` : "未限定（等于 pi 默认：全部工具，含 bash）";
    if (!set.has("bash")) text += "　⚠️ 无 bash → 跑不了 python tools/workspace.py init、experience.py search 这类命令";
    noteEl.setText(text);
  };

  const apply = (v: string) => {
    setValue(v);
    refresh();
  };

  for (const t of BUILTIN_TOOLS) {
    const lab = row.createEl("label", { cls: "pi-tool-item" + (t.danger ? " pi-tool-danger" : "") });
    const cb = lab.createEl("input", { type: "checkbox" });
    cb.checked = toolsToSet(getValue()).has(t.id);
    lab.createSpan({ cls: "pi-tool-name", text: t.label });
    lab.createSpan({ cls: "pi-tool-hint", text: t.hint });
    cb.addEventListener("change", () => {
      const ids = BUILTIN_TOOLS.map((x) => x.id).filter((id) => boxes.get(id)?.checked);
      apply(ids.join(","));
    });
    boxes.set(t.id, cb);
  }

  for (const p of TOOLS_PRESETS) {
    const b = presetRow.createEl("button", { text: p.label });
    b.title = p.hint;
    b.addEventListener("click", () => apply(p.value));
    presetButtons.set(p.value, b);
  }

  refresh();
}

export interface PiPanelSettings {
  /** pi 可执行文件；Obsidian 找不到命令时填绝对路径 */
  piExecutable: string;
  /** 传给 pi --tools 的白名单，逗号分隔；留空 = 全部工具（含 bash） */
  piAllowedTools: string;
  /** 会话策略：ephemeral=--no-session / persist=新会话并存盘 / resume=--continue 继续上次 */
  sessionMode: SessionMode;
  /** 引用笔记内联上限（字符），超过则只给 @路径 */
  inlineMaxChars: number;
  /** pi 的工作目录；留空 = vault 根（可与笔记目录分开） */
  cwd: string;
  /** 附加系统提示文件（--append-system-prompt），如 E:\\piganet\\AGENTS.md */
  extraSystemPromptPath: string;
  /** 启动 pi 时用的默认模型（--model），格式 provider/id；留空 = pi 自己记着的 */
  defaultModel: string;
  /** 常用模型（选择器置顶），格式 provider/id */
  favoriteModels: string[];
  /** local = 本机 spawn pi（桌面）；remote = 连电脑上的桥（手机/多设备） */
  connectionMode: "local" | "remote";
  /** 桥地址，如 ws://192.168.1.2:8770 */
  bridgeUrl: string;
  /** 桥 token（与启动桥时 --token 一致） */
  bridgeToken: string;
  /** 是否记录「AI 对 vault 文件做了什么」（新建/修改/删除/重命名） */
  opsEnabled: boolean;
  /** 操作记录监听目录（每行一个 vault 相对路径） */
  opsFolders: string;
  /** 旧字段，仅用于配置迁移 */
  persistSession?: boolean;
}

export const DEFAULT_SETTINGS: PiPanelSettings = {
  piExecutable: "pi",
  piAllowedTools: "read,write,edit,grep,find,ls,bash",
  sessionMode: "persist",
  inlineMaxChars: 20000,
  cwd: "",
  extraSystemPromptPath: "",
  defaultModel: "",
  favoriteModels: [],
  connectionMode: "local",
  bridgeUrl: "",
  bridgeToken: "",
  opsEnabled: true,
  opsFolders: DEFAULT_OPS_FOLDERS.join("\n"),
};

export class PiSettingsModal extends Modal {
  private settings: PiPanelSettings;
  private onSave: (s: PiPanelSettings) => Promise<void>;
  private cwd: string;
  private fetchModels: () => Promise<ModelInfo[]>;

  constructor(
    app: App,
    settings: PiPanelSettings,
    cwd: string,
    onSave: (s: PiPanelSettings) => Promise<void>,
    fetchModels: () => Promise<ModelInfo[]> = async () => [],
  ) {
    super(app);
    this.settings = { ...settings };
    this.cwd = cwd;
    this.onSave = onSave;
    this.fetchModels = fetchModels;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Pi Panel 设置" });

    new Setting(contentEl)
      .setName("连接模式")
      .setDesc("本地 = 在这台设备上跑 pi（桌面）。远程 = 连电脑上的桥，手机用这个")
      .addDropdown(d => d
        .addOption("local", "本地（本机 pi）")
        .addOption("remote", "远程（连电脑的桥）")
        .setValue(this.settings.connectionMode)
        .onChange(v => { this.settings.connectionMode = v as any; }));

    new Setting(contentEl)
      .setName("桥地址")
      .setDesc("远程模式用。电脑上跑 python tools/pi_rpc_bridge.py --port 8770 --token xxx，这里填 ws://电脑IP:8770")
      .addText(t => t
        .setPlaceholder("ws://192.168.1.2:8770")
        .setValue(this.settings.bridgeUrl)
        .onChange(v => { this.settings.bridgeUrl = v.trim(); }));

    new Setting(contentEl)
      .setName("桥 token")
      .setDesc("与启动桥时的 --token 一致；留空表示桥没设 token（不安全）")
      .addText(t => t
        .setPlaceholder("（与桥的 --token 相同）")
        .setValue(this.settings.bridgeToken)
        .onChange(v => { this.settings.bridgeToken = v.trim(); }));

    new Setting(contentEl)
      .setName("pi 可执行文件")
      .setDesc("本地模式用。默认 pi。若 Obsidian 找不到命令（PATH 缺失），填绝对路径，如 C:\\Users\\你\\AppData\\Roaming\\npm\\pi.cmd")
      .addText(t => t
        .setPlaceholder("pi")
        .setValue(this.settings.piExecutable)
        .onChange(v => { this.settings.piExecutable = v.trim() || "pi"; }));

    new Setting(contentEl)
      .setName("工具权限（传给 pi --tools）")
      .setDesc("勾选 pi 能用的内置工具。bash = 能跑任意命令（pi 官方默认就是这么开的）；不勾就只能读写笔记");
    renderToolsPicker(contentEl, () => this.settings.piAllowedTools, (v) => { this.settings.piAllowedTools = v; });

    new Setting(contentEl)
      .setName("会话")
      .setDesc("每次启动 pi 时的会话策略。头部「历史」按钮可随时切到某个旧会话")
      .addDropdown(d => d
        .addOption("persist", "新会话并存盘")
        .addOption("resume", "继续上次（--continue）")
        .addOption("ephemeral", "不保存（--no-session）")
        .setValue(this.settings.sessionMode)
        .onChange(v => { this.settings.sessionMode = v as any; }));

    new Setting(contentEl)
      .setName("工作目录")
      .setDesc(`pi 的 cwd。留空 = vault 根（${this.cwd || "未知"}）。改这里可以带出目标目录的 AGENTS.md`)
      .addText(t => t
        .setPlaceholder(this.cwd)
        .setValue(this.settings.cwd)
        .onChange(v => { this.settings.cwd = v.trim(); }));

    new Setting(contentEl)
      .setName("附加系统提示文件")
      .setDesc("传给 pi --append-system-prompt 的文件路径，如 E:\\piganet\\AGENTS.md。pi 只在 cwd 及其父目录找 AGENTS.md，面板默认 cwd 是 vault，找不到项目规则")
      .addText(t => t
        .setPlaceholder("E:\\piganet\\AGENTS.md")
        .setValue(this.settings.extraSystemPromptPath)
        .onChange(v => { this.settings.extraSystemPromptPath = v.trim(); }));

    new Setting(contentEl)
      .setName("内联笔记上限（字符）")
      .setDesc("引用笔记时若超过该长度，只插入 @路径 让 pi 自己读")
      .addText(t => t
        .setValue(String(this.settings.inlineMaxChars))
        .onChange(v => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) this.settings.inlineMaxChars = n;
        }));

    let modelTextRef: { setValue: (v: string) => void } | null = null;
    new Setting(contentEl)
      .setName("默认模型")
      .setDesc("启动 pi 时传给 --model。可以直接从列表选，不用手打；留空 = 用 pi 自己的设置")
      .addText(t => {
        modelTextRef = t as any;
        t.setPlaceholder("provider/model-id")
          .setValue(this.settings.defaultModel)
          .onChange(v => { this.settings.defaultModel = v.trim(); });
      })
      .addButton(b => b
        .setButtonText("选择…")
        .onClick(() => {
          new ModelPickerModal(this.app, {
            favorites: this.settings.favoriteModels || [],
            load: async () => {
              const fromPi = await this.fetchModels().catch(() => []);
              return fromPi.length ? fromPi : [];
            },
            onPick: (provider, id) => {
              this.settings.defaultModel = `${provider}/${id}`;
              modelTextRef?.setValue(this.settings.defaultModel);
            },
            onToggleFavorite: (key) => {
              const list = [...(this.settings.favoriteModels || [])];
              const i = list.indexOf(key);
              if (i >= 0) list.splice(i, 1); else list.push(key);
              this.settings.favoriteModels = list;
            },
            onManage: () => new ModelManagerModal(this.app, () => {}).open(),
          }).open();
        }))
      .addExtraButton(b => b
        .setIcon("settings-2")
        .setTooltip("管理模型（models.json）")
        .onClick(() => { new ModelManagerModal(this.app, () => {}).open(); }));

    new Setting(contentEl)
      .setName("Vault 根目录（只读）")
      .setDesc("pi 能读写的笔记根目录")
      .addText(t => { t.setValue(this.cwd || "(未知)"); t.setDisabled(true); });

    new Setting(contentEl)
      .setName("操作记录")
      .setDesc("把 pi 在 vault 里的新建/修改/删除/重命名记到面板的「操作记录」抽屉（头部 list 图标）")
      .addToggle(t => t
        .setValue(this.settings.opsEnabled)
        .onChange(v => { this.settings.opsEnabled = v; }));

    new Setting(contentEl)
      .setName("操作记录：监听目录")
      .setDesc("每行一个 vault 相对路径，只记这些目录下的文件变更；填 `/` 或 `*` = 整个库（.obsidian 与回收站除外）；留空 = 不记")
      .addTextArea(t => t
        .setPlaceholder("小助理工作区/反馈")
        .setValue(this.settings.opsFolders)
        .onChange(v => { this.settings.opsFolders = v; }));

    const row = contentEl.createDiv("pi-modal-actions");
    const cancel = row.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const save = row.createEl("button", { text: "保存", cls: "mod-cta" });
    save.addEventListener("click", async () => {
      await this.onSave({ ...this.settings });
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
