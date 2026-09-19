import { App, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";

/** 操作记录里的一条：vault 文件被创建 / 修改 / 删除 / 重命名 */
export type OpType = "create" | "modify" | "delete" | "rename";

export interface OpEntry {
  type: OpType;
  /** vault 相对路径 */
  path: string;
  /** 文件名（列表主行显示） */
  file: string;
  /** HH:MM */
  time: string;
  /** 时间戳（ms） */
  ts: number;
  /** 前 160 字预览（create/modify 且有内容时填） */
  preview?: string;
}

/** 记录上限（超出丢最旧的） */
export const OPS_MAX = 300;

/** 独立面板的视图类型（AI 操作记录，单独一个 leaf） */
export const VIEW_TYPE_PI_OPS = "pi-ops-view";

/** 打开（或聚焦）AI 操作记录面板：没有就开在右侧栏 */
export async function openOpsView(app: App) {
  if (!app.workspace.getLeavesOfType(VIEW_TYPE_PI_OPS).length) {
    const leaf: WorkspaceLeaf | null = app.workspace.getRightLeaf(false);
    if (leaf) await leaf.setViewState({ type: VIEW_TYPE_PI_OPS, active: true });
  }
  const leaf = app.workspace.getLeavesOfType(VIEW_TYPE_PI_OPS)[0];
  if (leaf) app.workspace.revealLeaf(leaf);
}

/** 列表渲染：独立面板用；点一行打开对应笔记 */
export function renderOpsList(box: HTMLElement, entries: OpEntry[], openFile: (path: string) => void) {
  box.empty();
  if (!entries.length) {
    box.createDiv({
      cls: "pi-ops-empty",
      text: "暂无记录。pi 在监听目录里新建/修改/删除文件时会留痕；监听目录见设置页。",
    });
    return;
  }
  for (const op of entries.slice().reverse()) {
    const row = box.createDiv(`pi-ops-row pi-op-${op.type}`);
    const ic = row.createDiv("pi-ops-ic");
    setIcon(ic, op.type === "create" ? "file-plus" : op.type === "delete" ? "trash" : op.type === "rename" ? "pencil" : "file-pen");
    const body = row.createDiv("pi-ops-body");
    const top = body.createDiv("pi-ops-top");
    top.createSpan({ cls: "pi-ops-file", text: op.file });
    top.createSpan({ cls: "pi-ops-time", text: op.time });
    body.createDiv({ cls: "pi-ops-path", text: op.path });
    if (op.preview) body.createDiv({ cls: "pi-ops-preview", text: op.preview.slice(0, 160) });
    row.addEventListener("click", () => openFile(op.path));
  }
}

/** 默认监听目录；在设置页可改（每行一个 vault 相对路径） */
export const DEFAULT_OPS_FOLDERS = [
  "小助理工作区/项目",
  "小助理工作区/反馈",
  "小助理工作区/资源",
  "小助理工作区/经验",
];

export function parseOpsFolders(v: string): string[] {
  return String(v || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtOpTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 操作记录（内存 + data.json 持久化，由插件层持有，面板只读渲染） */
export class OpsLog {
  entries: OpEntry[] = [];
  private onChange: () => void;

  constructor(onChange: () => void = () => { /* noop */ }) {
    this.onChange = onChange;
  }

  load(raw: any) {
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
    this.entries = arr
      .filter((e: any) => e && typeof e.path === "string")
      .slice(-OPS_MAX);
  }

  serialize(): OpEntry[] {
    return this.entries.slice(-OPS_MAX);
  }

  add(type: OpType, path: string): OpEntry {
    const ts = Date.now();
    const entry: OpEntry = {
      type,
      path,
      file: path.split("/").pop() || path,
      time: fmtOpTime(ts),
      ts,
    };
    this.entries.push(entry);
    if (this.entries.length > OPS_MAX) this.entries.splice(0, this.entries.length - OPS_MAX);
    this.onChange();
    return entry;
  }

  clear() {
    this.entries = [];
    this.onChange();
  }
}

/**
 * 监听 vault 变更写进 OpsLog。
 * - 只记 getFolders() 覆盖的路径（返回空数组 = 全部忽略，用于「关闭记录」）
 * - modify 去抖 800ms（pi 写一次文件会触发多个事件）
 * - create/modify 读前 160 字做预览，读失败留空
 */
export function registerOpsWatchers(
  plugin: Plugin,
  log: OpsLog,
  getFolders: () => string[],
  onChange: () => void,
) {
  const watched = (f: any): boolean => {
    if (!f || typeof f.path !== "string") return false;
    const p = f.path as string;
    const folders = getFolders();
    return folders.some((d) => p === d || p.startsWith(d + "/"));
  };

  const fillPreview = (entry: OpEntry, file: any) => {
    try {
      void plugin.app.vault
        .cachedRead(file)
        .then((c: string) => {
          entry.preview = String(c || "").slice(0, 160).replace(/\s+/g, " ").trim();
          onChange();
        })
        .catch(() => { /* 读不到就算了 */ });
    } catch { /* 同上 */ }
  };

  const timers = new Map<string, number>();

  const track = (type: OpType, file: any, preview: boolean) => {
    if (!watched(file)) return;
    const entry = log.add(type, file.path as string);
    if (preview && file instanceof TFile) fillPreview(entry, file);
    onChange();
  };

  plugin.registerEvent(plugin.app.vault.on("create", (f) => track("create", f, true)));
  plugin.registerEvent(plugin.app.vault.on("delete", (f) => track("delete", f, false)));
  plugin.registerEvent(plugin.app.vault.on("rename", (f, oldPath) => {
    if (!watched(f)) return;
    const entry = log.add("rename", f.path as string);
    entry.preview = `原路径：${oldPath}`;
    onChange();
  }));
  plugin.registerEvent(plugin.app.vault.on("modify", (f) => {
    if (!watched(f)) return;
    const key = f.path as string;
    const old = timers.get(key);
    if (old) window.clearTimeout(old);
    timers.set(key, window.setTimeout(() => {
      timers.delete(key);
      track("modify", f, true);
    }, 800));
  }));
}
