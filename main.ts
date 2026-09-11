import { App, Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PiPanelView, setPluginVersion, VIEW_TYPE_PI_PANEL } from "./src/view";
import { DEFAULT_SETTINGS, PiPanelSettings, renderToolsPicker } from "./src/settings";
import { loadModelsFile, ModelInfo, ModelManagerModal, ModelPickerModal, validateModelsFile } from "./src/models";
import { debugLog } from "./src/log";
import { DebugModal } from "./src/debug";

export default class PiPanelPlugin extends Plugin {
  settings: PiPanelSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    setPluginVersion(this.manifest?.version || "?");
    this.setupLogFile();
    debugLog.info(`Pi Panel 加载：v${this.manifest?.version || "?"} | Obsidian ${String((this.app as any)?.appVersion || "?")} | platform=${String((globalThis as any)?.process?.platform || "?")}`);

    window.addEventListener("unhandledrejection", (e: any) => {
      debugLog.error(`unhandledrejection: ${String(e?.reason?.stack || e?.reason || "")}`);
    });
    window.addEventListener("error", (e: any) => {
      debugLog.error(`window error: ${String(e?.message || "")}`);
    });

    try {
      await this.loadSettings();
      debugLog.info(`设置：${JSON.stringify(this.settings)}`);
      this.registerViewType();
    } catch (e: any) {
      debugLog.error(`onload 失败：${String(e?.stack || e)}`);
      new Notice(`Pi Panel 加载出错：${String(e?.message || e)}（命令面板 → Pi 面板：调试日志）`, 10000);
      throw e;
    }

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

    this.addCommand({
      id: "open-pi-panel-debug",
      name: "查看调试日志",
      callback: () => this.openDebug(),
    });

    this.addCommand({
      id: "open-pi-panel-models",
      name: "管理模型（models.json）",
      callback: () => this.openModelManager(),
    });

