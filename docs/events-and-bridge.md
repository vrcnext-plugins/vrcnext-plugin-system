---
title: Events & the bridge
---

# Events & the bridge

[← Back to index](index.md)

VRCNext's frontend talks to its C# backend over a Photino channel: roughly **474 outbound
actions** and **310 inbound events**. Plugins get both.

## Receiving events

```ts
// Typed — payload.friendName is a string.
ctx.events.on('friendTimelineEvent', (payload) => {
  ctx.logger.info(`${payload.friendName} → ${payload.type}`);
});

ctx.events.once('setPlatform', (payload) => {
  if (payload.isLinux) ctx.logger.info('Running on Linux.');
});

// Every event, for diagnostics.
ctx.events.onAny((envelope) => ctx.logger.debug(envelope.type));

// Promise form, abortable.
const payload = await ctx.events.next('vrcMyProfile', ctx.signal);
```

Subscriptions are registered on your disposable bag, so forgetting to unsubscribe is not a leak.

## Typed vs unknown payloads

Only payloads **read directly out of the VRCNext C# source** are typed. Everything else arrives
as `unknown` and must be narrowed:

```ts
ctx.events.on('vrcCurrentInstance', (payload) => {
  if (typeof payload !== 'object' || payload === null) return;
  const worldName = (payload as { worldName?: unknown }).worldName;
  if (typeof worldName === 'string') { /* … */ }
});
```

This is deliberate. A guessed payload type is worse than none: it compiles, then fails at
runtime. Currently typed: `setPlatform`, `log`, `toast`, `dbMigrationProgress`, `openDeepLink`,
`friendTimelineEvent`, `customThemes`.

To type more for your own build, augment the map:

```ts
declare module '@vrcnext/plugin-api' {
  interface VrcnextEventMap {
    vrcCurrentInstance: { readonly worldName: string; readonly empty?: boolean };
  }
}
```

## Sending actions

```ts
ctx.bridge.send('vrcLaunchAndJoin', { location: '', vr: false });
ctx.bridge.send('vrcUpdateStatus', { status: 'join me', statusDescription: 'Come say hi' });
```

> Actions operate on the user's **real VRChat account**. `send` is fire-and-forget with no
> confirmation step — treat every call as outward-facing.

### Request/response

```ts
const themes = await ctx.bridge.request(
  'getCustomThemes',
  {},
  { expect: 'customThemes', timeoutMs: 5000, signal: ctx.signal },
);
```

> **Correlation is by event type only.** VRCNext has no request ids, so two concurrent requests
> expecting the same response type can resolve with each other's payload. Use `request` for
> read-style actions; do not rely on it where a mix-up would matter.

## Intercepting outbound traffic

```ts
ctx.bridge.interceptOutbound((action, raw) => {
  ctx.logger.debug(`→ ${action}`);
  if (action === 'vrcDeleteAvatar') return false;  // drop it
  return undefined;                                 // let it through
});
```

Returning `false` drops the message before it reaches the backend — including VRCNext's own
traffic. Powerful and easy to misuse; log before you block.

[← Settings](settings.md) · [UI injection →](ui.md)
