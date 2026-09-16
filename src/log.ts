/**
 * 调试日志 —— 内存环形缓冲 + 可选落盘，给用户一键复制/导出排查
 *
 * 记什么：插件生命周期、pi 启动命令、RPC 收发原文、stderr、错误、通知、异常
 * 落盘：默认写到 <插件目录>/pi-panel-debug.log（超过 5MB 轮转成 .1）
 */

export type LogKind =
  | "info"
  | "user"
  | "rpc-send"
  | "rpc-recv"
  | "stderr"
  | "error"
  | "event";

const KIND_LABEL: Record<LogKind, string> = {
  info: "INFO ",
  user: "USER ",
  "rpc-send": "SEND ",
  "rpc-recv": "RECV ",
  stderr: "STDERR",
  error: "ERROR",
  event: "EVENT",
};

const MAX_LINES = 4000;
const MAX_LINE_CHARS = 4000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function ts(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export class DebugLog {
  private lines: string[] = [];
  private file: string | null = null;
  private listeners = new Set<(line: string) => void>();
  private enabled = true;

  setEnabled(v: boolean) { this.enabled = !!v; }
  isEnabled() { return this.enabled; }

  setFile(path: string | null) {
    this.file = path;
    if (path) this.line("info", `日志文件：${path}`);
  }

  getFile(): string | null { return this.file; }

  onChange(cb: (line: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clear() {
    this.lines = [];
    this.line("info", "日志已清空");
  }

  line(kind: LogKind, text: unknown) {
    if (!this.enabled) return;
    const body = typeof text === "string" ? text : safeStringify(text);
    for (const raw of String(body).split(/\r?\n/)) {
      const one = raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) + ` …(+${raw.length - MAX_LINE_CHARS})` : raw;
      const full = `[${ts()}] [${KIND_LABEL[kind] || kind}] ${one}`;
      this.lines.push(full);
      for (const cb of this.listeners) {
        try { cb(full); } catch { /* ignore */ }
      }
      this.appendFile(full);
    }
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  info(text: unknown) { this.line("info", text); }
  user(text: unknown) { this.line("user", text); }
  error(text: unknown) { this.line("error", text); }
  event(text: unknown) { this.line("event", text); }

  /** 最近 n 行（默认全部） */
  tail(n?: number): string[] {
    return typeof n === "number" ? this.lines.slice(-n) : [...this.lines];
  }

  text(n?: number): string { return this.tail(n).join("\n"); }

  private appendFile(line: string) {
    if (!this.file) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, obsidianmd/no-nodejs-modules
      const fs = require("fs");
      // eslint-disable-next-line @typescript-eslint/no-var-requires, obsidianmd/no-nodejs-modules
      const path = require("path");
      try {
        const st = fs.statSync(this.file);
        if (st.size > MAX_FILE_BYTES) fs.renameSync(this.file, this.file + ".1");
      } catch {
        // 文件不存在：确保目录存在
        try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); } catch { /* ignore */ }
      }
      fs.appendFileSync(this.file, line + "\n", "utf8");
    } catch { /* 落盘失败不影响使用 */ }
  }
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

export const debugLog = new DebugLog();
