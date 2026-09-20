import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { OpsLog, renderOpsList, VIEW_TYPE_PI_OPS } from "./ops";
import { debugLog } from "./log";

/** AI 操作记录——独立面板（不再挤在 pi 面板里） */
export class PiOpsView extends ItemView {
  private opsLog: OpsLog;
  private titleEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, opsLog: OpsLog) {
    super(leaf);
    this.opsLog = opsLog;
    // 记录一变就重画：不依赖插件层去「找到这个 leaf」（后台 tab 是 deferred，找不到）
    this.unsubscribe = this.opsLog.subscribe(() => this.render());
  }

  getViewType() { return VIEW_TYPE_PI_OPS; }
  getDisplayText() { return "AI 操作记录"; }
  getIcon() { return "list"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("pi-ops-view");

    const head = root.createDiv("pi-ops-head");
    this.titleEl = head.createSpan({ cls: "pi-ops-title", text: "" });
    head.createDiv("pi-ops-spacer");
    const mkBtn = (label: string, tip: string, fn: () => void) => {
      const b = head.createEl("button", { cls: "pi-ops-btn", text: label });
      b.title = tip;
      b.addEventListener("click", fn);
    };
    mkBtn("刷新", "重新渲染列表", () => this.render());
    mkBtn("清空", "清空记录（不动笔记内容）", () => { this.opsLog.clear(); this.render(); });

    this.listEl = root.createDiv("pi-ops-list");
    this.render();
  }

  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.titleEl = null;
    this.listEl = null;
  }

  /** 插件层（main.ts refreshOpsViews）通过这个方法要求重画 */
  refresh() {
    this.render();
  }

  render() {
    const entries = this.opsLog.entries;
    this.titleEl?.setText(`AI 操作记录（${entries.length}）`);
    if (!this.listEl) return;
    renderOpsList(this.listEl, entries, (path) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    });
    debugLog.info(`操作记录面板：渲染 ${entries.length} 条`);
  }
}
