# 开发与发布（作者向）

这份文档里的内容**读者不需要**（安装、设置、功能请见 [README.zh.md](../README.zh.md) / [README.md](../README.md)）。
留在这里只是为了下次发版时不用重新推。

## 构建

```bash
npm install --include=dev     # 全局若设了 omit=dev，必须加 --include=dev
npm run dev                   # watch
npm run verify                # tsc --noEmit
npm run build                 # 产物 main.js（仓库根）
```

`main.js` 在 `.gitignore` 里（本地构建产物不提交），Release 资产才带它。

## 冒烟测试（不开 Obsidian）

`smoke_ops.js` 把 `require("obsidian")` 指向桩，跑 `plugin.onload()` + 一次假 vault 变更，验证「AI 操作记录」面板在
**deferred leaf**（后台 tab）下能被就地建出来并渲染：

```bash
node smoke_ops.js H:/kaifa/obsidian-pi-panel/main.js F:/obsidianwenjian/.obsidian/plugins/pi-panel/data.json
```

输出 `SMOKE: PASS` 即：opsLog 载入 N 条 → `setViewState` 被调 → 面板 listEl 有 N 个 row → 再来一次 vault 变更自动变 N+1。
两个场景都测（后台 tab 的两种真实形态）：

- `deferred`：`leaf.view` 是空壳（`getViewType()` 已是 `pi-ops-view`，身上啥方法都没有）
- `warm`：视图对象建好了、但 Obsidian **没叫 onOpen**（不显示就不 open）→ 面板 DOM 没建

`warm` 那个就是「面板一片空白」的真凶：以前 `render()` 里 `if (!this.listEl) return;` 直接在
打日志之前 return，于是日志里只有 `命中 1 个 leaf（需建 0）`、什么都没有，啥也看不出来。
现在 DOM 由 `buildDom()` 按需自建（`onOpen` / `refresh` 谁先来谁建），实例化后也会主动叫一次 refresh。

## 发版流程

Obsidian 是**拿 release 的 tag 去和 `manifest.json` 的 `version` 精确对齐**的，所以顺序不能乱：

1. 改 `manifest.json` 与 `package.json` 的 `version`，并在 `versions.json` 里加上 `<新版本>: <最低 Obsidian 版本>`
2. `npm run build`
3. commit 后推到远端主分支
4. 打 tag：**必须是 `0.5.6` 这种形式，不要 `v0.5.6`**（带 `v` 会报「没有任何发布能匹配你的清单版本」）
5. `gh release create <版本号> --title "Pi Panel <版本号>" --notes-file notes.md main.js manifest.json styles.css`
   —— `--notes-file` 用单独写的短 notes，**别直接甩 README**（整篇开发说明会塞进 Release 页）

```bash
gh release create 0.5.6 --title "Pi Panel 0.5.6" --notes-file notes.md main.js manifest.json styles.css
```

本机调试时装进自己的库：

```bash
mkdir -p "<vault>/.obsidian/plugins/pi-panel"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/pi-panel/"
```

然后在 Obsidian 设置 → 第三方插件里启用（或把 `pi-panel` 加进 `.obsidian/community-plugins.json`）。

## 官方目录

- 提交入口：<https://community.obsidian.md>（网页表单，要 Obsidian 账号 + 连 GitHub）
- 审查按 release 走：**每次发新 release 都会重新跑一遍自动审查**，会重置上一次的状态
- 只有 `Error` 阻塞上架；`Warning` / `Recommendation` 不阻断（但会一直挂在页面上）
- 不登录也能看审查结果：`https://community.obsidian.md/plugins/<id>` 页面里的 RSC 数据（本仓库用脚本读；镜像状态看 `obsidianmd/obsidian-releases` 的 `community-plugins.json`，只有出现在那里 Obsidian 内才能装）
- 已踩过的坑：
  - `eslint-disable` 注释**必须**带 `-- 原因`，否则单独判一条 high
  - **禁止** disable `obsidianmd/*` 自己的规则（直接 high 阻断）；要豁免只能用第三方规则
  - README 必须含英文（"An English description of the plugin is required"）
  - 关闭 Node 内置模块规则的唯一合法姿势：`Platform.isDesktop` 守卫 + 动态 `import()`；写成 `Platform.isDesktopApp` 不算守卫
  - Build verification 是**逐字节**比对 release 里的 `main.js` 与「用仓库源码重新构建」的结果

## 通信细节（改代码时才需要）

`spawn(pi, ["--mode", "rpc", "--no-session", "--tools", "<列表>"])`，stdin/stdout 走 JSONL。

- 协议见 pi 仓库 `docs/rpc.md`
- 只用 LF 切行（readline 会按 U+2028 / U+2029 误切）
- RPC 模式不会展开 `@文件` 引用，所以引用内容是**客户端内联**进消息里的
- 会话文件路径：`~/.pi/agent/sessions/` + `--` + cwd（`:` `\` `/` 全换成 `-`）+ `--`，例如 `E:\piganet` → `--E--piganet--`

## 远程模式的桥

桥不在本仓库里（插件只负责当客户端）。桥要实现：

| 端点 | 用途 |
|---|---|
| `WS /rpc` | pi `--mode rpc` 的双向透传（协议与本地完全一致） |
| `GET /sessions?cwd=` | 历史会话列表（含 `session_info` 名字） |
| `POST /sessions/rename` | 重命名会话（追加 `session_info`） |
| `GET/PUT /models` | 读写电脑的 `models.json`（校验 + 备份） |
| `GET /health` | 桥与 pi 配置概览 |

作者自用的一套（局域网 + 腾讯云 TLS 中继 + SSH 反向隧道，无需公网入站端口）在个人笔记里，不在本仓库。
