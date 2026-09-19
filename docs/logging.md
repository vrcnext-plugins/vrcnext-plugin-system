---
title: Logging
---

# Logging

[← Back to index](index.md)

```ts
ctx.logger.debug('Fetched page', pageNumber);
ctx.logger.info('Sync complete.');
ctx.logger.warn('Rate limited, backing off.');
ctx.logger.error('Sync failed.', error);

const sync = ctx.logger.scoped('sync');   // logs as `my-plugin:sync`
```

Every line goes to **three** places:

1. The **browser console**, at the matching level (`console.debug` / `info` / `warn` / `error`).
2. An in-memory **ring buffer** (2000 records), shared with the host's own output.
3. **IndexedDB**, debounced — so logs survive a VRCNext restart.

## The Logs panel

The **Plugins** tab carries a live log viewer below the repository manager:

- Live tail, auto-scrolling unless you have scrolled up to read history.
- Filter by **level** and by **plugin**.
- **Copy** the filtered log to the clipboard.
- **Download** it as a timestamped `.log` file.
- **Clear**, which also clears the persisted copy.

This exists so you can follow what plugins are doing without opening devtools.

## Why it does not write to VRCNext's log file

> VRCNext appends to `~/.config/VRCNext/Logs/` inside `AppShell.SendToJS` — the **C#→page**
> direction. There is no page→C# action that logs arbitrary text, and the page has no
> filesystem access. So a plugin cannot write into VRCNext's activity log, and neither can this
> host.
>
> The **Download** button is the closest real equivalent: it writes an actual file to your
> Downloads folder, containing the same formatted lines.
>
> If you genuinely need plugin output interleaved into VRCNext's own log file, that requires
> patching VRCNext itself — for example a Harmony hook on `AppShell.SendToJS` in a locally-built
> VRCNext. That is outside this project's scope, which is explicitly "never modify VRCNext".

## Format

```
11:42:07.318 INFO  [kitchen-sink] Game log backlog: 412 entries.
11:42:09.004 WARN  [kitchen-sink:sync] Rate limited, backing off.
```

Extra arguments are stringified **at capture**, so an object mutated later cannot rewrite
history. `Error` values render as `Name: message`; circular structures fall back to `String()`.

## Guidance

- **Never log secrets** — tokens, auth headers, message content. This output is user-visible and
  gets pasted into bug reports.
- Use `debug` for anything per-event. `onParam` can fire dozens of times a second; logging each
  one at `info` makes the panel useless.
- Prefer `ctx.logger` over `console.log` — console output alone does not reach the panel, the
  persisted log, or the downloadable file.

[← Notifications](notifications.md) · [Using TSX →](tsx.md)
