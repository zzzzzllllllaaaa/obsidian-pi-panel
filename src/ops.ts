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

/** 面板视图该有的两个方法（deferred 视图一个都没有） */
type OpsViewLike = { refresh?: () => void; render?: () => void; getViewType?: () => string };

/**
 * 这个 leaf 是不是「AI 操作记录」面板。
 * 注意：后台 tab 是 deferred view，`view.getViewType()` 可能直接返回 `pi-ops-view`
 * 而其实什么方法都没有（实测就是这样，`getLeavesOfType` 也数不到）。
 * 所以判据 = 实时类型 / 存的 state 类型 / 视图自己会不会 render。
 */
export function isOpsLeaf(leaf: WorkspaceLeaf): boolean {
  const view = (leaf as any)?.view as OpsViewLike | undefined;
  const liveType = typeof view?.getViewType === "function" ? view.getViewType() : "";
  const raw: any = (leaf as any).getViewState?.() || {};
  const inner = typeof raw.state === "string" ? raw.state : raw.state?.type;
  const stateType = raw.type === "deferred" ? inner : raw.type;
  if (liveType === VIEW_TYPE_PI_OPS || stateType === VIEW_TYPE_PI_OPS) return true;
  return false;
}

/** 这个 leaf 里的视图是不是已经真的建好了（deferred 视图建不出来） */
export function isOpsViewLive(leaf: WorkspaceLeaf): boolean {
  const view = (leaf as any)?.view as OpsViewLike | undefined;
  return typeof view?.refresh === "function" || typeof view?.render === "function";
}

/** 扫描整个 workspace 找「AI 操作记录」的 leaf（含后台 deferred tab） */
export function findOpsLeaves(app: App): WorkspaceLeaf[] {
  const out: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    if (isOpsLeaf(leaf)) out.push(leaf);
  });
  return out;
}

/** 把 deferred 的 leaf 逼成真视图（保留原位置，不新开面板） */
export async function materializeOpsLeaf(leaf: WorkspaceLeaf): Promise<boolean> {
  try {
    await leaf.setViewState({ type: VIEW_TYPE_PI_OPS, active: false });
    return true;
  } catch {
    return false;
  }
}

/** 打开（或聚焦）AI 操作记录面板：已是 deferred 的原 tab 会被就地建出来，找不到才新开在右侧栏 */
export async function openOpsView(app: App) {
  const existing = findOpsLeaves(app);
  if (existing.length) {
    const leaf = existing[0];
    if (!isOpsViewLive(leaf)) await materializeOpsLeaf(leaf);
    app.workspace.revealLeaf(leaf);
    return;
  }
  const leaf: WorkspaceLeaf | null = app.workspace.getRightLeaf(false);
  if (leaf) await leaf.setViewState({ type: VIEW_TYPE_PI_OPS, active: true });
  const created = findOpsLeaves(app)[0];
  if (created) app.workspace.revealLeaf(created);
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

export const OPS_ALL = "*";

/** 默认监听目录；在设置页可改（每行一个 vault 相对路径） */
export const DEFAULT_OPS_FOLDERS = [
  "小助理工作区/项目",
  "小助理工作区/反馈",
  "小助理工作区/资源",
  "小助理工作区/经验",
];

export function parseOpsFolders(v: string): string[] {
  const raw = String(v || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    const t = s.replace(/\\/g, "/");
    // "/"、"*"、"**" → 整个库（.obsidian/.trash 除外）
    if (/^\/*$/.test(t) || /^\*+$/.test(t) || t === "全部" || t.toLowerCase() === "all") {
      return [OPS_ALL];
    }
    const d = t.replace(/^\/+|\/+$/g, "");
    if (d) out.push(d);
  }
  return out;
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
  /** 面板订阅：记录一变就重画（不依赖插件层去找 leaf） */
  private listeners: Array<() => void> = [];

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

  /** 面板 onOpen 时订阅，onClose 时取消 */
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private notify() {
    this.onChange();
    for (const fn of this.listeners.slice()) {
      try { fn(); } catch { /* 单个订阅者出错不影响别人 */ }
    }
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
    this.notify();
    return entry;
  }

  /** 预览是异步补的，补完要让它重画 */
  touch() {
    this.notify();
  }

  clear() {
    this.entries = [];
    this.notify();
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
    // 插件配置目录 / 回收站里的变动不算笔记
    if (p.startsWith(".obsidian/") || p.startsWith(".trash/")) return false;
    const folders = getFolders();
    if (folders.includes(OPS_ALL)) return true;
    return folders.some((d) => p === d || p.startsWith(d + "/"));
  };

  const fillPreview = (entry: OpEntry, file: any) => {
    try {
      void plugin.app.vault
        .cachedRead(file)
        .then((c: string) => {
          entry.preview = String(c || "").slice(0, 160).replace(/\s+/g, " ").trim();
          log.touch();
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
