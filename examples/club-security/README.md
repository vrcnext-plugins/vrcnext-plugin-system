# Club Security

Reports who joins your instance. For every join that passes the filters, one report:

```
Player "Tupper" joined
18+ Verified: Yes (18+)
Avatar PC Performance Rank: Good
Avatar Quest Performance Rank: Poor
In Group: Yes
Rejoin?: Yes (2 hours ago)
```

That is the default **Report template**, editable in the plugin's settings. The first line is
the title on desktop, VR and Discord; the rest is the body. A line whose placeholders are all
empty is left out, which is why `In Group` only appears when a group filter is set.

`{name}` is short for `{{ name }}`; the full template language (conditions, filters, `{% if %}`
blocks) is documented in the plugin system's API reference. For example:

```
{rejoinEmoji} {name} {{ "is back" if rejoin else "is new" }} {ageVerifiedEmoji}
{pcRankEmoji} PC {pcRankText} · {questRankEmoji} Quest {questRankText}
{% if inGroup == false %}⚠️ Not a group member{% endif %}
```

| Kind | Variables |
| :--- | :--- |
| Text | `name` `playerId` `ageVerifiedText` `ageStatus` `pcRankText` `questRankText` `avatar` `platform` `inGroupText` `rejoinText` `rejoinAgo` `rejoinSince` `rejoinAt` `world` `worldId` `instanceType` `instanceId` `location` `groupId` `time` `date` `timestamp` |
| Booleans (for conditions; empty when unknown) | `ageVerified` `inGroup` `rejoin`, plus `pcRank` and `questRank` (the raw rank, empty when unknown) |
| Emoji | `ageVerifiedEmoji` ✅❌❔ · `pcRankEmoji` / `questRankEmoji` 🟢🔵🟡🟠🔴⚪ · `platformEmoji` 🖥️📱🍎 · `inGroupEmoji` · `rejoinEmoji` 🔁🆕❔ |

A template that does not parse is reported in the log and the default is used instead.

## Filters

All optional, all in the plugin's settings card. Empty means "any".

| Setting | Meaning |
| :--- | :--- |
| Instance types | Comma-separated: `public`, `friends+`, `friends`, `hidden`, `private`, `invite_plus`, `group-public`, `group-plus`, `group-members`, or `group` for every group instance. |
| Group | A `grp_…` id. Only instances of that group count, and the report says whether the joiner is a member. |
| Worlds | Comma-separated `wrld_…` ids. |

## Channels

| Channel | How |
| :--- | :--- |
| In-app toast | Always available. One line. |
| Desktop | A VRCNext Bridge desktop target on any platform; VRCNext's tray toast on Windows when the bridge delivers nothing. |
| VR | A VRCNext Bridge VR target (WayVR and similar) on any platform; SteamVR wrist overlay on Windows when the bridge delivers nothing. |
| Discord | A `discord.com` webhook URL, posted as an embed through `ctx.http.fetch` (`discord.com` is the plugin's only declared host). |

## Where each fact comes from

| Fact | Source | Caveat |
| :--- | :--- | :--- |
| 18+ verified | VRCNext fetches the joiner's profile itself on join and re-pushes the instance; the plugin waits for that push. | Legacy accounts without a `usr_` id cannot be looked up. |
| Avatar ranks | `vrcGetInstanceAvatars` resolves the avatar from the profile image through VRCNext's avatar databases, then `vrcGetAvatarDetail` gives the ranks. | Only works when one of the databases knows the avatar. The detail action also feeds VRCNext's avatar modal, so it is skipped while that modal is open. |
| In group | `vrcGetGroupsForNetwork`, the joiner's publicly visible groups. | A member who hides the membership shows as "No". |
| Rejoin | `getTimelineForUser`: the player's ten most recent timeline events, each with its location. Yes when one of them is this exact instance (same world and instance id) from before this join, with how long ago. | Survives VRCNext and VRChat restarts and reaches back to when VRCNext was installed, but only ten events deep per player. |

Everything waits at most the configured number of seconds, then reports what it has, with
`Unknown` for the rest.

## Your own joins

The signed-in account comes from the `vrcUser` event VRCNext pushes after login; the plugin
reads no page globals. VRChat logs an `OnPlayerJoined` line for the local player too, and right after it one line for
every player already in the instance. The plugin ignores your own line and treats joins inside
the settle window after it (or after a world change) as "already here" and does not report them.

## Layout and permissions

Flat, like every plugin: `plugin.json`, `main.ts`, `src/`. The manifest declares `host:events`
(the five `vrc…` events above and `vrcUser`), `host:actions` (the four `vrcGet…` lookups),
`gamelog` (joins and world changes), `notifications` (toast, confirm, Windows tray toast),
`native` (bridge targets) and `network` with `discord.com` as its only host. Nothing is optional:
every channel is a plain setting, and a category that is off in the settings is simply never called.
