# Pi Panel（中文说明）

在 Obsidian 侧边栏里跑 [pi coding agent](https://pi.dev)：边看笔记边提问，一键把当前笔记、选中段落或粘贴的图片丢给 pi，pi 直接读写你的库。

英文版见 [README.md](README.md)。作者 **3zh** ｜ 协议 **MIT** ｜ 仓库 <https://github.com/zzzzzllllllaaaa/obsidian-pi-panel>

## 安装

**从社区目录装（推荐）**

1. Obsidian → 设置 → 第三方插件 → **浏览**
2. 搜索 **Pi Panel** → **安装** → **启用**

**手动装（从 GitHub Release）**

1. 到 [最新 Release](https://github.com/zzzzzllllllaaaa/obsidian-pi-panel/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放进 `<你的库>/.obsidian/plugins/pi-panel/`
3. 重启 Obsidian → 设置 → 第三方插件 → 启用 **Pi Panel**

## 前置条件

- 桌面端 Obsidian **1.7.2+**。手机上请把 pi 跑在电脑里，用下面「远程模式」。
- 本机装好 **pi CLI**（终端 `pi --help` 能用）。
- 如果 Obsidian 找不到 `pi`（GUI 进程的 PATH 常常没有 npm 全局 bin），在设置里填绝对路径，例如 `%APPDATA%\npm\pi.cmd`。

## 功能

- **侧边栏聊天面板** —— ribbon 图标或命令 `Pi 面板：打开面板`。流式输出，thinking 可折叠，工具调用卡片显示名称、参数、耗时、输出，出错自动展开。
- **一键引用** —— `笔记` 按钮给当前打开的笔记（超长只给 `@路径`），`选区` 按钮给选中段落（带文件:行号）。图片可粘贴，也可**直接把文件拖进面板**；拖进来的其它文件按 `@路径` 插入。
- **聊天文字能划选** —— 像浏览器一样鼠标划选 + 复制。
- **用量 chip** —— 头部显示本会话的上下文与 token 用量（`ctx 30% · 59k/200k · 4.9M tok`），点开看 input / output / cache 明细、工具调用次数，pi 报了 cost 才有金额。
- **扩展 UI 弹窗在面板内应答** —— pi 要 confirm / select / input 时不用切终端，agent 不会挂住。
- **历史会话** —— 扫 `~/.pi/agent/sessions/`，列表顶部有搜索框（按名字 / 首条摘要 / 会话 id / 工作目录 / 文件路径过滤），可回放、可重命名、可开新会话。
- **模型即时切换** —— 面板头点模型名即换（不重启进程）；设置页可直接改 `models.json`。
- **工具白名单自己定** —— `--tools` 传什么就是什么，不会背着你开权限。
- **工作目录与笔记目录分离** —— 可以把 pi 指向带自己 `AGENTS.md` 的项目目录，笔记仍在库里。
- **AI 操作记录** —— 可选独立面板，记录插件运行期间被新建 / 修改 / 删除 / 改名的笔记（时间、路径、前 160 字预览），点一行直接打开。

## 设置项

| 项 | 说明 |
|---|---|
| pi 可执行文件 | 默认 `pi`，也可填绝对路径 |
| 工具权限 | `--tools` 白名单。留空 = 不传，即 pi 默认的全部工具（含 `bash`） |
| 会话 | `新会话并存盘` / `继续上次（--continue）` / `不保存（--no-session）` |
| 内联笔记上限 | 超过则只给 `@路径`，默认 20000 字符 |
| 工作目录 | pi 的 cwd，留空 = vault 根；可与笔记目录不同 |
| 附加系统提示文件 | 传给 `--append-system-prompt`，例如项目里的 `AGENTS.md` |
| 默认模型 | 启动时用 `--model provider/id`；面板头可即时切换 |
| AI 操作记录 | 开关该面板 |
| 监听目录 | 每行一个 vault 相对路径，例如 `笔记/草稿`；`/` 或 `*` = 整个库，留空 = 不记 |

## 工具权限

pi 内置工具：`read` `bash` `edit` `write` `grep` `find` `ls`。面板把勾选拼成 `--tools <列表>` —— **没勾 `bash` 的会话里 pi 就没有 shell**，连列目录、跑命令都做不到。

三个预设：

| 预设 | 值 | 效果 |
|---|---|---|
| 只读 | `read,grep,find,ls` | 只能看 |
| 读写 | `read,write,edit,grep,find,ls` | 能改文件，不能跑命令 |
| 全部（含 bash） | `read,write,edit,grep,find,ls,bash` | 等同 pi 官方默认 |

- 留空 = 完全不传 `--tools`，即 pi 默认的全部工具。
- 白名单不含 `bash` 时，面板会在聊天里提示，调试日志里也会标注「无 bash」。

## 上下文 / 规则为什么不生效

pi 启动时按这个顺序找 `AGENTS.md` / `CLAUDE.md`：`~/.pi/agent/` → cwd 的各级父目录 → cwd 本身。

面板默认 cwd 是 **vault 根**，所以放在某个项目目录里的规则文件**不会被读到**。两种修法：

1. **附加系统提示文件** → 指向那个文件（推荐，笔记路径不受影响）。
2. **工作目录** → 指向项目目录（cwd 变了，pi 的相对路径与 `@` 搜索也跟着变）。

改完设置会自动重启面板里的 pi 进程，下一条消息生效。另外：规则里若有跑命令的步骤，记得把 `bash` 加进白名单。

## 历史会话

头部 `历史` 按钮列出 `~/.pi/agent/sessions/<cwd slug>/*.jsonl`：

- 每行显示时间、首条用户消息摘要、消息数、session id；其它 cwd 的会话会标注。
- 点一行 → 以 `--session <文件>` 重启 pi 并回放该会话历史。
- 头部按钮：`新会话` / `继续上次（--continue）`。
- 当前 cwd 没有会话文件时，会回退列出最近活跃的其它工作目录（列表里标出 cwd）。
- 每行 hover 出现 ✏️ 可重命名；留空 = 清除名字。

## 模型管理

面板头那行模型名（如 `deepseek-v4-flash · persist · 3 msgs`）点一下打开模型选择器：

- 列表来自 pi 的 `get_available_models`（内置 + `models.json` 自定义），按 provider 分组。
- `☆` 收藏 → 下次置顶显示。
- 点一行即时切换（RPC `set_model`），并记为下次启动的默认值。
- pi 没启动时选择器会先把它拉起来再取完整列表，不用手打 `provider/id`。
- 「管理模型…」可增删改 `~/.pi/agent/models.json`：供应商（名字 / api 类型 / baseUrl / apiKey / `compat.supportsDeveloperRole`）与模型（id、显示名、api、contextWindow、maxTokens、reasoning、图片输入、cost）。

保存前会本地校验：校验不过就拒绝写盘，并把原文件备份成 `models.json.bak-<时间戳>`。这条很关键 —— pi 的模型注册表遇到**任何一个**不合法条目就会**丢弃整个文件**，界面不报错，只表现为模型列表变少。

## 远程模式

手机装不了 pi，所以由插件用 WebSocket 连电脑上的桥：

```
手机 Obsidian ──ws──> 电脑上的桥 ──spawn──> pi --mode rpc
```

1. 在电脑上跑一个暴露 pi RPC 模式的 WebSocket 桥（端点：`WS /rpc`、`GET /sessions?cwd=`、`POST /sessions/rename`、`GET/PUT /models`、`GET /health`）。
2. 插件设置里：连接模式 = **远程**，桥地址 = `ws://<电脑IP>:8770`，桥 token = 启动桥时用的那个。
3. 出门在外：用 Tailscale 之类的虚拟局域网连同一地址（`ws://100.x.x.x:8770`），或者把桥放到自己的 TLS 中继后面用 `wss://`。

限制：

- 远程模式下 `models.json` 管理器不可用（文件在电脑上，请在电脑上改）。
- 远程会话建议用窄白名单（`read,grep,find,ls`，要改笔记再加 `write,edit`）。给了 `bash` = 手机能操作你整台电脑。
- 桥必须带 token，不要暴露公网端口。

## AI 操作记录

独立面板（命令 `Pi 面板：打开 AI 操作记录面板`，或左侧 ribbon 的列表图标），列出插件运行期间监听到的库内变更：

- 类型：新建 / 修改 / 删除 / 改名，带时间、vault 路径，以及有内容时该文件前 160 字预览。
- 只记录**监听目录**里列出的文件夹，没列出的目录一个字都不读；填 `/`（或 `*`）= 整个库，`.obsidian` 和回收站永远跳过。
- 点一行打开对应笔记；`刷新` 重画，`清空` 只清列表（不动笔记）。
- 只保留最近 300 条，存在本插件的 `data.json`。

它记的是「监听目录里变了什么」，不是「谁改的」：你自己手改的也会被列出来。当活动轨迹看，别当审计日志。

## 调试日志

三个入口：面板头 🐞 按钮 / 命令 `Pi 面板：查看调试日志` / 设置页「打开日志」。

弹窗里有环境信息（插件版本、Obsidian 版本、平台、pi 路径、工作目录、vault 根、**实际 spawn 的命令行**、会话模式、工具白名单、默认模型、状态、日志路径），以及原始的 `SEND` / `RECV` JSONL、`STDERR`、`ERROR`（含堆栈）、用户操作。`复制全部` 会把环境信息与日志一起放进剪贴板。

日志同时落盘到 `<vault>/.obsidian/plugins/pi-panel/pi-panel-debug.log`（超 5MB 轮转成 `.1`）。流式文本增量不记录，避免刷爆；其他事件记原文，单行截断 6000 字符。报问题时把「复制全部」的内容贴出来即可，一般一眼能定位。

## 权限与数据

- **无遥测、无埋点**：插件不收集也不上传任何数据。
- **网络**：默认不联网。只有你主动把连接模式改成 **远程** 时，才会用 WebSocket 连你自己指定的桥地址。
- **访问 vault 之外的文件（桌面端）**：本机跑 pi 难免碰库外路径，具体是：
  - `~/.pi/agent/` —— pi 自己的配置与会话记录（`models.json`、`sessions/*.jsonl`），「历史会话」与「模型管理」直接读写这里；
  - 你设置的**工作目录**（可留空 = vault 根）—— 作为 pi 的 cwd，因为它要从那里读 `AGENTS.md` / 项目文件；
  - 你设置的 **pi 可执行文件路径**（例如 `%APPDATA%\npm\pi.cmd`）；
  - 开远程模式时读桥的 token（存在插件 `data.json` 里）。
- **AI 操作记录（可选）**：开启后最多存 300 条到本插件 `data.json` —— 相对路径、时间、变更类型、文件前 160 字。只读你填在**监听目录**里的文件夹，不上传任何内容。
- **子进程**：插件在本机 spawn `pi`（`child_process`，仅桌面端且惰性加载，移动端不加载）。关面板会杀掉这个进程。
- **工具权限**：白名单由你决定；给了 `bash` 就是给了命令执行权，请自行评估。

## 授权

[MIT](LICENSE) —— 随便用，商用也行。

意见与 bug 走 GitHub Issues。本插件为个人项目，不承诺维护节奏。
