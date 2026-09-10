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
| 会话 | `新会话并存盘` / `继续上次(--continue)` / `不保存(--no-session)` |
| 内联笔记上限 | 超过则只给 `@路径`，默认 20000 字符 |
| 工作目录 | pi 的 cwd，留空 = vault 根。可与笔记目录分开（如 `E:\piganet`） |
| 附加系统提示文件 | 传给 `--append-system-prompt` 的文件，如 `E:\piganet\AGENTS.md` |
| 默认模型 | 启动时 `--model provider/id`；面板里点模型名可即时切换 |

## 上下文 / 规则为什么"不生效"

pi 启动时按 `~/.pi/agent/AGENTS.md` → 从 cwd 向上逐级父目录 → cwd 的顺序找 `AGENTS.md` / `CLAUDE.md`。
面板默认 cwd 是 vault 根（`F:\obsidianwenjian`），所以 **`E:\piganet\AGENTS.md` 那套规则不会被读到**，"加载规则"之类的触发词自然不认。

两种修法：
1. 设置 → 附加系统提示文件 → `E:\piganet\AGENTS.md`（推荐，笔记路径不受影响）
2. 设置 → 工作目录 → `E:\piganet`（cwd 变了，pi 的相对路径与 `@` 搜索也跟着变）

改完设置会自动重启面板里的 pi 进程，下一条消息生效。
> 用 `--tools read,edit,write` 时 pi 没有 `bash`，规则里 `python tools/workspace.py init` 这类步骤跑不了；要跑就把它加进白名单。

## 历史会话

头部 `🕘` 按钮打开会话列表（扫 `~/.pi/agent/sessions/<cwd slug>/*.jsonl`）：

- 行显示：时间 / 首条用户消息摘要 / 消息数 / session id；cwd 不同的会话会额外标注
- 点一行 → 以 `--session <file>` 重启 pi，并自动回放该会话的历史消息
- 顶部按钮：`新会话` / `继续上次（--continue）`
- 该 cwd 没有会话文件时，会回退列出最近活跃的其它工作目录（列表里会标出 cwd）

会话文件位置规则：`~/.pi/agent/sessions/` + `--` + cwd（`:` `\` `/` 全换成 `-`）+ `--`
，例如 `E:\piganet` → `--E--piganet--`。

## 笔记目录与工作目录分离

pi 的 cwd 可以是项目目录（`E:\piganet`，这样能读到那边的 `AGENTS.md`），笔记仍在 vault。
此时插件会自动：
1. 追加系统提示：`Obsidian 笔记库(vault)根目录: <vault> / 本次工作目录: <cwd>`，并说明笔记用绝对路径
2. 引用笔记/选区时改用**绝对路径**（cwd=vault 时仍用相对路径）

## 模型管理

面板头部那行模型名（如 `deepseek-v4-flash · persist · 3 msgs`）**点一下**打开模型选择器：

- 列表来自 pi 的 `get_available_models`（含内置 + `models.json` 自定义），按 provider 分组
- `☆` 收藏 → 下次置顶显示「常用」区
- 点一行 → RPC `set_model` **即时切换**（不重启进程），同时记为默认值供下次启动
- pi 未启动时也能打开（只列 models.json 里的自定义模型），选中的会存为默认值，下次启动生效
- 顶部「管理模型…」→ 增删改 `~/.pi/agent/models.json`

管理面板支持：
- **新增供应商**：名字 / api 类型 / baseUrl / apiKey，以及 `compat.supportsDeveloperRole=false` 勾选项（中转常踩的 400：reasoning 模型用 developer 角色发 system prompt）
- **新增 / 编辑 / 删除模型**：id、显示名、api、contextWindow、maxTokens、reasoning、图片输入、cost
- 保存前跑本地校验，**校验不过就拒绝写盘**，并自动备份成 `models.json.bak-<时间戳>`

> ⚠️ 为什么必须校验：pi 的 ModelRegistry 遇到 models.json 里**任何一个**模型不合法，会**丢弃整个文件**的所有自定义模型（无部分加载、界面无报错，只表现为模型列表缩水）。其中最坑的是 `cost`：要么四个字段全填，要么整个不写——`cost: {}` 会让整个文件失效。
