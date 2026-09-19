---
title: OSC
---

# OSC

[← Back to index](index.md)

VRCNext owns the OSC sockets: it sends to `127.0.0.1:9000`, listens on `9001` with
`SO_REUSEADDR`, and advertises an extra receive port over OSCQuery. Plugins do **not** open
sockets — they ask VRCNext to send and subscribe to what it receives. That keeps one OSCQuery
advertisement and avoids fighting VRChat over port 9001.

## Sending

```ts
ctx.osc.connect();                      // starts VRCNext's OSC service if idle

ctx.osc.send('VRCEmote', 'int', 3);     // → /avatar/parameters/VRCEmote
ctx.osc.send('IsHappy', 'bool', true);
ctx.osc.send('Blend', 'float', 0.75);

ctx.osc.sendRaw('/chatbox/input', 'bool', true);   // arbitrary address
```

Overloads are typed: `send(name, 'bool', 3)` is a compile error.

> VRChat's chatbox enforces ≤144 characters and ~1500 ms between messages. VRCNext applies this
> to its own chatbox feature; `sendRaw` does not, so respect it yourself or VRChat will drop
> your messages.

## Receiving

```ts
ctx.osc.onParam((event) => {
  // event.name is without the /avatar/parameters/ prefix
  ctx.logger.debug(`${event.name} = ${String(event.value)}`);
});

ctx.osc.onAvatarChange((event) => {
  ctx.logger.info(`Avatar ${event.avatarId}, ${event.parameters.length} parameters`);
});
```

`onAvatarChange` fires when VRChat reports an avatar switch, carrying the new parameter list
with `hasInput` / `hasOutput` flags.

## Caveats

- **Parameters arrive only while OSC is enabled in VRChat.** If nothing fires, OSC is off in the
  VRChat radial menu, or another app has bound 9001 without `SO_REUSEADDR`.
- `onParam` can fire *very* often — dozens of times a second with a parameter-heavy avatar.
  Filter by name early and never do DOM work per event.
- `connect()` is shared. Calling `disconnect()` stops OSC for VRCNext and every other plugin, so
  do not call it unless you own the feature.

[← Context menus](context-menus.md) · [Game log →](game-log.md)
