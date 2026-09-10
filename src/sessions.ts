/**
 * 读取 pi 的会话文件列表（~/.pi/agent/sessions/<cwd slug>/<timestamp>_<uuid>.jsonl）
 * 仅桌面端可用：node 内置模块全部惰性 require。
 */

export interface PiSessionInfo {
  /** 绝对路径 */
  file: string;
  /** session uuid */
  id: string;
  /** 落盘时间（ms） */
  mtimeMs: number;
  /** 第一条用户消息摘要 */
  preview: string;
  /** 用户消息条数 */
  messageCount: number;
  /** 该会话的 cwd */
  cwd: string;
}

function nodeMods(): { fs: any; path: any; os: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require("os");
    return { fs, path, os };
  } catch {
    return null;
  }
}

/** pi 把 cwd 里的 : 与路径分隔符统一换成 '-'，前后各加 '--' */
export function slugForCwd(cwd: string): string {
  return `--${String(cwd || "").replace(/[:\\/]/g, "-")}--`;
}

export function sessionsRoot(): string {
  const m = nodeMods();
  if (!m) return "";
  return m.path.join(m.os.homedir(), ".pi", "agent", "sessions");
}

function readHead(file: string, fs: any, maxBytes = 16384): string {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.slice(0, read).toString("utf8");
  } catch {
    return "";
  }
}

function parseSession(file: string, fs: any, fallbackCwd: string): PiSessionInfo | null {
  let stat: any;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  let id = "";
  let cwd = fallbackCwd;
  let preview = "";
  let messageCount = 0;

  const text = readHead(file, fs);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // 头部窗口截断导致最后一行不完整
    }
    if (evt.type === "session") {
      id = String(evt.id || "");
      if (evt.cwd) cwd = String(evt.cwd);
    } else if (evt.type === "message" && evt.message?.role === "user") {
      messageCount++;
      if (!preview) {
        const content = evt.message.content;
        let t = "";
        if (typeof content === "string") t = content;
        else if (Array.isArray(content)) {
          t = content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join(" ");
        }
        preview = t.replace(/\s+/g, " ").trim().slice(0, 90);
      }
    }
  }

  if (!id) id = String(file).split("_").pop()?.replace(/\.jsonl$/, "") || "";
  return { file, id, mtimeMs: stat.mtimeMs || 0, preview, messageCount, cwd };
}

function listInDir(dir: string, fs: any, path: any, cwd: string): PiSessionInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n: string) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: PiSessionInfo[] = [];
  for (const n of names) {
    const info = parseSession(path.join(dir, n), fs, cwd);
    if (info) out.push(info);
  }
  return out;
}

/**
 * 列出会话。默认只看当前 cwd 的目录；该目录为空时回退扫描最近活跃的其它目录。
 */
export function listSessions(cwd: string, limit = 60, includeOtherCwds = false): PiSessionInfo[] {
  const m = nodeMods();
  if (!m) return [];
  const { fs, path } = m;
  const root = sessionsRoot();
  if (!root) return [];

  const slugDir = path.join(root, slugForCwd(cwd));
  let items = listInDir(slugDir, fs, path, cwd);

  if ((items.length === 0 || includeOtherCwds) && fs.existsSync(root)) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(root).filter((n: string) => fs.statSync(path.join(root, n)).isDirectory());
    } catch {
      dirs = [];
    }
    // 先按目录 mtime 排序，避免把几百个目录全读一遍
    dirs.sort((a, b) => {
      const ta = safeMtime(fs, path.join(root, a));
      const tb = safeMtime(fs, path.join(root, b));
      return tb - ta;
    });
    for (const d of dirs.slice(0, 25)) {
      const full = path.join(root, d);
      if (full === slugDir) continue;
      items = items.concat(listInDir(full, fs, path, cwd).slice(0, 10));
      if (items.length >= limit * 2) break;
    }
  }

  return items.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

function safeMtime(fs: any, p: string): number {
  try {
    return fs.statSync(p).mtimeMs || 0;
  } catch {
    return 0;
  }
}

/** 会话文件是否存在 */
export function sessionExists(file: string): boolean {
  const m = nodeMods();
  if (!m || !file) return false;
  try {
    return m.fs.existsSync(file);
  } catch {
    return false;
  }
}
