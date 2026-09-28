# Installer

One command sets up the whole plugin system: the VRCNext Bridge daemon, a pinned `esbuild`, the
plugin host sources, autostart, the first bundle build, and the pairing token.

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.sh | bash
```

**Windows** (PowerShell 5.1 or newer)

```powershell
iwr -useb https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.ps1 | iex
```

> Piping a script into a shell runs code from the internet on your machine with your user's
> rights. If that is not something you want to do blind, download the script first, read it, then
> run it: `curl -fsSLO …/install.sh && less install.sh && bash install.sh`. Both scripts verify the
> sha256 of everything they download, but nothing verifies the script itself.

Requirements: `curl` and `tar` (plus `sha256sum` or `shasum`) on Linux/macOS; Windows 10 1803+
(for the built-in `tar.exe`). No Node, no git, no Rust.

## What the scripts do

1. Detect the platform: Linux x86_64/aarch64, macOS arm64/x86_64, Windows x86_64.
2. Download and verify:
   - the bridge binary from the latest release of
     [vrcnext-bridge](https://github.com/vrcnext-plugins/vrcnext-bridge), checked against that
     release's `SHA256SUMS`;
   - `vrcnext-plugin-host-src.tar.gz` (the `packages/api/src` and `packages/host/src` trees) from
     the latest release of this repository, checked against its `SHA256SUMS`;
   - `esbuild` from the npm registry, at a version **and** tarball digest pinned in the script.
     The binary's sha256 is written to `bin/esbuild.sha256`; the bridge re-checks it before every
     spawn.
3. Lay out the data directory (below), create the VRCNext theme folder with an `info.json`, and,
   if VRCNext is closed, enable the theme in `settings.json` (a backup is written next to it).
   With `--pin-port` / `-PinPort` it also writes `LocalHttpPort`.
4. Register autostart and start the bridge now:
   Linux — systemd user unit `~/.config/systemd/user/vrcnext-bridge.service`;
   macOS — launchd agent `~/Library/LaunchAgents/io.github.vrcnext-plugins.bridge.plist`;
   Windows — Scheduled Task "VRCNext Bridge" at logon, or `vrcnext-bridge.cmd` in the Startup
   folder if task registration is refused.
5. Wait for `GET /v1/health` on `127.0.0.1:42081`, read the token, run
   `vrcnext-bridge --build-plugins` to produce the first bundle, then print the token and the
   three steps to finish in VRCNext.

The daemon is started with no flags, so it serves `/v1/ws` and `/v1/health` and nothing else.
The REST call surface — `GET /v1/describe` and `POST /v1/<service>/<method>` — needs `--rest`,
which is for scripts and agents rather than for using VRCNext.

Re-running the installer is an upgrade: binaries and host sources are replaced, `plugins/`,
`state.json` and `token` are kept, and the bundle is rebuilt.

### Flags

| sh | ps1 | Meaning |
| :--- | :--- | :--- |
| `--version=TAG` | `-Version TAG` | Release tag for both repos (default: latest of each). `--bridge-version` / `--host-version` (`-BridgeVersion` / `-HostVersion`) override one. |
| `--pin-port=N` | `-PinPort N` | Pin VRCNext's `LocalHttpPort`. Needs `jq` on Linux/macOS and VRCNext closed. |
| `--dry-run` | `-DryRun` | Print the plan; touch nothing. |

**Why pin the port.** The pairing token and bridge endpoint are stored in the page's
`localStorage`, which is scoped to the origin `http://localhost:<LocalHttpPort>`. VRCNext picks a
new random port whenever its saved one is taken, and a new port is a new origin, so you would
have to paste the token again. Pick a free port in 49152–65533.

### Layout

```
~/.vrcnext-plugins/                   Windows: %LOCALAPPDATA%\vrcnext-plugins\
  bin/vrcnext-bridge[.exe]
  bin/esbuild[.exe]  bin/esbuild.sha256
  host/packages/{api,host}/src/       host sources (read-only input for the build)
  plugins/<id>/                       one git clone per installed plugin
  build/static-plugins.ts             generated import table
  state.json  token  bridge.log
```

Theme folder: `~/.config/VRCNext/custom-themes/vrcnext-plugin-system/` (`$XDG_CONFIG_HOME` is
honoured; Windows: `%APPDATA%\VRCNext\custom-themes\vrcnext-plugin-system\`) containing
`vrcnext-plugin-host.js` (+ `.map`) and `info.json`.

## Uninstall

Linux:

```bash
systemctl --user disable --now vrcnext-bridge
rm -f ~/.config/systemd/user/vrcnext-bridge.service && systemctl --user daemon-reload
rm -rf ~/.vrcnext-plugins
rm -rf ~/.config/VRCNext/custom-themes/vrcnext-plugin-system
```

macOS:

```bash
launchctl bootout gui/$(id -u)/io.github.vrcnext-plugins.bridge
rm -f ~/Library/LaunchAgents/io.github.vrcnext-plugins.bridge.plist
rm -rf ~/.vrcnext-plugins
rm -rf ~/.config/VRCNext/custom-themes/vrcnext-plugin-system
```

Windows (PowerShell):

```powershell
Unregister-ScheduledTask -TaskName 'VRCNext Bridge' -Confirm:$false
Stop-Process -Name vrcnext-bridge -Force -ErrorAction SilentlyContinue
Remove-Item -Force "$([Environment]::GetFolderPath('Startup'))\vrcnext-bridge.cmd" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\vrcnext-plugins"
Remove-Item -Recurse -Force "$env:APPDATA\VRCNext\custom-themes\vrcnext-plugin-system"
```

Then remove `"vrcnext-plugin-system"` from `ActiveCustomThemes` in VRCNext's `settings.json`
(or untick it under Settings → Design → Themes). `settings.json.bak.<timestamp>` backups written
by the installer can be deleted too. `LocalHttpPort`, if you pinned it, is harmless to leave.

## Releases the scripts expect

Both scripts keep every release-asset name and URL at the top of the file. They expect:

- `vrcnext-bridge` releases with `vrcnext-bridge-linux-x86_64`, `vrcnext-bridge-windows-x86_64.exe`,
  `vrcnext-bridge-macos-aarch64` and `SHA256SUMS` (built by that repo's `release.yml`);
- `vrcnext-plugin-system` releases with `vrcnext-plugin-host-src.tar.gz` and `SHA256SUMS`
  (built by `.github/workflows/release.yml` here on every `v*` tag).

To bump esbuild: read `https://registry.npmjs.org/esbuild/latest`, download each
`https://registry.npmjs.org/@esbuild/<platform>/-/<platform>-<VER>.tgz`, and update the version
and the per-platform digests in both scripts together.
