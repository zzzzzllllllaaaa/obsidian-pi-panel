import { App, Modal, Setting } from "obsidian";
import { ModelInfo, ModelManagerModal, ModelPickerModal } from "./models";

export type SessionMode = "ephemeral" | "persist" | "resume";

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
  /** 旧字段，仅用于配置迁移 */
  persistSession?: boolean;
}

export const DEFAULT_SETTINGS: PiPanelSettings = {
  piExecutable: "pi",
  piAllowedTools: "read,edit,write",
  sessionMode: "persist",
  inlineMaxChars: 20000,
  cwd: "",
  extraSystemPromptPath: "",
  defaultModel: "",
  favoriteModels: [],
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
      .setName("pi 可执行文件")
      .setDesc("默认 pi。若 Obsidian 找不到命令（PATH 缺失），填绝对路径，如 C:\\Users\\你\\AppData\\Roaming\\npm\\pi.cmd")
      .addText(t => t
        .setPlaceholder("pi")
        .setValue(this.settings.piExecutable)
        .onChange(v => { this.settings.piExecutable = v.trim() || "pi"; }));

    new Setting(contentEl)
      .setName("允许的工具")
      .setDesc("传给 pi --tools 的白名单，逗号分隔。留空 = 全部工具（含 bash，注意风险）")
      .addText(t => t
        .setPlaceholder("read,edit,write")
        .setValue(this.settings.piAllowedTools)
        .onChange(v => { this.settings.piAllowedTools = v.trim(); }));

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
