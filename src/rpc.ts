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
  private pending = new Map<string, Array<{ resolve: (v: any) => void; reject: (e: any) => void }>>();
  private seq = 0;

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
      if (evt?.type === "response" && typeof evt.command === "string") {
        const waiters = this.pending.get(evt.command);
        if (waiters && waiters.length) {
          const w = waiters.shift()!;
          if (waiters.length === 0) this.pending.delete(evt.command);
          if (evt.success === false) w.reject(new Error(String(evt.error || `${evt.command} 失败`)));
          else w.resolve(evt.data);
        }
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

  /** 请求-响应式调用（按 command 配对响应） */
  request(command: string, extra: Record<string, any> = {}, timeoutMs = 20000): Promise<any> {
    if (!this.running) return Promise.reject(new Error("pi 未运行"));
    return new Promise((resolve, reject) => {
      const waiters = this.pending.get(command) || [];
      const entry = { resolve, reject };
      waiters.push(entry);
      this.pending.set(command, waiters);
      const ok = this.send({ id: `req-${++this.seq}`, type: command, ...extra });
      if (!ok) {
        this.pending.set(command, (this.pending.get(command) || []).filter((x) => x !== entry));
        reject(new Error("写入 pi 进程失败（进程可能已退出）"));
        return;
      }
      setTimeout(() => {
        const cur = this.pending.get(command);
        if (!cur || !cur.includes(entry)) return;
        this.pending.set(command, cur.filter((x) => x !== entry));
        reject(new Error(`${command} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
  }

  getAvailableModels(): Promise<any> { return this.request("get_available_models"); }
  setModel(provider: string, modelId: string): Promise<any> { return this.request("set_model", { provider, modelId }); }
  switchSession(sessionPath: string): Promise<any> { return this.request("switch_session", { sessionPath }); }

  stop() {
    if (!this.child) return;
    for (const waiters of this.pending.values()) {
      for (const w of waiters) w.reject(new Error("pi 进程已退出"));
    }
    this.pending.clear();
    try { this.child.stdin?.end(); } catch { /* noop */ }
    try { this.child.kill(); } catch { /* noop */ }
    this.child = null;
  }
}
