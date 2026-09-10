import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PiPanelView, VIEW_TYPE_PI_PANEL } from "./src/view";
import { DEFAULT_SETTINGS, PiPanelSettings } from "./src/settings";

export default class PiPanelPlugin extends Plugin {
  settings: PiPanelSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PI_PANEL, (leaf) => new PiPanelView(
      leaf,
      this.settings,
      async () => { await this.saveSettings(); },
    ));

    this.addRibbonIcon("terminal", "打开 Pi 面板", () => { void this.activate(); });

    this.addCommand({
      id: "open-pi-panel",
      name: "打开 Pi 面板",
      callback: () => { void this.activate(); },
    });

    this.addCommand({
      id: "open-pi-panel-main",
      name: "在新标签页打开 Pi 面板",
      callback: async () => {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_PI_PANEL, active: true });
      },
    });

    this.addSettingTab(new PiSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PI_PANEL);
  }

  async activate() {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PI_PANEL)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (right) {
        await right.setViewState({ type: VIEW_TYPE_PI_PANEL, active: true });
        leaf = workspace.getLeavesOfType(VIEW_TYPE_PI_PANEL)[0];
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const raw = await this.loadData();
    Object.assign(this.settings, DEFAULT_SETTINGS, raw || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class PiSettingTab extends PluginSettingTab {
  plugin: PiPanelPlugin;

  constructor(app: App, plugin: PiPanelPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Pi Panel" });

    new Setting(containerEl)
      .setName("pi 可执行文件")
      .setDesc("默认 pi。若 Obsidian 找不到命令（PATH 缺失），填绝对路径，如 %APPDATA%\\npm\\pi.cmd")
      .addText(t => t
        .setPlaceholder("pi")
        .setValue(this.plugin.settings.piExecutable)
        .onChange(async (v) => {
          this.plugin.settings.piExecutable = v.trim() || "pi";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("允许的工具")
      .setDesc("传给 pi --tools 的白名单（逗号分隔）。留空 = 全部工具，含 bash，注意风险")
      .addText(t => t
        .setPlaceholder("read,edit,write")
        .setValue(this.plugin.settings.piAllowedTools)
        .onChange(async (v) => {
          this.plugin.settings.piAllowedTools = v.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("保留会话")
      .setDesc("开启后不加 --no-session，pi 会把会话写入自己的 session 目录")
      .addToggle(t => t
        .setValue(this.plugin.settings.persistSession)
        .onChange(async (v) => {
          this.plugin.settings.persistSession = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("内联笔记上限（字符）")
      .setDesc("引用笔记超过该长度时，只插入 @路径，让 pi 自己用 read 工具读")
      .addText(t => t
        .setValue(String(this.plugin.settings.inlineMaxChars))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.inlineMaxChars = n;
            await this.plugin.saveSettings();
          }
        }));

    const cwd = (() => {
      try {
        const adapter: any = this.app.vault.adapter;
        return typeof adapter?.getBasePath === "function" ? String(adapter.getBasePath()) : "(未知)";
      } catch {
        return "(未知)";
      }
    })();

    new Setting(containerEl)
      .setName("工作目录")
      .setDesc("pi 以 vault 根目录为 cwd")
      .addText(t => { t.setValue(cwd); t.setDisabled(true); });
  }
}
