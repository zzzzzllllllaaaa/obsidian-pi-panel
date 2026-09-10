# Pi Panel (Obsidian)

在 Obsidian 侧边栏里跑 [pi coding agent](https://pi.dev)——边看笔记边提问，一键把当前笔记/选区/图片丢给 pi。

## 功能

- 侧边栏 / 新标签页里的 pi 聊天面板（ribbon 终端图标，或命令面板「打开 Pi 面板」）
- 流式渲染：assistant 文本、thinking（折叠）、工具调用卡片（名称 + 参数摘要 + 耗时 + 输出，出错自动展开）
- 引用：`笔记` 按钮（当前打开的笔记，超长只给 `@路径`）、`选区` 按钮（选中段落，带文件:行号）、粘贴图片
- 扩展 UI 弹窗（confirm / select / input）在面板内应答，不会把 agent 挂住
- pi 以 vault 根目录为 cwd，能直接读写笔记

## 前置条件

- 桌面端 Obsidian（`isDesktopOnly: true`）
- 本机已安装 pi CLI（终端 `pi --help` 可用）
- 若 Obsidian 找不到 `pi`（GUI 进程 PATH 缺失），在设置里填绝对路径，如 `%APPDATA%\npm\pi.cmd`

## 通信

`spawn(pi, ["--mode","rpc","--no-session","--tools","read,edit,write"])`，stdin/stdout 走 JSONL。
- 协议见 pi 仓库 `docs/rpc.md`
- 只用 LF 切行（readline 会按 U+2028/U+2029 误切）
- RPC 模式不会展开 `@文件` 引用，所以引用内容是客户端内联到消息里的

## 开发

```bash
npm install --include=dev     # 全局若设了 omit=dev，必须加 --include=dev
npm run dev                   # watch
npm run verify                # tsc --noEmit
npm run build                 # 产物 main.js
```

安装到 vault：

```bash
mkdir -p "<vault>/.obsidian/plugins/pi-panel"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/pi-panel/"
```

然后在 Obsidian 设置 → 第三方插件里启用（或把 `pi-panel` 加进 `.obsidian/community-plugins.json`）。

## 设置

| 项 | 说明 |
|---|---|
| pi 可执行文件 | 默认 `pi`，可用绝对路径 |
| 允许的工具 | `--tools` 白名单，默认 `read,edit,write`；留空 = 全部工具（含 bash） |
| 保留会话 | 开启后不加 `--no-session` |
| 内联笔记上限 | 超过则只给 `@路径`，默认 20000 字符 |
| 工作目录 | pi 的 cwd，留空 = vault 根。pi 只在 cwd 及父目录找 `AGENTS.md` |
| 附加系统提示文件 | 传给 `--append-system-prompt` 的文件，如 `E:\piganet\AGENTS.md` |

## 上下文 / 规则为什么"不生效"

pi 启动时按 `~/.pi/agent/AGENTS.md` → 从 cwd 向上逐级父目录 → cwd 的顺序找 `AGENTS.md` / `CLAUDE.md`。
面板默认 cwd 是 vault 根（`F:\obsidianwenjian`），所以 **`E:\piganet\AGENTS.md` 那套规则不会被读到**，"加载规则"之类的触发词自然不认。

两种修法：
1. 设置 → 附加系统提示文件 → `E:\piganet\AGENTS.md`（推荐，笔记路径不受影响）
2. 设置 → 工作目录 → `E:\piganet`（cwd 变了，pi 的相对路径与 `@` 搜索也跟着变）

改完设置会自动重启面板里的 pi 进程，下一条消息生效。
> 用 `--tools read,edit,write` 时 pi 没有 `bash`，规则里 `python tools/workspace.py init` 这类步骤跑不了；要跑就把它加进白名单。
