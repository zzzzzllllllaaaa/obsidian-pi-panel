/**
 * Pi RPC 客户端 —— 通过 `pi --mode rpc` 的 stdin/stdout JSONL 协议驱动 pi
 * 协议参考：pi 仓库 docs/rpc.md
 *
 * 关键约束：
 * - 只用 LF 作为记录分隔符（readline 会把 U+2028/U+2029 也当换行，切坏 JSON）
 * - child_process 惰性 require（移动端没有该模块，顶层 import 会让插件加载即崩）
 */

export interface PiRpcOptions {
  exe: string;
  args: string[];
  cwd?: string;
  onEvent: (evt: any) => void;
  onError: (message: string) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onStderr: (text: string) => void;
}

export class PiRpcClient {
  private child: any = null;
  private buffer = "";
  private opts: PiRpcOptions;

  constructor(opts: PiRpcOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return !!this.child;
  }

  start(): boolean {
    if (this.child) return true;

    let cp: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cp = require("child_process");
    } catch (e: any) {
      this.opts.onError(`无法加载 child_process：${String(e?.message || e)}`);
      return false;
    }

    try {
      this.child = cp.spawn(this.opts.exe, this.opts.args, {
        cwd: this.opts.cwd || undefined,
        env: (globalThis as any)?.process?.env || undefined,
        shell: !!(globalThis as any)?.process?.platform?.startsWith?.("win"),
      });
    } catch (e: any) {
      this.child = null;
      this.opts.onError(`启动 pi 失败：${String(e?.message || e)}`);
      return false;
    }

    this.child.on("error", (err: any) => {
      this.child = null;
      this.opts.onError(String(err?.message || err));
    });
    this.child.on("exit", (code: number | null, signal: string | null) => {
      this.child = null;
      this.opts.onExit(code, signal);
    });
    this.child.stdout?.on("data", (chunk: any) => this.consume(chunk));
    this.child.stderr?.on("data", (chunk: any) => {
      const text = String(chunk?.toString?.() || chunk || "").trim();
      if (text) this.opts.onStderr(text);
    });
    this.child.stdin?.on("error", () => { /* 进程已退出，忽略写失败 */ });

    return true;
  }

  private consume(chunk: any) {
    this.buffer += String(chunk?.toString?.() || chunk || "");
    while (true) {
      const idx = this.buffer.indexOf("\n");
      if (idx === -1) break;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      try {
        this.opts.onEvent(evt);
      } catch (e) {
        console.warn("[PiPanel] event handler failed", e, evt);
      }
    }
  }

  send(obj: any): boolean {
    if (!this.child?.stdin?.writable) return false;
    try {
      this.child.stdin.write(JSON.stringify(obj) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  prompt(message: string, images?: any[]): boolean {
    const payload: any = { type: "prompt", message };
    if (images && images.length) payload.images = images;
    return this.send(payload);
  }

  abort() { this.send({ type: "abort" }); }
  newSession() { this.send({ type: "new_session" }); }
  getState() { this.send({ type: "get_state" }); }
  getMessages() { this.send({ type: "get_messages" }); }
  respond(obj: any) { this.send({ type: "extension_ui_response", ...obj }); }

  stop() {
    if (!this.child) return;
    try { this.child.stdin?.end(); } catch { /* noop */ }
    try { this.child.kill(); } catch { /* noop */ }
    this.child = null;
  }
}
