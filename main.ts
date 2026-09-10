import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PiPanelView, VIEW_TYPE_PI_PANEL } from "./src/view";
import { DEFAULT_SETTINGS, PiPanelSettings } from "./src/settings";

export default class PiPanelPlugin extends Plugin {
  settings: PiPanelSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerViewType();

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

  /**
   * 注册视图类型。
   * 若上一次加载失败（Obsidian 认为插件未成功装载，不会走 onunload 清理），
   * 再次加载会撞上 "Attempting to register an existing view type" ——
   * 这里先尝试注销旧注册，再注册，并兜住异常。
   */
  private registerViewType() {
    const registry: any = (this.app as any)?.viewRegistry;
    try { registry?.unregisterView?.(VIEW_TYPE_PI_PANEL); } catch { /* noop */ }

    try {
      this.registerView(VIEW_TYPE_PI_PANEL, (leaf) => new PiPanelView(
        leaf,
        this.settings,
        async () => { await this.saveSettings(); },
      ));
    } catch (e) {
      console.warn("[Pi Panel] registerView failed", e);
      // 同会话内类型已被占用，客户端界面仍可用，重启 Obsidian 后恢复正常
    }
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
    // 旧配置迁移：persistSession:boolean → sessionMode
    if (raw && typeof raw.persistSession === "boolean" && raw.sessionMode === undefined) {
      this.settings.sessionMode = raw.persistSession ? "persist" : "ephemeral";
    }
    delete (this.settings as any).persistSession;
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

    const cwd = (() => {
      try {
        const adapter: any = this.app.vault.adapter;
        return typeof adapter?.getBasePath === "function" ? String(adapter.getBasePath()) : "(未知)";
      } catch {
        return "(未知)";
      }
    })();

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
      .setName("会话")
      .setDesc("启动 pi 时的会话策略；面板头部「历史」按钮可切旧会话")
      .addDropdown(d => d
        .addOption("persist", "新会话并存盘")
        .addOption("resume", "继续上次（--continue）")
        .addOption("ephemeral", "不保存（--no-session）")
        .setValue(this.plugin.settings.sessionMode)
        .onChange(async (v) => {
          this.plugin.settings.sessionMode = v as any;
          await this.plugin.saveSettings();
          this.bouncePanels();
        }));

    new Setting(containerEl)
      .setName("工作目录")
      .setDesc(`pi 的 cwd。留空 = vault 根（${cwd}）。pi 只在 cwd 及其父目录找 AGENTS.md`)
      .addText(t => t
        .setPlaceholder(cwd)
        .setValue(this.plugin.settings.cwd)
        .onChange(async (v) => {
          this.plugin.settings.cwd = v.trim();
          await this.plugin.saveSettings();
          this.bouncePanels();
        }));

    new Setting(containerEl)
      .setName("附加系统提示文件")
      .setDesc("传给 pi --append-system-prompt 的文件路径，如 E:\\piganet\\AGENTS.md（面板 cwd 在 vault，找不到项目规则时用这个）")
      .addText(t => t
        .setPlaceholder("E:\\piganet\\AGENTS.md")
        .setValue(this.plugin.settings.extraSystemPromptPath)
        .onChange(async (v) => {
          this.plugin.settings.extraSystemPromptPath = v.trim();
          await this.plugin.saveSettings();
          this.bouncePanels();
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

    new Setting(containerEl)
      .setName("Vault 根目录（只读）")
      .setDesc("pi 的笔记根目录")
      .addText(t => { t.setValue(cwd); t.setDisabled(true); });
  }

  /** 设置变更后重启所有已打开面板里的 pi 进程 */
  private bouncePanels() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_PANEL).forEach(leaf => {
      const view: any = leaf.view;
      if (typeof view?.resetPiProcess === "function") view.resetPiProcess();
    });
  }
}
