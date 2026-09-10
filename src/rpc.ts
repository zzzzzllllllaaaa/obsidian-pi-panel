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
  /** 调试日志回调（发出/收到的原始 JSONL、stderr、退出等） */
  onLog?: (kind: "info" | "rpc-send" | "rpc-recv" | "stderr" | "error", text: string) => void;
}

export class PiRpcClient {
  private child: any = null;
  private buffer = "";
  private opts: PiRpcOptions;
  private pending = new Map<string, Array<{ resolve: (v: any) => void; reject: (e: any) => void }>>();
  private seq = 0;
  private expectedStop = false;
  private stopReason = "";

  constructor(opts: PiRpcOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return !!this.child;
  }

  private lastCmd = "";

  /** 最近一次启动用的命令行（调试用） */
  lastCommand(): string { return this.lastCmd; }

  private log(kind: "info" | "rpc-send" | "rpc-recv" | "stderr" | "error", text: string) {
    this.opts.onLog?.(kind, text);
  }

  start(): boolean {
    if (this.child) {
      this.log("info", "start(): 进程已在运行，跳过");
      return true;
    }
    this.expectedStop = false;
    this.stopReason = "";

    let cp: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cp = require("child_process");
    } catch (e: any) {
      this.log("error", `无法加载 child_process：${String(e?.message || e)}`);
      this.opts.onError(`无法加载 child_process：${String(e?.message || e)}`);
      return false;
    }

    const cmdline = [this.opts.exe, ...this.opts.args].map(quoteArg).join(" ");
    this.lastCmd = cmdline;
    this.log("info", `spawn: ${cmdline}`);
    this.log("info", `cwd: ${this.opts.cwd || "(继承 Obsidian 进程)"}`);

    try {
      this.child = cp.spawn(this.opts.exe, this.opts.args, {
        cwd: this.opts.cwd || undefined,
        env: (globalThis as any)?.process?.env || undefined,
        shell: !!(globalThis as any)?.process?.platform?.startsWith?.("win"),
      });
    } catch (e: any) {
      this.child = null;
      this.log("error", `spawn 抛异常：${String(e?.message || e)}`);
      this.opts.onError(`启动 pi 失败：${String(e?.message || e)}`);
      return false;
    }

    this.log("info", `进程已启动 pid=${this.child?.pid ?? "?"}`);
    const child = this.child;
    // 旧进程的退出事件可能在新进程启动之后才到达 —— 用实例判断，避免把新进程当成旧的
    const stale = () => this.child !== null && this.child !== child;

    child.on("error", (err: any) => {
      if (stale()) {
        this.log("info", `忽略旧进程 error：${String(err?.message || err)}`);
        return;
      }
      this.child = null;
      this.log("error", `进程 error：${String(err?.message || err)}`);
      this.opts.onError(String(err?.message || err));
    });
    child.on("exit", (code: number | null, signal: string | null) => {
      if (stale()) {
        this.log("info", `忽略旧进程退出事件 code=${code} signal=${signal}`);
        return;
      }
      this.child = null;
      this.log("info", `进程退出 code=${code} signal=${signal}${this.expectedStop ? `（插件主动：${this.stopReason || "重启/关闭"}）` : ""}`);
      this.opts.onExit(code, signal);
    });
    child.stdout?.on("data", (chunk: any) => this.consume(chunk));
    child.stderr?.on("data", (chunk: any) => {
      const text = String(chunk?.toString?.() || chunk || "").trim();
      if (text) {
        this.log("stderr", text);
        this.opts.onStderr(text);
      }
    });
    child.stdin?.on("error", (e: any) => {
      this.log("error", `stdin 写入错误：${String(e?.message || e)}`);
    });
    child.stdin?.on("close", () => this.log("info", "stdin 已关闭"));

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
        this.log("error", `stdout 不是合法 JSON，已跳过：${line.slice(0, 300)}`);
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
      // 噪音事件不打日志（文本增量一大堆）
      if (!isNoisy(evt)) this.log("rpc-recv", summarize(evt));
      try {
        this.opts.onEvent(evt);
      } catch (e) {
        this.log("error", `事件处理异常：${String((e as any)?.stack || e)}`);
        console.warn("[PiPanel] event handler failed", e, evt);
      }
    }
  }

  send(obj: any): boolean {
    if (!this.child?.stdin?.writable) {
      this.log("error", `stdin 不可写，丢弃：${summarize(obj)}`);
      return false;
    }
    const text = JSON.stringify(obj) + "\n";
    try {
      this.child.stdin.write(text);
      this.log("rpc-send", summarize(obj));
      return true;
    } catch (e: any) {
      this.log("error", `写入失败：${String(e?.message || e)} | ${summarize(obj)}`);
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
        this.log("error", `${command} 超时（${timeoutMs}ms）未收到响应`);
        reject(new Error(`${command} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
  }

  getAvailableModels(): Promise<any> { return this.request("get_available_models"); }
  setModel(provider: string, modelId: string): Promise<any> { return this.request("set_model", { provider, modelId }); }
  switchSession(sessionPath: string): Promise<any> { return this.request("switch_session", { sessionPath }); }

  /** 标记为“主动停止”（设置变更/切会话等），退出时不当作出错 */
  stop(reason = ""): void {
    if (!this.child) return;
    this.expectedStop = true;
    this.stopReason = reason;
    this.log("info", `stop(): 结束 pi 进程${reason ? `（${reason}）` : ""}`);
    for (const waiters of this.pending.values()) {
      for (const w of waiters) w.reject(new Error("pi 进程已退出"));
    }
    this.pending.clear();
    try { this.child.stdin?.end(); } catch { /* noop */ }
    try { this.child.kill(); } catch { /* noop */ }
    this.child = null;
  }

  /** 是否属于插件主动停止（用于区分意外崩溃与正常重启） */
  wasExpectedStop(): boolean {
    return this.expectedStop;
  }

  stopReasonText(): string {
    return this.stopReason;
  }
}

function quoteArg(a: string): string {
  return /\s/.test(a) ? `"${a}"` : a;
}

/** 文本增量类事件不打日志，否则日志被刷爆 */
function isNoisy(evt: any): boolean {
  return evt?.type === "message_update";
}

const MAX_LOG_CHARS = 6000;

function summarize(obj: any): string {
  let text = "";
  try {
    text = JSON.stringify(obj);
  } catch {
    text = String(obj);
  }
  if (text.length <= MAX_LOG_CHARS) return text;
  return text.slice(0, MAX_LOG_CHARS) + ` …(+${text.length - MAX_LOG_CHARS} chars)`;
}
