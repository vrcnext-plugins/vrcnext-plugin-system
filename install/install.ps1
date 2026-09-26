<#
.SYNOPSIS
  VRCNext plugin system installer (Windows, PowerShell 5.1+).

.DESCRIPTION
  Installs the VRCNext Bridge daemon, a pinned esbuild binary and the plugin host sources into
  %LOCALAPPDATA%\vrcnext-plugins, registers a logon Scheduled Task (fallback: a Startup-folder
  .cmd), starts the bridge, builds the first bundle into %APPDATA%\VRCNext\custom-themes and
  prints the pairing token.

  Re-running is an upgrade: binaries and host sources are replaced, plugins\, state.json and
  token are kept, and the bundle is rebuilt.

    iwr -useb https://raw.githubusercontent.com/vrcnext-plugins/vrcnext-plugin-system/main/install/install.ps1 | iex
    .\install.ps1 [-PinPort N] [-Version TAG] [-DryRun]

.PARAMETER PinPort
  Pin VRCNext's LocalHttpPort in settings.json (VRCNext must be closed). The pairing token is
  stored per page origin and VRCNext picks a new random port when its saved one is taken.
.PARAMETER Version
  Release tag for BOTH vrcnext-bridge and vrcnext-plugin-system (default: latest of each).
.PARAMETER BridgeVersion
  Override the bridge tag only.
.PARAMETER HostVersion
  Override the plugin-system (host sources) tag only.
.PARAMETER DryRun
  Print what would be done without touching the network or the disk.
#>
[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)][int]$PinPort = 0,
  [string]$Version = 'latest',
  [string]$BridgeVersion = '',
  [string]$HostVersion = '',
  [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1

# ---------------------------------------------------------------------------------------------
# Everything that names a release lives here.
# ---------------------------------------------------------------------------------------------
$BridgeRepo  = 'vrcnext-plugins/vrcnext-bridge'
$HostRepo    = 'vrcnext-plugins/vrcnext-plugin-system'
$BridgeAsset = 'vrcnext-bridge-windows-x86_64.exe'
$HostAsset   = 'vrcnext-plugin-host-src.tar.gz'
$SumsAsset   = 'SHA256SUMS'

# esbuild is pinned by version AND by tarball digest. Bump both together (see install.sh).
$EsbuildVersion  = '0.28.2'
$EsbuildPlatform = 'win32-x64'
$EsbuildSha256   = '7286c3611b6f1f4c4d9ec90adcbc478407ff0d28ead96567f361d53e67613e19'
$EsbuildUrl      = "https://registry.npmjs.org/@esbuild/$EsbuildPlatform/-/$EsbuildPlatform-$EsbuildVersion.tgz"
# The Windows npm package ships the binary at package/esbuild.exe (not package/bin/).
$EsbuildMember   = 'package/esbuild.exe'

$BridgeAddr  = '127.0.0.1:42081'
$ThemeName   = 'vrcnext-plugin-system'
$TaskName    = 'VRCNext Bridge'
$DataDir     = Join-Path $env:LOCALAPPDATA 'vrcnext-plugins'
$VrcnConfig  = Join-Path $env:APPDATA 'VRCNext'
$ThemeDir    = Join-Path $VrcnConfig "custom-themes\$ThemeName"
$Settings    = Join-Path $VrcnConfig 'settings.json'
$BinDir      = Join-Path $DataDir 'bin'
$BridgeBin   = Join-Path $BinDir 'vrcnext-bridge.exe'
$TokenFile   = Join-Path $DataDir 'token'
$StartupCmd  = Join-Path ([Environment]::GetFolderPath('Startup')) 'vrcnext-bridge.cmd'

if ($BridgeVersion -eq '') { $BridgeVersion = $Version }
if ($HostVersion   -eq '') { $HostVersion   = $Version }

# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------
$script:Tty = [Environment]::UserInteractive -and -not [Console]::IsOutputRedirected
function Write-Step([string]$Text) {
  if ($script:Tty) { Write-Host '==> ' -ForegroundColor Cyan -NoNewline; Write-Host $Text }
  else { Write-Output "==> $Text" }
}
function Write-Note([string]$Text) {
  if ($script:Tty) { Write-Host "    $Text" -ForegroundColor DarkGray } else { Write-Output "    $Text" }
}
function Fail([string]$Text) {
  if ($script:Tty) { Write-Host 'error: ' -ForegroundColor Red -NoNewline; Write-Host $Text }
  else { [Console]::Error.WriteLine("error: $Text") }
  exit 1
}
function Get-ReleaseUrl([string]$Repo, [string]$Tag, [string]$Asset) {
  if ($Tag -eq 'latest') { "https://github.com/$Repo/releases/latest/download/$Asset" }
  else { "https://github.com/$Repo/releases/download/$Tag/$Asset" }
}
function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant() }
function Invoke-Download([string]$Url, [string]$Dest) {
  try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Dest }
  catch { Fail "download failed: $Url ($($_.Exception.Message))" }
}
# Verifies $File (listed as $Name) against a SHA256SUMS file.
function Test-Sums([string]$SumsFile, [string]$File, [string]$Name) {
  $expected = $null
  foreach ($line in Get-Content $SumsFile) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Name) { $expected = $parts[0].ToLowerInvariant(); break }
  }
  if (-not $expected) { Fail "$Name is not listed in the release SHA256SUMS" }
  $actual = Get-Sha256 $File
  if ($actual -ne $expected) { Fail "sha256 mismatch for ${Name}: expected $expected, got $actual" }
}
function Expand-TarGz([string]$Archive, [string]$Dest, [string[]]$Members) {
  # bsdtar ships with Windows 10 1803+ and understands .tar.gz natively.
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if (-not $tar) { Fail 'tar.exe not found (Windows 10 1803 or newer is required)' }
  & $tar.Source -xzf $Archive -C $Dest @Members
  if ($LASTEXITCODE -ne 0) { Fail "could not extract $Archive" }
}

