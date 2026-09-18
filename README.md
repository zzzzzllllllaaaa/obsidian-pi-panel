# Pi Panel

Run the [pi coding agent](https://pi.dev) in an Obsidian sidebar: chat next to your notes, and send the current note, the current selection, or a pasted image to pi with one click. pi reads and writes your vault directly.

Author **3zh** ｜ License **MIT** ｜ Repo <https://github.com/zzzzzllllllaaaa/obsidian-pi-panel>

## Install

**From the community directory (recommended)**

1. Obsidian → Settings → Community plugins → **Browse**
2. Search for **Pi Panel** → **Install** → **Enable**

**Manually, from a GitHub release**

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/zzzzzllllllaaaa/obsidian-pi-panel/releases/latest)
2. Copy them into `<your vault>/.obsidian/plugins/pi-panel/`
3. Restart Obsidian → Settings → Community plugins → enable **Pi Panel**

## Requirements

- Desktop Obsidian **1.7.2+**. On mobile, run pi on your computer and use [remote mode](#remote-mode) below.
- The **pi CLI** installed and working (`pi --help` in a terminal).
- If Obsidian cannot find `pi` — GUI apps often miss npm's global bin directory — set the absolute path in the plugin settings, for example `%APPDATA%\npm\pi.cmd`.

## What you get

- **Sidebar chat panel** — ribbon icon or the `Pi Panel: Open panel` command. Streaming replies with thinking blocks (collapsible) and tool-call cards showing name, arguments, duration and output; failed calls expand automatically.
- **One-click references** — `Note` sends the note you have open (very long notes are sent as `@path` only), `Selection` sends the selected paragraphs with file and line numbers, and images can be pasted straight in.
- **Extension prompts stay in the panel** — when pi asks for a confirm / select / input, you answer in the panel, so the agent never hangs waiting on a terminal.
- **History** — browse `~/.pi/agent/sessions/`, replay a session, rename it, or start fresh.
- **Model switching** — click the model name in the panel header to switch instantly (no process restart); edit `models.json` from the settings page.
- **Tool allow-list you control** — whatever you pass to `--tools` is what pi gets. Nothing is enabled behind your back.
- **Keeping pi's working directory separate from the vault** — point pi at a project folder that has its own `AGENTS.md`, while your notes stay in the vault.

## Settings

| Setting | Meaning |
|---|---|
| pi executable | Default `pi`; an absolute path also works |
| Tool permissions | The `--tools` allow-list. Empty = pass nothing, i.e. all of pi's default tools (including `bash`) |
| Session | `New session (saved)` / `Continue last (--continue)` / `Don't save (--no-session)` |
| Inline note limit | Above this size only `@path` is sent. Default 20000 characters |
| Working directory | pi's cwd. Empty = vault root. May differ from the notes folder |
| Extra system prompt file | Passed to `--append-system-prompt`, e.g. a project's `AGENTS.md` |
| Default model | Passed as `--model provider/id` at startup; the header lets you switch on the fly |

## Tool permissions

pi's built-in tools are `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. The plugin turns your checkboxes into `--tools <list>` — **a session without `bash` has no shell in pi**, so it cannot change directories or run commands.

Three presets:

| Preset | Value | Effect |
|---|---|---|
| Read only | `read,grep,find,ls` | Can only look |
| Read & write | `read,write,edit,grep,find,ls` | Can modify files, cannot run commands |
| Full (with bash) | `read,write,edit,grep,find,ls,bash` | Same as pi's own default |

- Empty = `--tools` is not passed at all, so pi keeps all of its default tools.
- If the allow-list has no `bash`, the panel says so in the chat and marks `no bash` in the debug log.

## Context and rules ("why is my AGENTS.md ignored?")

At startup pi looks for `AGENTS.md` / `CLAUDE.md` in `~/.pi/agent/`, then in every parent directory of its working directory, then in the working directory itself.

The panel's working directory defaults to your **vault root**, so a rules file that lives in some project folder is *not* read. Two fixes:

1. **Extra system prompt file** → point it at that file (recommended: note paths stay untouched).
2. **Working directory** → point it at the project folder (cwd changes, so pi's relative paths and `@` search change with it).

Changing either setting restarts the pi process in the panel; the next message uses it. Remember that a rules file telling pi to run shell commands needs `bash` in the allow-list.

## History and sessions

The `History` button in the header lists sessions found in `~/.pi/agent/sessions/<cwd slug>/*.jsonl`:

- Each row shows time, a summary of the first user message, message count and session id; sessions from another cwd are labelled.
- Clicking a row restarts pi with `--session <file>` and replays that session's history.
- Header buttons: `New session` and `Continue last (--continue)`.
- If the current cwd has no session files, recently used working directories are listed instead (with their cwd shown).
- Rename from the ✏️ button on any row; empty input clears the name.

## Model management

Click the model line in the panel header (for example `deepseek-v4-flash · persist · 3 msgs`) to open the model picker:

- The list comes from pi's `get_available_models` (built-in plus your `models.json`), grouped by provider.
- `☆` pins a model to a "Favorites" section.
- Picking a row switches the running process instantly (RPC `set_model`) and remembers the choice for the next start.
- If pi is not running, the picker starts it to fetch the full list — no need to type `provider/id` by hand.
- `Manage models…` edits `~/.pi/agent/models.json`: add or edit providers (name, api type, baseUrl, apiKey, `compat.supportsDeveloperRole`) and models (id, display name, api, contextWindow, maxTokens, reasoning, image input, cost).

Every save is validated locally first — invalid input is rejected, and the previous file is backed up as `models.json.bak-<timestamp>`. This matters because pi's model registry **drops the whole file** if any single entry is invalid, and the only symptom is a shorter model list.

## Remote mode

Mobile Obsidian has no way to run pi locally, so the plugin can talk to pi on your computer over a WebSocket:

```
mobile Obsidian ──ws──> bridge on your computer ──spawn──> pi --mode rpc
```

1. Run a WebSocket bridge on the computer that exposes pi's RPC mode (endpoints: `WS /rpc`, `GET /sessions?cwd=`, `POST /sessions/rename`, `GET/PUT /models`, `GET /health`).
2. In the plugin settings: connection mode = **Remote**, bridge address = `ws://<computer-ip>:8770`, bridge token = the token that bridge was started with.
3. Away from home, reach the same bridge through a VPN such as Tailscale (`ws://100.x.x.x:8770`), or expose it behind your own TLS relay and use `wss://`.

Limits:

- The `models.json` editor is unavailable in remote mode (the file lives on the computer — edit it there).
- Give remote sessions a narrow allow-list (`read,grep,find,ls`, add `write,edit` if you need edits). `bash` means the phone can drive the whole computer.
- Always keep a token on the bridge and never expose it on a public port.

## Debug log

Three entry points: the bug button in the panel header, the `Pi Panel: View debug log` command, or "Open log" in the settings.

The dialog shows environment details (plugin version, Obsidian version, platform, pi path, working directory, vault root, the **actual spawn command line**, session mode, tool allow-list, default model, status, log path) plus the raw `SEND` / `RECV` JSONL, `STDERR`, `ERROR` entries with stack traces, and user actions. `Copy all` puts environment and log on the clipboard.

The log is also written to `<vault>/.obsidian/plugins/pi-panel/pi-panel-debug.log` (rotated to `.1` past 5 MB). Streaming text deltas are omitted so the file stays readable; other events are stored verbatim, truncated at 6000 characters per line. When reporting a problem, paste `Copy all` — it usually identifies the cause immediately.

## Privacy and data

- **No telemetry, no analytics.** The plugin collects and uploads nothing.
- **Network:** offline by default. A WebSocket is opened only if you switch connection mode to **Remote**, and only to the bridge address you specify.
- **Files outside the vault (desktop):** running pi locally inevitably touches paths outside your vault:
  - `~/.pi/agent/` — pi's own configuration and session records (`models.json`, `sessions/*.jsonl`), read and written by the History and model manager features;
  - the **working directory** you configure (may be empty = vault root), used as pi's cwd so it can read an `AGENTS.md` or project files there;
  - the **pi executable path** you configure (for example `%APPDATA%\npm\pi.cmd`);
  - the bridge token, stored in the plugin's `data.json`, when remote mode is enabled.
- **Subprocess:** the plugin spawns `pi` on your machine (`child_process`, desktop only and loaded lazily — never on mobile). Closing the panel stops that process.
- **Tool permissions:** you decide the allow-list. Granting `bash` grants command execution; judge accordingly.

## License

[MIT](LICENSE) — use it however you like, commercially included.

Bug reports and ideas: GitHub Issues. This is a personal project and I make no promise about a maintenance schedule.
