import { App, Modal, Setting } from "obsidian";

export interface PiPanelSettings {
  /** pi 可执行文件；Obsidian 找不到命令时填绝对路径 */
  piExecutable: string;
  /** 传给 pi --tools 的白名单，逗号分隔；留空 = 全部工具（含 bash） */
  piAllowedTools: string;
  /** 保留会话（不加 --no-session），pi 会写自己的 session 文件 */
  persistSession: boolean;
  /** 引用笔记内联上限（字符），超过则只给 @路径 */
  inlineMaxChars: number;
}

export const DEFAULT_SETTINGS: PiPanelSettings = {
  piExecutable: "pi",
  piAllowedTools: "read,edit,write",
  persistSession: false,
  inlineMaxChars: 20000,
};

export class PiSettingsModal extends Modal {
  private settings: PiPanelSettings;
  private onSave: (s: PiPanelSettings) => Promise<void>;
  private cwd: string;

  constructor(app: App, settings: PiPanelSettings, cwd: string, onSave: (s: PiPanelSettings) => Promise<void>) {
    super(app);
    this.settings = { ...settings };
    this.cwd = cwd;
    this.onSave = onSave;
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
      .setName("保留会话")
      .setDesc("开启后不加 --no-session，pi 会把会话写入自己的 session 目录（下次可 --continue 恢复）")
      .addToggle(t => t
        .setValue(this.settings.persistSession)
        .onChange(v => { this.settings.persistSession = v; }));

    new Setting(contentEl)
      .setName("内联笔记上限（字符）")
      .setDesc("引用笔记时若超过该长度，只插入 @路径 让 pi 自己读")
      .addText(t => t
        .setValue(String(this.settings.inlineMaxChars))
        .onChange(v => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) this.settings.inlineMaxChars = n;
        }));

    new Setting(contentEl)
      .setName("工作目录")
      .setDesc("pi 以 vault 根目录为 cwd，可读写全部笔记")
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
