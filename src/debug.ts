/**
 * 调试日志弹窗 —— 给用户看/复制/导出 pi 的原始 RPC 日志与启动环境
 */

import { App, Modal, Notice } from "obsidian";
import { debugLog } from "./log";

export class DebugModal extends Modal {
  private getInfo: () => string;
  private onRestart?: () => void;
  private listEl!: HTMLElement;
  private follow = true;
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, getInfo: () => string, onRestart?: () => void) {
    super(app);
    this.getInfo = getInfo;
    this.onRestart = onRestart;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-debug-modal");
    contentEl.createEl("h3", { text: "Pi Panel 调试日志" });

    const info = contentEl.createEl("pre", { cls: "pi-debug-info" });
    info.setText(this.getInfo());

    const bar = contentEl.createDiv("pi-debug-bar");
    const mk = (label: string, fn: () => void, cls = "") => {
      const b = bar.createEl("button", { text: label, cls });
      b.addEventListener("click", fn);
      return b;
    };
    mk("复制全部", () => {
      const text = this.getInfo() + "\n\n" + debugLog.text();
      copyToClipboard(text);
      new Notice(`已复制 ${debugLog.tail().length} 行日志到剪贴板`);
    }, "mod-cta");
    mk("清空", () => { debugLog.clear(); this.render(); });
    mk("打开日志文件", () => {
      const file = debugLog.getFile();
      if (!file) { new Notice("未启用落盘日志"); return; }
      openPath(file);
    });
    const followBtn = mk("自动滚动：开", () => {
      this.follow = !this.follow;
      followBtn.setText(this.follow ? "自动滚动：开" : "自动滚动：关");
      if (this.follow) this.scrollToEnd();
    });
    if (this.onRestart) {
      mk("重启 pi 进程", () => {
        this.onRestart?.();
        new Notice("已重启 pi 进程");
        window.setTimeout(() => this.render(), 300);
      });
    }

    contentEl.createDiv({ cls: "pi-debug-hint", text: `日志文件：${debugLog.getFile() || "(未启用)"}　·　内存中 ${debugLog.tail().length} 行` });

    this.listEl = contentEl.createEl("pre", { cls: "pi-debug-log" });
    this.render();
    this.unsubscribe = debugLog.onChange(() => {
      if (this.follow) this.render();
    });
  }

  onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private render() {
    if (!this.listEl) return;
    this.listEl.setText(debugLog.text() || "(暂无日志)");
    if (this.follow) this.scrollToEnd();
  }

  private scrollToEnd() {
    const el = this.listEl;
    if (el) el.scrollTop = el.scrollHeight;
  }
}

function copyToClipboard(text: string) {
  try {
// eslint-disable-next-line @typescript-eslint/no-var-requires -- electron 仅桌面端存在，取不到时回退 navigator.clipboard
    const electron = require("electron");
    if (electron?.clipboard?.writeText) { electron.clipboard.writeText(text); return; }
  } catch { /* 非 electron 环境，退回 navigator */ }
  try { navigator.clipboard?.writeText?.(text); } catch { /* 忽略 */ }
}

function openPath(file: string) {
  try {
// eslint-disable-next-line @typescript-eslint/no-var-requires -- electron 仅桌面端存在，取不到时不提示
    const electron = require("electron");
    if (electron?.shell?.openPath) electron.shell.openPath(file);
  } catch (e: any) {
    new Notice(`打开失败：${String(e?.message || e)}`);
  }
}
