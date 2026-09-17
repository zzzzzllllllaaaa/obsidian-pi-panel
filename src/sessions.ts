/**
 * 读取 pi 的会话文件列表（~/.pi/agent/sessions/<cwd slug>/<timestamp>_<uuid>.jsonl）
 * 仅桌面端可用：node 内置模块全部惰性 require。
 *
 * 远程模式（手机连电脑上的桥）走 HTTP：listSessionsRemote / renameSessionRemote。
 */

import { requestUrl } from "obsidian";

/** ws://host:port → http://host:port（桥同时提供 HTTP 端点） */
export function httpBaseFromWs(wsUrl: string): string {
  let u = String(wsUrl || "").trim();
  if (!u) return "";
  u = u.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/rpc$/i, ""); // 允许用户填完整端点 ws://host:port/rpc
  return u;
}

function withToken(url: string, token: string): string {
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

/** 远程列出会话（桥在电脑侧读文件，手机不用碰 fs） */
export async function listSessionsRemote(
  wsUrl: string,
  token: string,
  cwd: string,
  limit = 60,
): Promise<PiSessionInfo[]> {
  const base = httpBaseFromWs(wsUrl);
  if (!base) throw new Error("未配置桥地址");
  const url = withToken(
    `${base}/sessions?cwd=${encodeURIComponent(cwd || "")}&limit=${limit}`,
    token,
  );
  const res = await requestUrl({ url, method: "GET" });
  if (res.status >= 400) throw new Error(`桥返回 ${res.status}`);
  const j: any = res.json;
  return Array.isArray(j?.sessions) ? j.sessions : [];
}

/** 远程重命名会话（桥负责追加 session_info entry） */
export async function renameSessionRemote(
  wsUrl: string,
  token: string,
  file: string,
  name: string,
): Promise<{ ok: boolean; reason?: string }> {
  const base = httpBaseFromWs(wsUrl);
  if (!base) return { ok: false, reason: "未配置桥地址" };
  const res = await requestUrl({
    url: withToken(`${base}/sessions/rename`, token),
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ file, name }),
  });
  if (res.status >= 400) return { ok: false, reason: `桥返回 ${res.status}` };
  const j: any = res.json;
  return j && typeof j.ok === "boolean" ? j : { ok: false, reason: "桥返回异常" };
}

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
  /** 用户指定的会话名（session_info entry 的 name） */
  name: string;
}

function nodeMods(): { fs: any; path: any; os: any } | null {
  try {
// eslint-disable-next-line @typescript-eslint/no-var-requires -- fs 仅桌面端可用，移动端走远程模式不读本地会话文件
    const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires -- path 仅桌面端可用，同上
    const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-var-requires -- os 仅桌面端可用，同上
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

/**
 * 读文件尾部。会话名(session_info)是 append 到文件末尾的，
 * 长会话会超出 readHead 的 16KB 窗口 → 必须单独扫尾部。
 */
function readTail(file: string, fs: any, maxBytes = 262144): string {
  try {
    const size = fs.statSync(file).size || 0;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return "";
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, start);
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
  let name = "";

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
    } else if (evt.type === "session_info" && typeof evt.name === "string") {
      name = evt.name.trim(); // 最新的 session_info 生效（pi 也是反向找最新一条）
    }
  }

  // 名字单独从尾部扫：session_info 是 append 的，长会话不在 head 窗口里
  const tail = readTail(file, fs);
  if (tail) {
    let tailName = "";
    for (const raw of tail.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let evt: any;
      try {
        evt = JSON.parse(line);
      } catch {
        continue; // 尾部窗口从行中间截断
      }
      if (evt.type === "session_info" && typeof evt.name === "string") tailName = evt.name.trim();
    }
    name = tailName || name; // 尾部没有就保留 head 扫到的（极端长文件）
  }

  if (!id) id = String(file).split("_").pop()?.replace(/\.jsonl$/, "") || "";
  return { file, id, mtimeMs: stat.mtimeMs || 0, preview, messageCount, cwd, name };
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

/** 生成不与现有 entry 冲突的短 id（pi 的 id 也是短 hex） */
function genEntryId(existing: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const id = Math.random().toString(16).slice(2, 10);
    if (!existing.has(id)) return id;
  }
  return `r${Date.now().toString(16)}`;
}

/**
 * 给历史会话改显示名。直接往 JSONL 追加一条 session_info entry
 * （格式照 pi 的 appendSessionInfo：id 唯一 + parentId=最后一条 entry 的 id + name）。
 * 空 name = 清除名字（pi 反向找最新一条 session_info，空名视为未设置）。
 * 若会话正被 pi 运行，内存态要等重启/重开该会话才更新。
 */
export function renameSession(file: string, name: string): { ok: boolean; reason?: string } {
  const m = nodeMods();
  if (!m || !file) return { ok: false, reason: "桌面端不可用" };
  const { fs } = m;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e: any) {
    return { ok: false, reason: `读取失败：${String(e?.message || e)}` };
  }
  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, reason: "会话文件为空" };

  let lastId: string | undefined;
  const ids = new Set<string>();
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (o && typeof o.id === "string") {
        ids.add(o.id);
        if (!lastId) lastId = o.id;
        if (lastId) break;
      }
    } catch {
      // 跳过坏行
    }
  }

  const entry: any = {
    type: "session_info",
    id: genEntryId(ids),
    timestamp: new Date().toISOString(),
    name: String(name || "").trim(),
  };
  if (lastId) entry.parentId = lastId;

  try {
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  } catch (e: any) {
    return { ok: false, reason: `写入失败：${String(e?.message || e)}` };
  }
  return { ok: true };
}