if ([Environment]::OSVersion.Platform -ne 'Win32NT') { Fail 'this installer is for Windows; use install.sh on Linux and macOS' }
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'only 64-bit Windows is supported' }
if ($PSVersionTable.PSVersion.Major -lt 5) { Fail 'PowerShell 5.1 or newer is required' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------------------------
if ($DryRun) {
  Write-Step 'Dry run - nothing will be downloaded or written'
  Write-Note "data dir:      $DataDir"
  Write-Note "theme dir:     $ThemeDir"
  Write-Note "bridge:        $(Get-ReleaseUrl $BridgeRepo $BridgeVersion $BridgeAsset)"
  Write-Note "               verified against $(Get-ReleaseUrl $BridgeRepo $BridgeVersion $SumsAsset)"
  Write-Note "host sources:  $(Get-ReleaseUrl $HostRepo $HostVersion $HostAsset)"
  Write-Note "               verified against $(Get-ReleaseUrl $HostRepo $HostVersion $SumsAsset)"
  Write-Note "esbuild:       $EsbuildUrl"
  Write-Note "               verified against pinned sha256 $EsbuildSha256"
  Write-Note "               -> $BinDir\esbuild.exe + $BinDir\esbuild.sha256"
  Write-Note "autostart:     Scheduled Task '$TaskName' at logon (fallback: $StartupCmd)"
  if ($PinPort) { Write-Note "settings:      set LocalHttpPort=$PinPort and enable `"$ThemeName`" in $Settings" }
  else { Write-Note "settings:      enable `"$ThemeName`" in $Settings if VRCNext is closed" }
  Write-Note "then:          wait for http://$BridgeAddr/v1/health, POST /v1/plugins/build, print token"
  if (Test-Path $TokenFile) { Write-Note 'existing install detected: plugins\, state.json and token are kept' }
  exit 0
}

# ---------------------------------------------------------------------------------------------
# Download + verify
# ---------------------------------------------------------------------------------------------
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("vrcnext-install-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Step "Downloading VRCNext Bridge ($BridgeVersion, $BridgeAsset)"
  Invoke-Download (Get-ReleaseUrl $BridgeRepo $BridgeVersion $SumsAsset) "$Tmp\bridge.sums"
  Invoke-Download (Get-ReleaseUrl $BridgeRepo $BridgeVersion $BridgeAsset) "$Tmp\vrcnext-bridge.exe"
  Test-Sums "$Tmp\bridge.sums" "$Tmp\vrcnext-bridge.exe" $BridgeAsset
  Write-Note 'sha256 ok'

  Write-Step "Downloading plugin host sources ($HostVersion)"
  Invoke-Download (Get-ReleaseUrl $HostRepo $HostVersion $SumsAsset) "$Tmp\host.sums"
  Invoke-Download (Get-ReleaseUrl $HostRepo $HostVersion $HostAsset) "$Tmp\$HostAsset"
  Test-Sums "$Tmp\host.sums" "$Tmp\$HostAsset" $HostAsset
  New-Item -ItemType Directory -Path "$Tmp\host" | Out-Null
  Expand-TarGz "$Tmp\$HostAsset" "$Tmp\host" @()
  if (-not (Test-Path "$Tmp\host\packages\host\src\index.ts")) { Fail "$HostAsset does not contain packages/host/src/index.ts" }
  Write-Note 'sha256 ok'

  Write-Step "Downloading esbuild $EsbuildVersion ($EsbuildPlatform)"
  Invoke-Download $EsbuildUrl "$Tmp\esbuild.tgz"
  $actual = Get-Sha256 "$Tmp\esbuild.tgz"
  if ($actual -ne $EsbuildSha256) { Fail "sha256 mismatch for esbuild tarball: expected $EsbuildSha256, got $actual" }
  Expand-TarGz "$Tmp\esbuild.tgz" $Tmp @($EsbuildMember)
  $esbuildTmp = Join-Path $Tmp ($EsbuildMember -replace '/', '\')
  if (-not (Test-Path $esbuildTmp)) { Fail "esbuild tarball did not contain $EsbuildMember" }
  $esbuildBinSha = Get-Sha256 $esbuildTmp
  Write-Note "sha256 ok (binary $esbuildBinSha)"

  # -------------------------------------------------------------------------------------------
  # Stop a running bridge before swapping its binary, then install the layout.
  # -------------------------------------------------------------------------------------------
  function Stop-Bridge {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
    Get-Process -Name 'vrcnext-bridge' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $BridgeBin } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }

  Write-Step "Installing into $DataDir"
  $upgrade = Test-Path $BridgeBin
  foreach ($d in @($BinDir, (Join-Path $DataDir 'plugins'), (Join-Path $DataDir 'build'), $ThemeDir)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
  }
  if ($upgrade) { Write-Note 'existing install: stopping the bridge, keeping plugins\, state.json, token'; Stop-Bridge }
  Move-Item -Force "$Tmp\vrcnext-bridge.exe" $BridgeBin
  Move-Item -Force $esbuildTmp (Join-Path $BinDir 'esbuild.exe')
  # One line, hex digest only, LF, no BOM: the bridge compares this before every spawn.
  [IO.File]::WriteAllText((Join-Path $BinDir 'esbuild.sha256'), "$esbuildBinSha`n")
  $hostDir = Join-Path $DataDir 'host'
  if (Test-Path "$hostDir.new") { Remove-Item -Recurse -Force "$hostDir.new" }
  Move-Item "$Tmp\host" "$hostDir.new"
  if (Test-Path $hostDir) { Remove-Item -Recurse -Force $hostDir }
  Move-Item "$hostDir.new" $hostDir
  Write-Note 'bin\vrcnext-bridge.exe, bin\esbuild.exe (+ .sha256), host\'

  $info = "{`n  `"author`": `"vrcnext-plugins`",`n  `"version`": `"$HostVersion`"`n}`n"
  [IO.File]::WriteAllText((Join-Path $ThemeDir 'info.json'), $info)
  Write-Note "theme folder $ThemeDir"

  # -------------------------------------------------------------------------------------------
  # settings.json: enable the theme, optionally pin the port. Only with VRCNext closed, because
  # it rewrites settings.json on exit.
  # -------------------------------------------------------------------------------------------
  Write-Step 'Configuring VRCNext'
  $running = Get-Process -Name 'VRCNext' -ErrorAction SilentlyContinue
  if (-not (Test-Path $Settings)) {
    if ($PinPort) { Fail "-PinPort: $Settings not found; start VRCNext once first" }
    Write-Note "$Settings not found (start VRCNext once); enable the theme manually later"
  } elseif ($running) {
    if ($PinPort) { Fail '-PinPort: close VRCNext first, it rewrites settings.json on exit' }
    Write-Note 'VRCNext is running; not touching settings.json. Enable the theme under Settings -> Design -> Themes'
  } else {
    Copy-Item $Settings "$Settings.bak.$(Get-Date -Format yyyyMMddHHmmss)"
    $json = Get-Content -Raw $Settings | ConvertFrom-Json
    $themes = @()
    if ($json.PSObject.Properties['ActiveCustomThemes'] -and $json.ActiveCustomThemes) { $themes = @($json.ActiveCustomThemes) }
    if ($themes -notcontains $ThemeName) { $themes += $ThemeName }
    $json | Add-Member -NotePropertyName 'ActiveCustomThemes' -NotePropertyValue $themes -Force
    if ($PinPort) {
      $json | Add-Member -NotePropertyName 'LocalHttpPort' -NotePropertyValue $PinPort -Force
      Write-Note "pinned LocalHttpPort=$PinPort"
    }
    [IO.File]::WriteAllText($Settings, ($json | ConvertTo-Json -Depth 32))
    Write-Note "enabled theme `"$ThemeName`" in settings.json (backup written)"
  }

  # -------------------------------------------------------------------------------------------
  # Autostart + start now. Scheduled Task at logon; Startup folder .cmd when that is refused.
  # -------------------------------------------------------------------------------------------
  Write-Step 'Registering autostart'
  $started = $false
  try {
    $action    = New-ScheduledTaskAction -Execute $BridgeBin -WorkingDirectory $DataDir
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settingsT = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
                   -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settingsT `
      -Description 'VRCNext Bridge (plugin system daemon)' -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    if (Test-Path $StartupCmd) { Remove-Item -Force $StartupCmd }
    Write-Note "Scheduled Task '$TaskName' registered (at logon) and started"
    $started = $true
  } catch {
    Write-Note "Scheduled Task registration failed ($($_.Exception.Message)); using the Startup folder instead"
  }
  if (-not $started) {
    [IO.File]::WriteAllText($StartupCmd, "@echo off`r`nstart `"`" /min `"$BridgeBin`"`r`n")
    Start-Process -FilePath $BridgeBin -WorkingDirectory $DataDir -WindowStyle Hidden | Out-Null
    Write-Note "$StartupCmd written and bridge started"
  }

  # -------------------------------------------------------------------------------------------
  # Wait for the daemon, pair, build the first bundle
  # -------------------------------------------------------------------------------------------
  Write-Step "Waiting for the bridge on http://$BridgeAddr"
  $healthy = $false
  for ($i = 0; $i -lt 60 -and -not $healthy; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://$BridgeAddr/v1/health" | Out-Null; $healthy = $true }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $healthy) { Fail "bridge did not answer /v1/health within 30 s (see $DataDir\bridge.log)" }
  for ($i = 0; $i -lt 20 -and -not ((Test-Path $TokenFile) -and (Get-Item $TokenFile).Length -gt 0); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $TokenFile)) { Fail "token file $TokenFile was not created by the bridge" }
  $token = (Get-Content -Raw $TokenFile).Trim()

  Write-Step 'Building the plugin bundle'
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Method Post -Uri "http://$BridgeAddr/v1/plugins/build" `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}'
  } catch {
    $body = ''
    if ($_.Exception.Response) {
      try { $body = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    }
    Fail "POST /v1/plugins/build failed: $($_.Exception.Message) $body"
  }
  if ($resp.Content -notmatch '"ok"\s*:\s*true') { Fail "build failed: $($resp.Content)" }
  $bundle = Join-Path $ThemeDir 'vrcnext-plugin-host.js'
  if (-not (Test-Path $bundle)) { Fail "build reported ok but $bundle is missing" }
  Write-Note $bundle
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------------------------
$bar = '-' * ($token.Length + 4)
Write-Output ''
if ($script:Tty) { Write-Host 'Installed.' -ForegroundColor Green -NoNewline; Write-Host ' Your pairing token:' } else { Write-Output 'Installed. Your pairing token:' }
Write-Output ''
Write-Output "  +$bar+"
Write-Output "  |  $token  |"
Write-Output "  +$bar+"
Write-Output ''
Write-Output "  1. In VRCNext: Settings -> Design -> Themes, enable `"$ThemeName`" (restart VRCNext if it was open)."
Write-Output '  2. Open the new Plugins tab in the sidebar.'
Write-Output '  3. Paste the token above into the Bridge card.'
Write-Output ''
Write-Output "  Token file: $TokenFile   Log: $DataDir\bridge.log   Print again: `"$BridgeBin`" --print-token"
