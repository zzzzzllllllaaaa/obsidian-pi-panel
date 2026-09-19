## Pi Panel 0.6.0

### Added

- **AI operation log** — an optional separate panel (command `Pi Panel: Open AI operation log`, ribbon list icon, or the `list` button in the panel header) that records notes created / modified / deleted / renamed while the plugin runs: change type, time, vault path and the first ~160 characters of the file. Click a row to open the note, `Refresh` to re-render, `Clear` to empty the list. Only the folders you list under **Folders to watch** are inspected; the last 300 entries live in this plugin's `data.json`.
- **Usage chip** — the header now shows the session's context and token usage (`ctx 30% · 59k/200k · 4.9M tok`). Click it for input / output / cache read / cache write, tool-call count, message count, and cost when pi reports one.
- **Search in History** — the session picker filters by name, first-message summary, session id, working directory or file path as you type.
- **Drag and drop** — drop image files onto the panel to attach them (same code path as pasting), drop other files to insert `@vault-relative-path`. Dropped plain text goes into the composer.
- **Selectable chat text** — replies, code blocks and tool output can be drag-selected and copied like in a browser (no per-message copy buttons).

### Notes

- Requires Obsidian 1.7.2+ and a local `pi` CLI, as before.
- The operation log can be turned off in settings and only reads the folders you configure.