    this.addSettingTab(new PiSettingTab(this.app, this));
    debugLog.info("Pi Panel 加载完成");
  }

  onunload() {
    debugLog.info("Pi Panel 卸载");
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PI_PANEL);
  }

  /** 日志落盘到插件目录（桌面端）；失败不影响使用 */
  private setupLogFile() {
    if (!Platform.isDesktopApp) return; // 手机没有 fs/真实路径，只用内存日志
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("path");
      const base = (this.manifest as any)?.dir;
      const vaultPath = (this.app.vault.adapter as any)?.getBasePath?.() || "";
      const dir = base && vaultPath ? path.join(vaultPath, base) : "";
      if (dir) debugLog.setFile(path.join(dir, "pi-panel-debug.log"));
    } catch (e: any) {
      debugLog.error(`设定日志文件失败：${String(e?.message || e)}`);
    }
  }

  openDebug() {
    const anyView = this.panelViews()[0];
    if (anyView?.openDebug) { anyView.openDebug(); return; }
    new DebugModal(this.app, () => `Pi Panel v${this.manifest?.version || "?"}（面板未打开）\n日志文件：${debugLog.getFile() || "(未启用)"}`).open();
  }

  openModelManager() {
    new ModelManagerModal(this.app, () => {
      const errs = validateModelsFile(loadModelsFile().data);
      if (errs.length) new Notice(`models.json 校验问题：${errs[0]}`, 8000);
      this.bouncePanels();
    }).open();
  }

  private panelViews(): any[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_PI_PANEL).map((l) => l.view as any);
  }

  /** 取模型列表：优先让已打开的面板去问 pi，否则退回 models.json */
  async fetchModels(): Promise<ModelInfo[]> {
    const view = this.panelViews()[0];
    if (view?.fetchModels) {
      const { models } = await view.fetchModels();
      return models;
    }
    const { data } = loadModelsFile();
    const out: ModelInfo[] = [];
    for (const [provider, p] of Object.entries(data.providers)) {
      for (const m of p.models || []) {
        out.push({ id: m.id, name: m.name, provider, reasoning: m.reasoning, contextWindow: m.contextWindow, source: "config" });
      }
    }
    return out;
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
      debugLog.error(`registerView 失败：${String((e as any)?.message || e)}`);
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

  /** 设置变更后重启所有已打开面板里的 pi 进程 */
  bouncePanels() {
    debugLog.info("设置变更 → 重启面板 pi 进程");
    this.panelViews().forEach((view) => {
      if (typeof view?.resetPiProcess === "function") view.resetPiProcess();
    });
  }

  async loadSettings() {
    const raw = await this.loadData();
    Object.assign(this.settings, DEFAULT_SETTINGS, raw || {});
    // 旧配置迁移：persistSession:boolean → sessionMode
    if (raw && typeof raw.persistSession === "boolean" && raw.sessionMode === undefined) {
      this.settings.sessionMode = raw.persistSession ? "persist" : "ephemeral";
    }
    // 旧默认白名单（无 bash/grep/find/ls）→ 升级成新默认，否则 pi 连目录都列不了
    if (raw && raw.piAllowedTools === "read,edit,write") {
      this.settings.piAllowedTools = DEFAULT_SETTINGS.piAllowedTools;
      debugLog.info(`工具白名单旧默认 read,edit,write → 升级为 ${this.settings.piAllowedTools}（旧值缺 bash/grep/find/ls）`);
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
      .setName("连接模式")
      .setDesc("本地 = 在这台设备上跑 pi（桌面）。远程 = 连电脑上的桥（手机装同一个插件用这个）")
      .addDropdown(d => d
        .addOption("local", "本地（本机 pi）")
        .addOption("remote", "远程（连电脑的桥）")
        .setValue(this.plugin.settings.connectionMode || "local")
        .onChange(async (v) => {
          this.plugin.settings.connectionMode = v as any;
          await this.plugin.saveSettings();
          this.plugin.bouncePanels();
        }));
    new Setting(containerEl)
      .setName("桥地址")
      .setDesc("远程模式用。电脑上运行：python tools/pi_rpc_bridge.py --port 8770 --token <随机串>；这里填 ws://电脑IP:8770")
      .addText(t => t
        .setPlaceholder("ws://192.168.1.2:8770")
        .setValue(this.plugin.settings.bridgeUrl || "")
        .onChange(async (v) => {
          this.plugin.settings.bridgeUrl = v.trim();
          await this.plugin.saveSettings();
          this.plugin.bouncePanels();
        }));
    new Setting(containerEl)
      .setName("桥 token")
      .setDesc("与启动桥时的 --token 完全一致；留空表示桥没设 token")
      .addText(t => t
        .setPlaceholder("（与桥的 --token 相同）")
        .setValue(this.plugin.settings.bridgeToken || "")
        .onChange(async (v) => {
          this.plugin.settings.bridgeToken = v.trim();
          await this.plugin.saveSettings();
          this.plugin.bouncePanels();
        }));
    new Setting(containerEl)
      .setName("pi 可执行文件")
      .setDesc("本地模式用。默认 pi。若 Obsidian 找不到命令（PATH 缺失），填绝对路径，如 %APPDATA%\\npm\\pi.cmd")
      .addText(t => t
        .setPlaceholder("pi")
        .setValue(this.plugin.settings.piExecutable)
        .onChange(async (v) => {
          this.plugin.settings.piExecutable = v.trim() || "pi";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("工具权限（传给 pi --tools）")
      .setDesc("勾选 pi 能用的内置工具。bash = 能跑任意命令（pi 官方默认就是这么开的）；不勾就只能读写笔记");
    renderToolsPicker(containerEl, () => this.plugin.settings.piAllowedTools, (v) => {
      this.plugin.settings.piAllowedTools = v;
      void this.plugin.saveSettings();
      this.plugin.bouncePanels();
    });

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
          this.plugin.bouncePanels();
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
          this.plugin.bouncePanels();
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
          this.plugin.bouncePanels();
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

    let modelTextRef: { setValue: (v: string) => void } | null = null;
    new Setting(containerEl)
      .setName("默认模型")
      .setDesc("启动 pi 时传给 --model。点「选择…」从列表里挑，不用手打；留空 = 用 pi 自己的设置")
      .addText(t => {
        modelTextRef = t as any;
        t.setPlaceholder("provider/model-id")
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (v) => {
            this.plugin.settings.defaultModel = v.trim();
            await this.plugin.saveSettings();
            this.plugin.bouncePanels();
          });
      })
      .addButton(b => b
        .setButtonText("选择…")
        .onClick(async () => {
          const models = await this.plugin.fetchModels().catch(() => [] as ModelInfo[]);
          if (!models.length) new Notice("没读到模型：先启动一次面板，或编辑 models.json", 6000);
          new ModelPickerModal(this.app, {
            favorites: this.plugin.settings.favoriteModels || [],
            load: async () => models,
            onPick: (provider, id) => {
              this.plugin.settings.defaultModel = `${provider}/${id}`;
              modelTextRef?.setValue(this.plugin.settings.defaultModel);
              void this.plugin.saveSettings();
              this.plugin.bouncePanels();
            },
            onToggleFavorite: (key) => {
              const list = [...(this.plugin.settings.favoriteModels || [])];
              const i = list.indexOf(key);
              if (i >= 0) list.splice(i, 1); else list.push(key);
              this.plugin.settings.favoriteModels = list;
              void this.plugin.saveSettings();
            },
            onManage: () => this.plugin.openModelManager(),
          }).open();
        }))
      .addExtraButton(b => b
        .setIcon("settings-2")
        .setTooltip("管理模型（编辑 ~/.pi/agent/models.json）")
        .onClick(() => this.plugin.openModelManager()));

    new Setting(containerEl)
      .setName("Vault 根目录（只读）")
      .setDesc("pi 的笔记根目录")
      .addText(t => { t.setValue(cwd); t.setDisabled(true); });

    new Setting(containerEl)
      .setName("调试日志")
      .setDesc(`记录 pi 启动命令 / RPC 原文 / 错误，写到插件目录 pi-panel-debug.log。出问题先看它（头部 🐞 按钮或命令面板「Pi 面板：查看调试日志」）`)
      .addButton(b => b.setButtonText("打开日志").onClick(() => this.plugin.openDebug()))
      .addButton(b => b.setButtonText("复制全部").onClick(() => {
        const text = debugLog.text();
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require("electron")?.clipboard?.writeText(text);
          new Notice(`已复制 ${debugLog.tail().length} 行日志`);
        } catch { new Notice("复制失败，请手动打开日志文件"); }
      }));
  }
}
