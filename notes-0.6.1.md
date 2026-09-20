## Pi Panel 0.6.1

### Fixed

- **AI operation log panel stayed blank.** The panel is normally kept in a background tab, and Obsidian only builds a view instance there — `onOpen()` is not called until the tab is actually shown. The list DOM was created in `onOpen()`, so the render path bailed out early every time and the panel looked empty even though records were being written to `data.json`. The DOM is now built on demand by whichever comes first (`onOpen()` or a refresh), so the log renders whether or not the tab has ever been displayed.
- The operation log panel now repaints itself when a record is added, and opening it from the ribbon/command from a background tab reuses that leaf instead of opening a second, duplicate panel.
- A background leaf whose view is still a deferred placeholder (type `pi-ops-view`, no methods yet) is now instantiated in place, instead of being skipped by the refresh that looks for open panels.

### Notes

- No settings, data format or protocol changes — safe update from 0.6.0.
- Requires Obsidian 1.7.2+ and a local `pi` CLI, as before.
