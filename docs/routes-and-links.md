---
title: Routes & deep links
---

# Routes & deep links

[← Back to index](index.md)

This page documents two features with **real, hard limits**. Read the caveats before designing
around either.

## In-page HTTP routes

```ts
ctx.router.get('stats', () => Response.json({ ok: true }));
ctx.router.get('users/:id', (req) => Response.json({ id: req.params['id'] }));
ctx.router.post('pulse', async (req) => {
  const body = await req.json<{ value: number }>();
  return Response.json({ received: body.value });
});

const response = await ctx.router.fetch('stats');
```

Routes mount under `/plugins/<your-plugin-id>/`, exposed as `ctx.router.base`.

> ## These routes are reachable from inside the VRCNext page only
>
> VRCNext's web server is a C# `HttpListener` with a **fixed route table** — `/app/`,
> `/imgcache/`, `/vrcphotos/`, `/media<n>/`, `/cursor/`, `/builtinthemes/`, `/customthemes/`,
> `/dashbg`, `/ytembed`. The page cannot add to it.
>
> The router works by wrapping `globalThis.fetch`, so:
>
> - ✅ Your plugin, another plugin, or the devtools console can call your routes.
> - ❌ `curl http://localhost:51888/plugins/my-plugin/stats` **will not work.** An external
>   request never passes through the page's `fetch`; it hits the C# listener and gets a 404.
>
> There is no way around this without modifying VRCNext. If you need genuine external access,
> run your own HTTP server in a companion process and launch it via VRCNext's
> `ExtraExeDesktop` / `ExtraExeVR` settings.

Other behaviour: duplicate method+pattern throws at registration; a handler that throws yields
`500` without breaking the table; unmatched paths under the prefix yield `404`; non-plugin URLs
are delegated untouched to the original `fetch`.

## Deep links

```ts
ctx.deepLinks.onPrefix('wrld', (event) => {
  ctx.logger.info(`World link: ${event.id}`);
  return true;   // handled — stops later plugin handlers
});

ctx.deepLinks.on((event) => {
  ctx.logger.info(`${event.prefix}:${event.id} ${event.action}`);
  return undefined;
});
```

> ## Custom `vrcn://` prefixes are impossible
>
> `DeepLinkService.Parse` in VRCNext validates the type segment against a closed list and returns
> `null` for anything else. An unknown prefix is **dropped in C# and never reaches the page**, so
> `vrcn://my-plugin/thing` cannot be delivered no matter what a plugin registers. Supporting it
> would require patching VRCNext, which this project does not do.

What you *can* observe:

| Prefix | Link form |
| :--- | :--- |
| `usr` | `vrcn://user/usr_<uuid>` |
| `avtr` | `vrcn://avatar/avtr_<uuid>` |
| `wrld` | `vrcn://world/wrld_<uuid>` |
| `grp` | `vrcn://group/grp_<uuid>` |
| `inst` | `vrcn://instance/wrld_<uuid>:<instance>` |
| `instjoin` | `vrcn://instance-join/wrld_<uuid>:<instance>` |

`event.action` carries `put/fav1`–`put/fav6`, the only action VRCNext parses.

Returning `true` marks the link handled and stops *later plugin* handlers. It cannot stop
VRCNext's own handling, which already ran before the page saw the event.

On Linux, `vrcn://` only works if the desktop entry registers the scheme. The AppImage does;
`install_vrcnext.sh` does **not** — its `.desktop` lacks `MimeType=` and `%u`.

[← Game log](game-log.md) · [Publishing →](publishing.md)
