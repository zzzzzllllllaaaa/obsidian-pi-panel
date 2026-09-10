/**
 * Pi Panel — 在 Obsidian 侧边栏里使用 pi coding agent
 */

import {
  ItemView, WorkspaceLeaf, Platform, MarkdownView, TFile, Notice, setIcon, MarkdownRenderer, Modal,
} from "obsidian";
import { PiRpcClient } from "./rpc";
import { PiPanelSettings, PiSettingsModal } from "./settings";
import { listSessions, PiSessionInfo } from "./sessions";

export const VIEW_TYPE_PI_PANEL = "pi-panel-view";

type Status = "idle" | "starting" | "ready" | "streaming" | "exited" | "error";

interface Attachment {
  kind: "note" | "selection" | "image";
  label: string;
  detail?: string;
  path?: string;
  content?: string;
  /** 笔记超长，只给 @路径，让 pi 自己读 */
  truncated?: boolean;
  data?: string;
  mimeType?: string;
}

const TOOL_ICONS: Record<string, string> = {
  bash: "terminal",
  read: "file-text",
  write: "file-plus",
  edit: "file-edit",
  grep: "search",
  find: "folder-search",
  glob: "folder-search",
  ls: "folder",
  list: "folder",
  web: "globe",
  webfetch: "globe",
  todo: "list-checks",
};

interface SessionPickerCallbacks {
  onPick: (info: PiSessionInfo) => void;
  onNew: () => void;
  onResumeLast: () => void;
}

/** 历史会话选择器：列出当前 cwd 的 pi 会话文件 */
export class PiSessionPickerModal extends Modal {
  private cwd: string;
  private items: PiSessionInfo[];
  private cb: SessionPickerCallbacks;

