# Pi Panel (Obsidian)

在 Obsidian 侧边栏里跑 [pi coding agent](https://pi.dev)——边看笔记边提问，一键把当前笔记/选区/图片丢给 pi。

> 作者 **3zh** ｜ 协议 **MIT** ｜ 仓库 <https://github.com/zzzzzllllllaaaa/obsidian-pi-panel>

## 装法（不用编译）

1. 到 [Releases](https://github.com/zzzzzllllllaaaa/obsidian-pi-panel/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放到 `<你的库>/.obsidian/plugins/pi-panel/`
3. 重启 Obsidian → 设置 → 第三方插件 → 启用 **Pi Panel**

（已提交上架 Obsidian 官方社区插件目录，审核中；通过后可直接在 Obsidian 内搜索安装。）

源码装也行（见下面「开发」）。

## 功能

- 侧边栏 / 新标签页里的 pi 聊天面板（ribbon 终端图标，或命令面板「打开 Pi 面板」）
- 流式渲染：assistant 文本、thinking（折叠）、工具调用卡片（名称 + 参数摘要 + 耗时 + 输出，出错自动展开）
- 引用：`笔记` 按钮（当前打开的笔记，超长只给 `@路径`）、`选区` 按钮（选中段落，带文件:行号）、粘贴图片
- 扩展 UI 弹窗（confirm / select / input）在面板内应答，不会把 agent 挂住
- pi 以 vault 根目录为 cwd，能直接读写笔记

## 前置条件

- 桌面端 Obsidian（本机跑 pi）；移动端需配「远程模式」连电脑上的桥（见下文）
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

## 发布（给 Obsidian 官方目录用）

Obsidian 是**拿 release 的 tag 去和 `manifest.json` 的 `version` 精确对抳**的，所以：

- tag **必须是 `0.5.4` 这种形式，不要 `v0.5.4`**（带 v 会报「没有任何发布能匹配你的清单版本」）
- release 必须传 `main.js` + `manifest.json` + `styles.css`
- 流程：改 `manifest.json` / `versions.json` 版本号 → `npm run build` → commit push → `gh release create <版本号> ...`

```bash
gh release create 0.5.5 --title "Pi Panel 0.5.5" --notes-file notes.md main.js manifest.json styles.css
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
| 工具权限 | `--tools` 白名单，默认 `read,edit,write`；留空 = 全部工具（含 bash） |
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
- pi 没启动时选择器会**自动把 pi 拉起来**再取完整列表（30 个模型，约 1.5s），不用手打 provider/id
- 设置页「默认模型」也有 `选择…` 按钮，点一下自动填入，不需要手打
- 顶部「管理模型…」→ 增删改 `~/.pi/agent/models.json`

管理面板支持：
- **新增供应商**：名字 / api 类型 / baseUrl / apiKey，以及 `compat.supportsDeveloperRole=false` 勾选项（中转常踩的 400：reasoning 模型用 developer 角色发 system prompt）
- **新增 / 编辑 / 删除模型**：id、显示名、api、contextWindow、maxTokens、reasoning、图片输入、cost
- 保存前跑本地校验，**校验不过就拒绝写盘**，并自动备份成 `models.json.bak-<时间戳>`

> ⚠️ 为什么必须校验：pi 的 ModelRegistry 遇到 models.json 里**任何一个**模型不合法，会**丢弃整个文件**的所有自定义模型（无部分加载、界面无报错，只表现为模型列表缩水）。其中最坑的是 `cost`：要么四个字段全填，要么整个不写——`cost: {}` 会让整个文件失效。

## 调试日志（出问题看这里）

三处入口：面板头部 🐞 按钮 / 命令面板 `Pi 面板：查看调试日志` / 设置页「打开日志」。

弹窗里有：
- **环境信息**：插件版本、Obsidian 版本、平台、pi 可执行路径、工作目录、vault 根、**实际 spawn 的命令行**、会话模式、工具白名单、默认模型、当前状态、日志文件路径
- **日志正文**：`SEND` / `RECV` 的**原始 JSONL**、`STDERR`、`ERROR`（含堆栈）、用户操作
- 按钮：`复制全部`（环境信息 + 日志一起进剪贴板）、`清空`、`打开日志文件`、`自动滚动`开关

日志同时落盘到 `<vault>/.obsidian/plugins/pi-panel/pi-panel-debug.log`（超 5MB 轮转成 `.1`）。
`message_update`（文本增量）不记录，避免刷爆；其他事件都记原文，单行截断 6000 字符。

> 报告问题直接把「复制全部」的内容贴出来即可 —— 里面有启动命令、原始错误、stderr，一般一眼能定位。

## 工具权限（为什么 pi 说「没有 bash」）

pi 内置工具：`read` `bash` `edit` `write` `grep` `find` `ls`。
面板会把设置里的勾选拼成 `--tools <列表>` 传给 pi —— **没勾 bash 的会话里 pi 就没有 shell**，
于是出现「无 bash 工具」、连目录都列不了（`EISDIR`）、跑不了 `python tools/workspace.py init`。

设置 → Pi Panel → **工具权限**：7 个工具逐个勾选 + 三个预设：

| 预设 | 值 | 效果 |
|---|---|---|
| 只读 | `read,grep,find,ls` | 只能看 |
| 读写 | `read,write,edit,grep,find,ls` | 能改文件，不能跑命令 |
| 全部（含 bash） | `read,write,edit,grep,find,ls,bash` | 等同 pi 官方默认 |

- 默认值已改为「全部（含 bash）」；旧默认 `read,edit,write`（缺 bash/grep/find/ls）会在加载时**自动升级**
- 面板启动 pi 时若发现白名单不含 bash，会在聊天里提示，🐞 里也会标注 `⚠️ 无 bash`
- 留空 = 不传 `--tools`，即 pi 默认可用的全部工具

## 会话重命名

选择器里每行 hover 出现 ✏️ 按钮，点击弹出输入框输入会话名，确定后：
- 直接往 JSONL 追加一条 `session_info` entry（格式与 pi `/name` 命令完全一致）
- 若该会话正在运行，顺带 RPC `set_session_name` 即时生效
- 留空 = 清除名字，下次显示回到首条消息摘要

## 远程模式（手机 / 多设备连电脑上的 pi）

手机无法在本机跑 pi（没有 node/二进制），所以走「电脑上的桥」：

```
手机 Obsidian ──ws──> 电脑 pi_rpc_bridge.py ──spawn──> pi --mode rpc
```

### 1. 电脑上启动桥
```
python tools/pi_rpc_bridge.py --port 8770 --token <随机串> --cwd E:\piganet     --tools read,write,edit,grep,find,ls,bash --model 自由/zhwly
```
或双击 `E:\piganet\启动pi桥.bat`（自动生成/复用 token）。

防火墙需放行（只局域网即可）：
```
netsh advfirewall firewall add rule name="Pi RPC Bridge 8770 (LAN only)" dir=in action=allow protocol=TCP localport=8770 remoteip=LocalSubnet profile=any
```

### 2. 手机上设置
设置 → Pi Panel：
- 连接模式 = 远程
- 桥地址 = `ws://192.168.1.2:8770`（电脑局域网 IP）
- 桥 token = 与 `--token` 一致

### 3. 出门用（不在同一 wifi）
电脑与手机各装 Tailscale 登同一账号，桥地址改成 `ws://100.x.x.x:8770`，
防火墙再加一条 `remoteip=100.64.0.0/10` 的规则。

### 桥提供了什么
| 端点 | 用途 |
|---|---|
| `WS /rpc` | pi --mode rpc 的双向透传（协议与本地完全一致） |
| `GET /sessions?cwd=` | 历史会话列表（含 session_info 名字） |
| `POST /sessions/rename` | 重命名会话（追加 session_info） |
| `GET/PUT /models` | 读写电脑的 models.json（校验+备份） |
| `GET /health` | 桥与 pi 配置概览 |

### 限制
- 远程模式下 `models.json` 管理器不可用（文件在电脑上，请在电脑上改）
- 手机端建议工具白名单 `read,grep,find,ls`（要改笔记加 `write,edit`）；`bash` = 手机能操作你整台电脑
- 桥必须带 token，不要暴露公网端口

## 作者与授权

- **作者**：3zh（<https://github.com/zzzzzllllllaaaa>）
- **授权**：[MIT](LICENSE) —— 随便用，商用也行
- 意见与 bug 走 GitHub Issues；本插件为个人项目，不承诺维护节奏

## 权限与数据说明（上架披露）

- **无遥测、无埋点**：插件不收集也不上传任何数据。
- **网络**：默认不联网。只有你主动开启「连接模式 = 远程」时，才用 WebSocket 连你自己指定的桥地址（局域网或 Tailscale），用于把 pi 跑在另一台电脑上。
- **访问 vault 之外的文件（桌面端）**：运行本机 pi 时难免碰库外路径，具体是：
  - `~/.pi/agent/` —— pi 自己的配置与会话记录（`models.json`、`sessions/*.jsonl`）；插件里的「历史会话」与「管理模型」直接读写这里
  - 你设置的**工作目录**（设置项，可留空 = vault 根）—— 作为 pi 进程的 cwd，因为 pi 要从那里读 `AGENTS.md` / 项目文件
  - 你设置的 **pi 可执行文件路径**（可能是 `%APPDATA%\npm\pi.cmd` 之类的库外路径）
  - 开远程模式时还要读桥的 token（存在插件 `data.json` 里）
- **子进程**：插件在本机 spawn `pi` 进程（`require("child_process")`，只在桌面端 + 惰性加载，移动端不会加载该模块）。关面板会杀掉这个进程。
- **工具权限**：给 pi 的工具白名单由你在设置里决定（默认 `read,edit,write`）；给了 `bash` 就是给了命令执行权，请自行评估。
