---
title: Game log
---

# Game log

[← Back to index](index.md)

VRCNext tails VRChat's `output_log_*.txt` and republishes parsed entries. This is the
**lowest-latency source of in-game activity** — most of VRCNext's own timeline comes from here
rather than from the VRChat API.

```ts
ctx.gameLog.on((entry) => {
  ctx.logger.info(`${entry.type}: ${entry.message}`);
});

ctx.gameLog.onType('OnPlayerJoined', (entry) => {
  ctx.ui.toast({ message: `${entry.detail} joined.` });
});

const backlog = await ctx.gameLog.history(ctx.signal);   // up to 1000 entries
```

## Entry shape

```ts
interface GameLogEntry {
  readonly type: string;       // e.g. 'OnPlayerJoined' — not a closed set
  readonly timestamp: string;  // exactly as VRCNext emitted it
  readonly message: string;
  readonly detail: string;
}
```

`type` is deliberately `string`. VRCNext's parser adds entry kinds between releases, and a
literal union would be wrong the moment it did. Compare against the strings you care about and
ignore the rest.

## Caveats

- **`history()` shares the `getGameLog` action.** It has no request id, so a concurrent caller
  may receive the same batch. Fine for a one-shot backlog read at activation; do not poll it.
- Entries only flow while **VRChat is running**. Nothing arrives otherwise.
- On Linux the log path resolves through the Proton prefix. If VRCNext shows no game log, the
  plugin will not either — the problem is upstream.
- `message` and `detail` are parsed from a log file whose format VRChat changes without notice.
  Treat them as human-readable text, not a stable API.

[← OSC](osc.md) · [Routes & deep links →](routes-and-links.md)