  constructor(app: any, cwd: string, items: PiSessionInfo[], cb: SessionPickerCallbacks) {
    super(app);
    this.cwd = cwd;
    this.items = items;
    this.cb = cb;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pi-session-modal");
    contentEl.createEl("h3", { text: "历史会话" });
    contentEl.createDiv({ cls: "pi-session-cwd", text: `工作目录：${this.cwd || "(未知)"}` });

    const top = contentEl.createDiv("pi-session-top");
    const mkBtn = (label: string, fn: () => void) => {
      const b = top.createEl("button", { text: label });
      b.addEventListener("click", () => { this.close(); fn(); });
      return b;
    };
    mkBtn("新会话", () => this.cb.onNew());
    mkBtn("继续上次（--continue）", () => this.cb.onResumeLast());

    const list = contentEl.createDiv("pi-session-list");
    if (this.items.length === 0) {
      list.createDiv({ cls: "pi-session-empty", text: "该工作目录下没有已保存的会话。先聊几轮（会话策略=新会话并存盘），下次就能在这里看到。" });
      return;
    }

    for (const it of this.items) {
      const row = list.createDiv("pi-session-row");
      const time = row.createDiv("pi-session-time");
      time.setText(this.formatTime(it.mtimeMs));
      const body = row.createDiv("pi-session-body");
      body.createDiv({ cls: "pi-session-preview", text: it.preview || "(无文本消息)" });
      const meta = body.createDiv("pi-session-meta");
      const sameCwd = it.cwd === this.cwd;
      meta.setText(`${it.messageCount} msgs · ${it.id.slice(0, 8)}${sameCwd ? "" : " · " + it.cwd}`);
      row.addEventListener("click", () => { this.close(); this.cb.onPick(it); });
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  private formatTime(ms: number): string {
    if (!ms) return "?";
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

export class PiPanelView extends ItemView {
  private settings: PiPanelSettings;
  private saveSettings: () => Promise<void>;

  private rpc: PiRpcClient | null = null;
  private status: Status = "idle";
  private statusDetail = "";

  private lastMarkdownView: MarkdownView | null = null;
  private attachments: Attachment[] = [];
  /** 用户选定的历史会话文件；null = 按设置里会话策略开会话 */
  private selectedSession: string | null = null;

  // DOM
  private statusPill!: HTMLElement;
  private modelChip!: HTMLElement;
  private chatEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private jumpBtn!: HTMLElement;
  private typingEl: HTMLElement | null = null;

  // 流状态
  private currentCol: HTMLElement | null = null;
  private currentTextEl: HTMLElement | null = null;
  private currentThink: { wrap: HTMLDetailsElement; body: HTMLElement; text: string } | null = null;
  private toolCards = new Map<string, { el: HTMLElement; out: HTMLElement; text: string; startedAt: number }>();
  private pinned = true;
  private pendingHistory = false;

  constructor(leaf: WorkspaceLeaf, settings: PiPanelSettings, saveSettings: () => Promise<void>) {
    super(leaf);
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  getViewType(): string { return VIEW_TYPE_PI_PANEL; }
  getDisplayText(): string { return "Pi"; }
  getIcon(): string { return "terminal"; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("pi-root");

    // 记住最近一次 markdown 视图（侧边栏获得焦点后 getActiveViewOfType 会返回 null）
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.rememberMarkdownView()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.rememberMarkdownView()));
    this.rememberMarkdownView();

    this.buildHeader(root);

    if (!Platform.isDesktopApp) {
      const warn = root.createDiv("pi-banner");
      warn.setText("Pi Panel 仅支持桌面端（需要在本机调用 pi CLI）。");
      return;
    }

    this.chatEl = root.createDiv("pi-chat");
    this.chatEl.addEventListener("scroll", () => {
      const el = this.chatEl;
      this.pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      this.jumpBtn?.toggleClass("is-visible", !this.pinned);
    });

    this.jumpBtn = root.createDiv("pi-jump");
    setIcon(this.jumpBtn, "arrow-down");
    this.jumpBtn.toggleClass("is-visible", false);
    this.jumpBtn.addEventListener("click", () => this.scrollToBottom(true));

    this.buildEmptyState();
    this.buildComposer(root);
    this.setStatus("idle");
  }

  async onClose() {
    this.rpc?.stop();
    this.rpc = null;
  }

  // ── 头部 ──────────────────────────────────

  private buildHeader(root: HTMLElement) {
    const head = root.createDiv("pi-head");

    const logo = head.createDiv("pi-logo");
    logo.setText("π");

    const txt = head.createDiv("pi-head-txt");
    const title = txt.createDiv("pi-title");
    title.setText("Pi Agent");
    this.modelChip = txt.createDiv("pi-sub pi-muted");
    this.modelChip.setText("未连接");

    const actions = head.createDiv("pi-head-actions");
    this.statusPill = actions.createSpan("pi-pill");
    this.statusPill.setText("未启动");

    const iconBtn = (icon: string, tip: string, onClick: () => void) => {
      const b = actions.createEl("button", { cls: "pi-icon-btn" });
      b.setAttribute("aria-label", tip);
      b.title = tip;
      setIcon(b, icon);
      b.addEventListener("click", onClick);
      return b;
    };
    iconBtn("history", "历史会话", () => this.openSessionPicker());
    iconBtn("plus", "新会话", () => this.newSession());
    iconBtn("eraser", "清空界面", () => this.clearChat());
    iconBtn("settings", "设置", () => this.openSettings());
  }

  private setStatus(s: Status, detail = "") {
    this.status = s;
    this.statusDetail = detail;
    if (!this.statusPill) return;
    const label: Record<Status, string> = {
      idle: "未启动",
      starting: "启动中",
      ready: "就绪",
      streaming: "运行中",
      exited: "已退出",
      error: "出错",
    };
    this.statusPill.className = `pi-pill pi-pill-${s}`;
    this.statusPill.setText(detail ? `${label[s]} · ${detail}` : label[s]);
    if (this.sendBtn) {
      const busy = s === "streaming";
      this.sendBtn.toggleClass("is-busy", busy);
      this.stopBtn?.toggleClass("is-active", busy);
    }
  }

  private openSettings() {
    new PiSettingsModal(this.app, this.settings, this.workingDir(), async (s) => {
      Object.assign(this.settings, s);
      await this.saveSettings();
      this.resetPiProcess();
      new Notice("Pi Panel 设置已保存，pi 进程已重置（下条消息生效）");
    }).open();
  }

  /** 设置变更后重启 pi 进程，让新参数（cwd / 工具白名单 / 附加系统提示）生效 */
  resetPiProcess() {
    this.rpc?.stop();
    this.rpc = null;
    this.hideTyping();
    this.setStatus("idle", "设置已变更");
  }

  private workingDir(): string {
    try {
      const adapter: any = this.app.vault.adapter;
      return typeof adapter?.getBasePath === "function" ? String(adapter.getBasePath()) : "";
    } catch {
      return "";
    }
  }

  // ── 空态 / 清空 ────────────────────────────

  private buildEmptyState() {
    const box = this.chatEl.createDiv("pi-empty");
    box.createDiv("pi-empty-logo").setText("π");
    box.createDiv("pi-empty-title").setText("边看笔记，边问 pi");
    box.createDiv("pi-empty-desc").setText(
      "pi 以 vault 为工作目录，可以读写笔记、跑命令。引用按钮会把当前笔记或选中段落放进上下文。"
    );
    const row = box.createDiv("pi-empty-actions");
    const b1 = row.createEl("button", { text: "引用当前笔记" });
    b1.addEventListener("click", () => this.addCurrentNote());
    const b2 = row.createEl("button", { text: "引用选区" });
    b2.addEventListener("click", () => this.addSelection());
    const b3 = row.createEl("button", { text: "设置 pi 路径" });
    b3.addEventListener("click", () => this.openSettings());

    const hint = this.chatEl.createDiv("pi-hint");
    hint.setText("需要本机已安装 pi CLI（终端里 `pi --help` 可用）。未安装时在设置里指定可执行文件路径。");
  }

  private clearChat() {
    this.chatEl.empty();
    this.toolCards.clear();
    this.currentCol = null;
    this.currentTextEl = null;
    this.currentThink = null;
    this.buildEmptyState();
  }

  // ── 进程 ──────────────────────────────────

  private ensureRpc(): boolean {
    if (this.rpc?.running) return true;

    const args = ["--mode", "rpc"];
    if (this.selectedSession) {
      args.push("--session", this.selectedSession);
    } else if (this.settings.sessionMode === "ephemeral") {
      args.push("--no-session");
    } else if (this.settings.sessionMode === "resume") {
      args.push("--continue");
    }
    const tools = String(this.settings.piAllowedTools || "").trim();
    if (tools) args.push("--tools", tools);

    const vault = this.workingDir();
    const cwd = this.effectiveCwd();
    if (vault && cwd && cwd !== vault) {
      args.push(
        "--append-system-prompt",
        `Obsidian 笔记库(vault)根目录: ${vault}\n本次工作目录: ${cwd}\n所有笔记都在 vault 下；引用/读取笔记时请用绝对路径。`,
      );
    }
    const extra = String(this.settings.extraSystemPromptPath || "").trim();
    if (extra) args.push("--append-system-prompt", extra);
    this.rpc = new PiRpcClient({
      exe: this.settings.piExecutable || "pi",
      args,
      cwd,
      onEvent: (evt) => this.handleEvent(evt),
      onError: (msg) => {
        this.setStatus("error", "进程");
        this.systemLine(`pi 启动失败：${msg}`, "pi-err");
      },
      onExit: (code, signal) => {
        this.setStatus("exited", `code=${code}${signal ? " " + signal : ""}`);
        this.rpc = null;
      },
      onStderr: (text) => this.systemLine(text.slice(0, 1500), "pi-stderr"),
    });

    this.setStatus("starting");
    const ok = this.rpc.start();
    if (!ok) return false;
    this.rpc.getState();
    if (this.selectedSession) {
      this.pendingHistory = true;
      this.rpc.getMessages();
    }
    return true;
  }

  /** pi 的实际工作目录（可与 vault 分开） */
  private effectiveCwd(): string {
    return String(this.settings.cwd || "").trim() || this.workingDir();
  }

  // ── 事件 ──────────────────────────────────

  private handleEvent(evt: any) {
    switch (evt?.type) {
      case "response":
        if (evt.success === false) {
          this.systemLine(`命令失败：${evt.command || "?"} — ${evt.error || ""}`, "pi-err");
        } else if (evt.command === "get_state" && evt.data) {
          this.applyState(evt.data);
        } else if (evt.command === "get_messages" && evt.data) {
          this.renderHistory(evt.data.messages);
        }
        break;

      case "agent_start":
        this.setStatus("streaming");
        this.showTyping();
        break;

      case "agent_end": {
        this.hideTyping();
        this.finalizeTurn();
        this.setStatus("ready");
        const msgs = Array.isArray(evt.messages) ? evt.messages.length : 0;
        if (msgs) this.modelChip.setText(this.modelChip.getText().split(" · ")[0] + ` · ${msgs} msgs`);
        this.rpc?.getState();
        break;
      }

      case "turn_start":
        break;

      case "message_start":
        if (evt.message?.role === "assistant") {
          this.hideTyping();
          this.beginTurn();
        }
        break;

      case "message_update":
        this.handleDelta(evt.assistantMessageEvent);
        break;

      case "message_end":
        if (this.currentThink) this.finishThink();
        break;

      case "tool_execution_start":
        this.hideTyping();
        this.toolStart(evt.toolCallId, evt.toolName, evt.args);
        break;

      case "tool_execution_update":
        this.toolUpdate(evt.toolCallId, evt.partialResult);
        break;

      case "tool_execution_end":
        this.toolEnd(evt.toolCallId, evt.result, Boolean(evt.isError));
        break;

      case "auto_retry_start":
        this.systemLine(`请求失败，重试 ${evt.attempt}/${evt.maxAttempts}…`, "pi-sys");
        break;

      case "extension_error":
        this.systemLine(`扩展错误：${evt.error || ""}`, "pi-err");
        break;

      case "extension_ui_request":
        this.handleExtensionUi(evt);
        break;

      default:
        break;
    }
  }

  private applyState(data: any) {
    const model = data?.model?.id || data?.model?.name || "unknown";
    const thinking = data?.thinkingLevel ? ` · ${data.thinkingLevel}` : "";
    const count = typeof data?.messageCount === "number" ? ` · ${data.messageCount} msgs` : "";
    const sid = data?.sessionId ? ` · ${String(data.sessionId).slice(0, 8)}` : data?.sessionFile ? "" : " · 不保存";
    this.modelChip.setText(`${model}${thinking}${count}${sid}`);
    if (data?.isStreaming) this.setStatus("streaming");
    else if (this.status !== "error") this.setStatus("ready");
  }

  /** 恢复历史会话时把消息回放到界面 */
  private renderHistory(messages: any[]) {
    if (!this.pendingHistory) return;
    this.pendingHistory = false;
    if (!Array.isArray(messages) || messages.length === 0) return;

    this.chatEl.empty();
    this.buildEmptyState();
    let shown = 0;
    for (const msg of messages) {
      const role = msg?.role;
      const content = msg?.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text || "").join("")
          : "";
      if (!text) continue;
      if (role === "user") {
        this.userMessage(text, []);
        shown++;
      } else if (role === "assistant") {
        const col = this.beginTurn();
        const el = col.createDiv("pi-md");
        this.renderMarkdown(el, text);
        this.currentCol = null;
        shown++;
      }
    }
    if (shown) this.systemLine(`已恢复 ${shown} 条历史消息`, "pi-sys");
    this.scrollToBottom(true);
  }

  // ── 渲染：消息 ─────────────────────────────

  private beginTurn(): HTMLElement {
    this.currentTextEl = null;
    this.currentThink = null;
    const row = this.chatEl.createDiv("pi-row pi-row-bot");
    const av = row.createDiv("pi-avatar");
    av.setText("π");
    const col = row.createDiv("pi-col");
    this.currentCol = col;
    return col;
  }

  private ensureCol(): HTMLElement {
    if (!this.currentCol) return this.beginTurn();
    return this.currentCol;
  }

  private userMessage(text: string, atts: Attachment[]) {
    const row = this.chatEl.createDiv("pi-row pi-row-user");
    const bubble = row.createDiv("pi-bubble pi-user");
    if (atts.length) {
      const chips = bubble.createDiv("pi-bubble-chips");
      for (const a of atts) {
        const c = chips.createSpan("pi-chip-static");
        const ic = c.createSpan("pi-chip-ic");
        setIcon(ic, a.kind === "image" ? "image" : a.kind === "selection" ? "text-select" : "file-text");
        c.createSpan({ text: a.label });
      }
    }
    if (text) {
      const body = bubble.createDiv("pi-bubble-body");
      body.setText(text);
    }
    this.scrollToBottom();
  }

  private handleDelta(d: any) {
    if (!d) return;
    switch (d.type) {
      case "thinking_start":
        this.hideTyping();
        this.beginThink();
        break;
      case "thinking_delta":
        this.appendThink(d.delta || "");
        break;
      case "thinking_end":
        this.finishThink();
        break;
      case "text_start":
        this.hideTyping();
        this.beginText();
        break;
      case "text_delta":
        this.appendText(d.delta || "");
        break;
      case "text_end":
        this.commitText(String(d.content || ""));
        break;
      case "error":
        this.systemLine(`回合中断：${d.reason || "error"}`, "pi-err");
        break;
      default:
        break;
    }
  }

  private beginText() {
    const col = this.ensureCol();
    this.currentTextEl = col.createDiv("pi-md");
  }

  private appendText(delta: string) {
    if (!this.currentTextEl) this.beginText();
    const el = this.currentTextEl as HTMLElement;
    el.setText((el.getText() || "") + delta);
    this.scrollToBottom();
  }

  private commitText(full: string) {
    if (!this.currentTextEl) this.beginText();
    const el = this.currentTextEl as HTMLElement;
    el.setText(full);
    el.setAttribute("data-raw", full);
    this.scrollToBottom();
  }

  private beginThink() {
    const col = this.ensureCol();
    const wrap = col.createEl("details", { cls: "pi-think" }) as HTMLDetailsElement;
    wrap.open = true;
    const sum = wrap.createEl("summary");
    sum.setText("思考中…");
    const body = wrap.createDiv("pi-think-body");
    this.currentThink = { wrap, body, text: "" };
    this.scrollToBottom();
  }

  private appendThink(delta: string) {
    if (!this.currentThink) this.beginThink();
    const t = this.currentThink as { wrap: HTMLDetailsElement; body: HTMLElement; text: string };
    t.text += delta;
    t.body.setText(t.text);
    this.scrollToBottom();
  }

  private finishThink() {
    if (!this.currentThink) return;
    const t = this.currentThink;
    const sum = t.wrap.querySelector("summary") as HTMLElement | null;
    if (sum) sum.setText(`思考 · ${t.text.length} 字`);
    t.wrap.open = false;
    this.currentThink = null;
  }

  private finalizeTurn() {
    if (this.currentTextEl) {
      const raw = this.currentTextEl.getAttribute("data-raw");
      if (raw) this.renderMarkdown(this.currentTextEl, raw);
    }
    this.currentCol = null;
    this.currentTextEl = null;
    this.currentThink = null;
  }

  private renderMarkdown(el: HTMLElement, md: string) {
    try {
      el.empty();
      const MR: any = MarkdownRenderer as any;
      if (typeof MR.render === "function") {
        const p = MR.render(this.app, md, el, "", this);
        if (p && typeof p.catch === "function") p.catch(() => el.setText(md));
      } else if (typeof MR.renderMarkdown === "function") {
        const p = MR.renderMarkdown(md, el, "", this);
        if (p && typeof p.catch === "function") p.catch(() => el.setText(md));
      } else {
        el.setText(md);
      }
    } catch {
      el.setText(md);
    }
  }

  private systemLine(text: string, cls: string) {
    const el = this.chatEl.createDiv(cls);
    el.setText(text);
    this.scrollToBottom();
  }

  private showTyping() {
    if (this.typingEl) return;
    const col = this.currentCol || null;
    const host = col || this.chatEl;
    const el = host.createDiv("pi-typing");
    for (let i = 0; i < 3; i++) el.createSpan();
    this.typingEl = el;
    this.scrollToBottom();
  }

  private hideTyping() {
    if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  private scrollToBottom(force = false) {
    if (!force && !this.pinned) {
      this.jumpBtn?.toggleClass("is-visible", true);
      return;
    }
    this.pinned = true;
    this.jumpBtn?.toggleClass("is-visible", false);
    // 等一帧，让新增节点完成布局
    window.setTimeout(() => {
      if (this.chatEl) this.chatEl.scrollTop = this.chatEl.scrollHeight;
    }, 0);
  }

  // ── 渲染：工具卡 ───────────────────────────

  private toolArgSummary(name: string, args: any): string {
    if (!args || typeof args !== "object") return "";
    const pick = (k: string) => (typeof args[k] === "string" ? args[k] : "");
    const first: string =
      pick("command") || pick("path") || pick("pattern") || pick("url") || pick("query") ||
      Object.values(args).find(v => typeof v === "string") as string || "";
    const s = String(first || "").replace(/\s+/g, " ");
    if (!s) return "";
    return s.length > 70 ? s.slice(0, 70) + "…" : s;
  }

  private toolStart(id: string, name: string, args: any) {
    const col = this.ensureCol();
    const card = col.createDiv("pi-tool");
    card.setAttribute("data-state", "running");

    const head = card.createDiv("pi-tool-head");
    const ico = head.createSpan("pi-tool-ic");
    setIcon(ico, TOOL_ICONS[String(name || "").toLowerCase()] || "wrench");
    head.createSpan({ cls: "pi-tool-name", text: String(name || "tool") });
    const argText = this.toolArgSummary(name, args);
    if (argText) head.createSpan({ cls: "pi-tool-arg", text: argText });
    const time = head.createSpan("pi-tool-time");
    time.setText("…");

    const outWrap = card.createDiv("pi-tool-outwrap");
    outWrap.style.display = "none";
    const pre = outWrap.createEl("pre", { cls: "pi-tool-out" });
    pre.setText("");

    head.addEventListener("click", () => {
      outWrap.style.display = outWrap.style.display === "none" ? "block" : "none";
    });

    this.toolCards.set(id, { el: card, out: pre, text: "", startedAt: Date.now() });
    this.scrollToBottom();
  }

  private pickText(result: any): string {
    if (result == null) return "";
    if (typeof result === "string") return result;
    const content = result.content;
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).filter(Boolean).join("\n");
    }
    try { return JSON.stringify(result, null, 2); } catch { return String(result); }
  }

  private toolUpdate(id: string, partial: any) {
    const t = this.toolCards.get(id);
    if (!t) return;
    const text = this.pickText(partial);
    if (!text) return;
    t.text = text;
    t.out.setText(text.length > 6000 ? text.slice(0, 6000) + "\n…" : text);
    this.scrollToBottom();
  }

  private toolEnd(id: string, result: any, isError: boolean) {
    const t = this.toolCards.get(id);
    if (!t) return;
    const text = this.pickText(result) || t.text || "(无输出)";
    t.out.setText(text.length > 6000 ? text.slice(0, 6000) + "\n…" : text);
    t.el.setAttribute("data-state", isError ? "error" : "done");
    const time = t.el.querySelector(".pi-tool-time") as HTMLElement | null;
    if (time) time.setText(`${((Date.now() - t.startedAt) / 1000).toFixed(2)}s`);
    // 出错默认展开，成功保持折叠
    const outWrap = t.el.querySelector(".pi-tool-outwrap") as HTMLElement | null;
    if (outWrap && (isError || text.length < 400)) outWrap.style.display = "block";
    this.toolCards.delete(id);
    this.currentTextEl = null;
    this.scrollToBottom();
  }

  // ── 扩展 UI 弹窗 ───────────────────────────

  private handleExtensionUi(evt: any) {
    const method = String(evt?.method || "");
    const id = String(evt?.id || "");
    if (!id) return;

    if (method === "notify") {
      this.systemLine(String(evt.message || evt.text || ""), "pi-sys");
      return;
    }
    if (method === "setStatus") {
      if (evt.statusText) this.setStatus(this.status, String(evt.statusText).slice(0, 24));
      return;
    }
    if (method === "set_editor_text") {
      const t = String(evt.text || "");
      if (t) this.insertIntoComposer(t);
      return;
    }
    if (method === "setTitle" || method === "setWidget" || method === "set_working_message") return;

    const host = this.ensureCol();
    const box = host.createDiv("pi-eui");
    if (evt.title) box.createDiv({ cls: "pi-eui-title", text: String(evt.title) });
    if (evt.message) box.createDiv({ cls: "pi-eui-msg", text: String(evt.message) });
    const row = box.createDiv("pi-eui-row");

    const reply = (obj: any) => {
      this.rpc?.respond({ id, ...obj });
      row.querySelectorAll("button").forEach((b: any) => { b.disabled = true; });
      box.createDiv({ cls: "pi-eui-done", text: "已回复" });
      this.scrollToBottom();
    };

    if (method === "confirm") {
      const yes = row.createEl("button", { text: "允许", cls: "mod-cta" });
      yes.addEventListener("click", () => reply({ confirmed: true }));
      const no = row.createEl("button", { text: "拒绝" });
      no.addEventListener("click", () => reply({ confirmed: false }));
      const cancel = row.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => reply({ cancelled: true }));
    } else if (method === "select") {
      const options: string[] = Array.isArray(evt.options) ? evt.options : [];
      for (const opt of options) {
        const b = row.createEl("button", { text: String(opt) });
        b.addEventListener("click", () => reply({ value: String(opt) }));
      }
      const cancel = row.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => reply({ cancelled: true }));
    } else if (method === "input" || method === "editor") {
      const ta = box.createEl("textarea", { cls: "pi-eui-input" }) as HTMLTextAreaElement;
      ta.placeholder = String(evt.placeholder || "");
      const ok = row.createEl("button", { text: "提交", cls: "mod-cta" });
      ok.addEventListener("click", () => reply({ value: ta.value }));
      const cancel = row.createEl("button", { text: "取消" });
      cancel.addEventListener("click", () => reply({ cancelled: true }));
      ta.focus();
    } else {
      this.rpc?.respond({ id, cancelled: true });
      box.createDiv({ cls: "pi-eui-done", text: `已自动取消不支持的请求：${method}` });
    }
    this.scrollToBottom();
  }

  // ── 输入区 ────────────────────────────────

  private buildComposer(root: HTMLElement) {
    const box = root.createDiv("pi-composer");

    this.chipsEl = box.createDiv("pi-chips");
    this.chipsEl.style.display = "none";

    const field = box.createDiv("pi-field");
    this.inputEl = field.createEl("textarea", { cls: "pi-input" }) as HTMLTextAreaElement;
    this.inputEl.rows = 1;
    this.inputEl.placeholder = "问 pi…（Enter 发送 / Shift+Enter 换行 / 可直接粘贴图片）";

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        this.send();
      } else if (e.key === "Escape" && this.status === "streaming") {
        e.preventDefault();
        this.abort();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoGrow());
    this.inputEl.addEventListener("paste", (e: ClipboardEvent) => this.onPaste(e));

    const actions = box.createDiv("pi-actions");
    const left = actions.createDiv("pi-actions-left");
    const btn = (parent: HTMLElement, icon: string, label: string, tip: string, onClick: () => void) => {
      const b = parent.createEl("button", { cls: "pi-text-btn" });
      const ic = b.createSpan("pi-btn-ic");
      setIcon(ic, icon);
      b.createSpan({ text: label });
      b.title = tip;
      b.addEventListener("click", onClick);
      return b;
    };
    btn(left, "file-text", "笔记", "把当前打开的笔记加入上下文", () => this.addCurrentNote());
    btn(left, "text-select", "选区", "把选中的段落加入上下文", () => this.addSelection());

    const right = actions.createDiv("pi-actions-right");
    this.stopBtn = right.createEl("button", { cls: "pi-text-btn" });
    const sic = this.stopBtn.createSpan("pi-btn-ic");
    setIcon(sic, "square");
    this.stopBtn.createSpan({ text: "停止" });
    this.stopBtn.addEventListener("click", () => this.abort());

    this.sendBtn = right.createEl("button", { cls: "pi-send" });
    const ic = this.sendBtn.createSpan("pi-btn-ic");
    setIcon(ic, "arrow-up");
    this.sendBtn.createSpan({ text: "发送" });
    this.sendBtn.addEventListener("click", () => this.send());
  }

  private autoGrow() {
    const el = this.inputEl;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  private insertIntoComposer(text: string) {
    const el = this.inputEl;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const caret = start + text.length;
    el.selectionStart = caret;
    el.selectionEnd = caret;
    el.focus();
    this.autoGrow();
  }

  private onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const comma = result.indexOf(",");
          const data = comma >= 0 ? result.slice(comma + 1) : result;
          this.addAttachment({
            kind: "image",
            label: `图片 ${this.attachments.filter(a => a.kind === "image").length + 1}`,
            detail: file.type,
            data,
            mimeType: file.type || "image/png",
          });
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }

  // ── 引用 ──────────────────────────────────

  private rememberMarkdownView() {
    const v = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (v) this.lastMarkdownView = v;
  }

  private markdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file) return active;
    if (this.lastMarkdownView?.file) return this.lastMarkdownView;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const v = leaf.view as MarkdownView;
      if (v?.file) return v;
    }
    return null;
  }

  private currentFile(): TFile | null {
    return this.app.workspace.getActiveFile() || this.markdownView()?.file || null;
  }

  private async addCurrentNote() {
    const file = this.currentFile();
    if (!file) {
      new Notice("没有找到笔记：先在主区域打开一篇笔记，或点开任意 md 文件");
      return;
    }
    const refPath = this.noteRefPath(file);
    try {
      const content = await this.app.vault.read(file);
      const max = Number(this.settings.inlineMaxChars) || 20000;
      const common = { kind: "note" as const, label: file.basename, path: refPath };
      if (content.length > max) {
        this.addAttachment({ ...common, detail: `${refPath}（超长，pi 自行 read）`, truncated: true });
        new Notice(`笔记超过 ${max} 字，只引用路径`);
        return;
      }
      this.addAttachment({ ...common, content, detail: refPath });
    } catch (e: any) {
      new Notice(`读取笔记失败：${String(e?.message || e)}`);
    }
  }

  /** cwd 与 vault 不同时，笔记引用要用绝对路径，否者 pi 的 read/@ 找不到 */
  private noteRefPath(file: TFile | null): string {
    if (!file) return "";
    const vault = this.workingDir();
    const cwd = this.effectiveCwd();
    if (!vault || !cwd || cwd === vault) return file.path;
    return `${vault}\\${file.path.split("/").join("\\")}`;
  }

  private addSelection() {
    const view = this.markdownView();
    const sel = view?.editor?.getSelection?.() || "";
    if (!sel.trim()) {
      new Notice("没有选中文本：在主区域选中一段文字再点「选区」");
      return;
    }
    const file = view?.file || null;
    const line = view?.editor?.getCursor?.("from")?.line;
    const refPath = this.noteRefPath(file);
    const label = file ? file.basename : "选区";
    const loc = refPath ? `${refPath}${typeof line === "number" ? `:${line + 1}` : ""}` : "";
    this.addAttachment({
      kind: "selection",
      label: `${label}${typeof line === "number" ? `:${line + 1}` : ""}`,
      detail: loc,
      path: refPath,
      content: sel,
    });
  }

  private addAttachment(att: Attachment) {
    this.attachments.push(att);
    this.renderChips();
    if (att.kind !== "image") new Notice(`已引用：${att.label}`);
  }

  private renderChips() {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    this.chipsEl.style.display = this.attachments.length ? "flex" : "none";
    this.attachments.forEach((a, idx) => {
      const chip = this.chipsEl.createSpan("pi-chip");
      chip.title = a.detail || a.label;
      const ic = chip.createSpan("pi-chip-ic");
      setIcon(ic, a.kind === "image" ? "image" : a.kind === "selection" ? "text-select" : "file-text");
      chip.createSpan({ cls: "pi-chip-label", text: a.label });
      const x = chip.createSpan("pi-chip-x");
      setIcon(x, "x");
      x.addEventListener("click", () => {
        this.attachments.splice(idx, 1);
        this.renderChips();
      });
    });
  }

  /** 把附件拼成一条消息（RPC 不会展开 @引用，所以正文要内联或让 pi 自己读） */
  private composeMessage(text: string): string {
    const parts: string[] = [];
    for (const a of this.attachments) {
      if (a.kind === "image") continue;
      if (a.kind === "note" && a.truncated && a.path) {
        parts.push(`@${a.path}\n（该笔记较长，请用 read 工具读取）`);
      } else if (a.kind === "note" && a.content != null) {
        const fence = a.content.includes("```") ? "~~~~" : "```";
        parts.push(`【笔记：${a.path}】\n${fence}\n${a.content}\n${fence}`);
      } else if (a.kind === "selection" && a.content != null) {
        const quoted = a.content.split("\n").map(l => "> " + l).join("\n");
        parts.push(`【选区：${a.detail || a.label}】\n${quoted}`);
      } else if (a.path) {
        parts.push(`@${a.path}`);
      }
    }
    if (text) parts.push(text);
    return parts.join("\n\n").trim();
  }

  // ── 发送 / 控制 ────────────────────────────

  private send() {
    const text = (this.inputEl?.value || "").trim();
    const atts = this.attachments.slice();
    if (!text && atts.length === 0) return;
    if (!this.ensureRpc()) return;

    const message = this.composeMessage(text);
    const images = atts
      .filter(a => a.kind === "image" && a.data)
      .map(a => ({ type: "image", data: a.data, mimeType: a.mimeType || "image/png" }));

    this.userMessage(text, atts);
    this.inputEl.value = "";
    this.autoGrow();
    this.attachments = [];
    this.renderChips();
    this.currentCol = null;
    this.currentTextEl = null;

    this.rpc?.prompt(message, images.length ? images : undefined);
    this.setStatus("streaming");
    this.showTyping();
    this.scrollToBottom(true);
  }

  private abort() {
    if (!this.rpc?.running) return;
    this.rpc.abort();
    this.hideTyping();
    this.systemLine("已请求中断", "pi-sys");
  }

  private newSession() {
    if (this.selectedSession) {
      // 从历史会话切回“全新”：丢掉 --session 重启进程
      this.selectedSession = null;
      this.resetPiProcess();
      this.clearChat();
      this.systemLine("已开始新会话", "pi-sys");
      return;
    }
    if (this.rpc?.running) {
      this.rpc.newSession();
      this.systemLine("已开始新会话", "pi-sys");
      return;
    }
    new Notice("pi 未启动：发送第一条消息时会自动启动");
  }

  private openSessionPicker() {
    const cwd = this.effectiveCwd();
    let items: PiSessionInfo[] = [];
    try {
      items = listSessions(cwd, 60);
    } catch (e: any) {
      new Notice(`读取会话列表失败：${String(e?.message || e)}`);
      return;
    }
    new PiSessionPickerModal(this.app, cwd, items, {
      onPick: (info: PiSessionInfo) => {
        this.selectedSession = info.file;
        this.resetPiProcess();
        this.clearChat();
        this.systemLine(`已切换会话：${info.preview || info.id.slice(0, 8)}`, "pi-sys");
        this.ensureRpc();
      },
      onNew: () => {
        this.selectedSession = null;
        this.resetPiProcess();
        this.clearChat();
        this.systemLine("已开始新会话", "pi-sys");
      },
      onResumeLast: () => {
        this.selectedSession = null;
        this.settings.sessionMode = "resume";
        void this.saveSettings();
        this.resetPiProcess();
        this.clearChat();
        this.systemLine("已切回「继续上次」模式", "pi-sys");
      },
    }).open();
  }
}
