# Sets up Hermes + Hermes Mobile on an Android phone from a Windows computer, over adb. Plug the phone in with USB
# debugging on, then in PowerShell:
#   irm https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main/tools/setup-phone.ps1 | iex
# Same steps as tools/setup-phone.sh (macOS/Linux); explained in AGENT_INSTALL.md.
# Without questions: set $env:HM_PROVIDER, HM_MODEL, HM_KEY_NAME, HM_KEY first (or HM_SKIP_MODEL=1). HM_SERIAL picks a device.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar

$RAW = 'https://raw.githubusercontent.com/omarqaterge/hermes-mobile-app/main'
$APK_URL = 'https://github.com/omarqaterge/hermes-mobile-app/releases/latest/download/hermes-mobile.apk'
$APP = 'com.omarqaterge.hermesmobile'
$WORK = if ($env:HM_WORK) { $env:HM_WORK } else { Join-Path $HOME '.hermes-mobile-setup' }
New-Item -ItemType Directory -Force -Path $WORK | Out-Null

function B($t) { Write-Host "`n$t" -ForegroundColor White }
function Say($t) { Write-Host "  $t" }
function Die($t) { Write-Host "`nERROR: $t" -ForegroundColor Red; Restore; throw 'Setup stopped.' }   # not exit: that would close a window run via iex
function Get($url, $out) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out }

# ---------------------------------------------------------------- 1. adb
B '1/9 adb'
$ADB = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $ADB) {
  $ADB = Join-Path $WORK 'platform-tools\adb.exe'
  if (-not (Test-Path $ADB)) {
    Say "Downloading Google's platform-tools (adb) into $WORK"
    $zip = Join-Path $WORK 'pt.zip'
    Get 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' $zip
    Expand-Archive -Force $zip $WORK; Remove-Item $zip
  }
}
function A {   # adb, output as one string, exit code in $rc. 'Continue' because Windows PowerShell 5.1 turns native stderr into errors
  $ErrorActionPreference = 'Continue'
  $o = & $ADB @args 2>&1 | Out-String; $script:rc = $LASTEXITCODE; $o.Trim()
}
function Sh([string]$c) { A shell $c }
Say ((A version) -split "`n")[0]
$LOGP = $null
function Restore {
  if ($env:ANDROID_SERIAL) { A shell svc power stayon false | Out-Null }
  if ($script:LOGP -and -not $script:LOGP.HasExited) { Stop-Process -Id $script:LOGP.Id -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- 2. phone
B '2/9 Connecting to the phone'
$shown = $false
while ($true) {
  $devs = @((A devices) -split "`n" | Select-Object -Skip 1 | Where-Object { $_ -match '\S+\s+\S+' } |
    ForEach-Object { $p = $_ -split '\s+'; [pscustomobject]@{ s = $p[0]; st = $p[1] } })
  if ($env:HM_SERIAL) { $devs = @($devs | Where-Object { $_.s -eq $env:HM_SERIAL }) }
  if ($devs.Count -gt 1) { Die "Several devices are connected:`n$(($devs | ForEach-Object { $_.s }) -join "`n")`nPick one: `$env:HM_SERIAL='<serial>' and run again." }
  if ($devs.Count -eq 1 -and $devs[0].st -eq 'device') { $env:ANDROID_SERIAL = $devs[0].s; break }
  if (-not $shown) {
    $shown = $true
    Say 'Waiting for the phone. On the phone:'
    Say " - Settings > About phone > tap 'Build number' 7 times (Xiaomi: 'OS version')"
    Say " - Developer options > USB debugging ON (Xiaomi: also 'Install via USB' and 'USB debugging (Security settings)')"
    Say " - plug it in and tap Allow on 'Allow USB debugging?'"
    Say ' (No device at all? Install the phone maker''s USB driver or try another cable/port.)'
  }
  if ($devs.Count -eq 1 -and $devs[0].st -eq 'unauthorized') { Say "Phone found: tap Allow on the phone's prompt." }
  Start-Sleep 3
}
$abi = Sh 'getprop ro.product.cpu.abi'
$sdk = [int](Sh 'getprop ro.build.version.sdk')
$freeKb = [long]((((Sh 'df -k /data') -split "`n")[1] -split '\s+')[3])
Say "$(Sh 'getprop ro.product.model'), Android SDK $sdk, $abi, $([math]::Floor($freeKb / 1048576)) GB free"
if ($abi -ne 'arm64-v8a') { Die "This phone is $abi; Hermes Mobile needs arm64-v8a." }
if ($sdk -lt 26) { Die 'Android 8 or newer is needed.' }
$need = 6000000   # a re-run has most of it installed already
if (((Sh 'pm list packages com.termux') -split "`n" | ForEach-Object { $_.Trim() }) -contains 'package:com.termux') { $need = 2000000 }
if ($freeKb -lt $need) { Die "At least $($need / 1000000) GB free space is needed." }

# ---------------------------------------------------------------- 3. Termux
B '3/9 Termux'
function Has($pkg) { ((Sh "pm list packages $pkg") -split "`n" | ForEach-Object { $_.Trim() }) -contains "package:$pkg" }
function FdroidInstall($pkg) {
  $code = (Invoke-RestMethod "https://f-droid.org/api/v1/packages/$pkg").suggestedVersionCode
  $apk = Join-Path $WORK "$pkg.apk"
  Say "Downloading $pkg from F-Droid"
  Get "https://f-droid.org/repo/${pkg}_$code.apk" $apk
  Say "Installing $pkg"
  $o = A install -r $apk
  Remove-Item $apk -ErrorAction SilentlyContinue
  if ($script:rc -ne 0) { Die "Installing $pkg failed (Xiaomi: turn on 'Install via USB' in Developer options).`n$o" }
}
if (Has 'com.termux') {
  $ver = [regex]::Match((Sh 'dumpsys package com.termux'), 'versionName=([0-9.]+)').Groups[1].Value
  Say "Termux $ver is already installed"
  if ([int]($ver.Split('.')[1]) -lt 118) { Die "Termux $ver is too old (Play Store build?). Uninstall it (this deletes its files) and run this again." }
} else { FdroidInstall 'com.termux' }
if (-not (Has 'com.termux.boot')) { try { FdroidInstall 'com.termux.boot' } catch { Say 'Termux:Boot skipped' } }
Sh 'am start -n com.termux.boot/.BootActivity' | Out-Null   # it must be opened once to work

# ---------------------------------------------------------------- 4. Android settings
B '4/9 Android settings (keep Termux alive, screen on during the install)'
Sh 'svc power stayon true' | Out-Null
Sh 'input keyevent KEYCODE_WAKEUP' | Out-Null; Sh 'wm dismiss-keyguard' | Out-Null   # a PIN/pattern still needs the user
Sh 'cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow' | Out-Null
Sh 'dumpsys deviceidle whitelist +com.termux' | Out-Null
if ($sdk -ge 31) {   # Android 12+ kills apps with many child processes ("signal 9" in Termux)
  Sh 'device_config set_sync_disabled_for_tests persistent' | Out-Null
  Sh 'device_config put activity_manager max_phantom_processes 2147483647' | Out-Null
  Sh 'settings put global settings_enable_monitor_phantom_procs false' | Out-Null
}

# ---------------------------------------------------------------- 5. Termux ready
B "5/9 Opening Termux (keep the phone unlocked; don't touch it while this runs)"
function TypeLine([string]$t) {   # text without ' or %; typed into the app in front, then Enter
  Sh ("input text '" + ($t -replace ' ', '%s') + "'") | Out-Null
  Sh 'input keyevent 66' | Out-Null
}
function TermuxFront {
  Sh 'am start -n com.termux/.app.TermuxActivity' | Out-Null
  Start-Sleep 2
  (Sh 'dumpsys window') -match 'mCurrentFocus=.*com\.termux'
}
$LOG = Join-Path $WORK 'hmsetup.log'
Set-Content $LOG ''
A logcat -c | Out-Null
$LOGP = Start-Process -FilePath $ADB -ArgumentList 'logcat', '-v', 'brief', '-s', 'hmsetup:*' -RedirectStandardOutput $LOG -NoNewWindow -PassThru
function LogText { try { Get-Content $LOG -Raw -ErrorAction Stop } catch { '' } }
$ready = $false
for ($i = 1; $i -le 30; $i++) {
  if (TermuxFront) {
    TypeLine '/system/bin/log -t hmsetup HMSETUP READY'
    Start-Sleep 4
    if ((LogText) -match 'HMSETUP READY') { $ready = $true; break }
  } else { Say "Termux isn't in front. Is the phone locked? Unlock it and leave Termux open." }
  if ($i -eq 1) { Say 'Waiting for Termux to finish its first start...' }
  Start-Sleep 6
}
if (-not $ready) { Die "Termux didn't respond. Open it on the phone, wait for the `$ prompt, and run this again." }

# ---------------------------------------------------------------- 6. install on the phone
B '6/9 Installing Debian + Hermes on the phone (20-40 minutes)'
TypeLine "curl -fsSL $RAW/phone/bootstrap.sh -o hm.sh && bash hm.sh"
$seen = 0; $start = Get-Date
while ($true) {
  Start-Sleep 5
  $lines = @((LogText) -split "`n" | Where-Object { $_ -match 'HMSETUP' })
  for ($j = $seen; $j -lt $lines.Count; $j++) { if ($lines[$j] -notmatch 'READY') { Say ($lines[$j] -replace '.*HMSETUP ', '') } }
  $seen = $lines.Count
  if ((LogText) -match 'HMSETUP DONE') { break }
  if ((LogText) -match 'HMSETUP FAIL') {
    Sh 'screencap -p /sdcard/hm-error.png' | Out-Null; A pull /sdcard/hm-error.png (Join-Path $WORK 'termux-error.png') | Out-Null
    Die "The phone-side install failed (see the line above). The Termux screen is saved in $WORK\termux-error.png. Fix it (AGENT_INSTALL.md step 6 lists the usual causes), then run this again: finished parts are skipped."
  }
  A get-state | Out-Null; if ($script:rc -ne 0) { Die 'The phone disconnected. Reconnect it and run this again.' }
  if (((Get-Date) - $start).TotalHours -gt 2) { Die 'No result after 2 hours. Look at Termux on the phone.' }
}

# ---------------------------------------------------------------- 7. model
B '7/9 Model'
if ($env:HM_SKIP_MODEL) {
  Say 'Skipped (HM_SKIP_MODEL). Set it in the app: Settings > API keys, then Default models.'
} else {
  $prov = $env:HM_PROVIDER; $model = $env:HM_MODEL; $kname = $env:HM_KEY_NAME; $key = $env:HM_KEY
  if (-not $prov) {
    Say 'Which provider? Easiest: openrouter (one key for every model, https://openrouter.ai/keys).'
    Say 'Others: anthropic, openai, gemini (free tier), deepseek.'
    $prov = Read-Host '  Provider [openrouter]'; if (-not $prov) { $prov = 'openrouter' }
  }
  if (-not $kname) {
    $kname = @{ openrouter = 'OPENROUTER_API_KEY'; anthropic = 'ANTHROPIC_API_KEY'; openai = 'OPENAI_API_KEY'; gemini = 'GEMINI_API_KEY'; deepseek = 'DEEPSEEK_API_KEY' }[$prov]
    if (-not $kname) { $kname = Read-Host '  Name of its API key variable (e.g. FOO_API_KEY)' }
  }
  if (-not $model) {
    $def = @{ openrouter = 'anthropic/claude-sonnet-5-5'; anthropic = 'claude-sonnet-5-5' }[$prov]
    $model = Read-Host ("  Model" + $(if ($def) { " [$def]" } else { '' })); if (-not $model) { $model = $def }
  }
  if (-not $key) {
    $sec = Read-Host "  $kname (hidden)" -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  if ($key -notmatch '^[A-Za-z0-9._:/+=-]+$') { Die "That key has characters this script can't type into the phone. Set it in the app instead (Settings > API keys)." }
  if ("$prov$model$kname" -notmatch '^[A-Za-z0-9._:/+-]+$') { Die 'Provider/model names can only have letters, digits and . _ : / + -' }
  if (-not (TermuxFront)) { Die "Termux isn't in front. Unlock the phone and run this again." }
  TypeLine "bash hm.sh model $prov $model $kname=$key"
  for ($i = 0; $i -lt 120 -and (LogText) -notmatch 'HMSETUP (MODEL SET|FAIL model)'; $i++) { Start-Sleep 2 }
  TypeLine 'history -c && clear'   # the key off the screen and out of the shell history
  $key = $null
  if ((LogText) -notmatch 'HMSETUP MODEL SET') { Die 'Setting the model failed. Set it in the app: Settings > API keys, then Default models.' }
  Say "$prov / $model"
}

# ---------------------------------------------------------------- 8. app
B '8/9 Hermes Mobile app'
$apk = Join-Path $WORK 'hermes-mobile.apk'
Get $APK_URL $apk
$o = A install -r $apk
Remove-Item $apk -ErrorAction SilentlyContinue
if ($script:rc -ne 0) {
  if ($o -match 'UPDATE_INCOMPATIBLE') { Die 'Another build of Hermes Mobile is installed (signed differently). Uninstall it from the phone and run this again.' }
  Die "Installing the app failed: $o"
}
Sh "pm grant $APP com.termux.permission.RUN_COMMAND" | Out-Null
Sh "pm grant $APP android.permission.POST_NOTIFICATIONS" | Out-Null
Sh "dumpsys deviceidle whitelist +$APP" | Out-Null
Sh "am start -n $APP/.MainActivity" | Out-Null

# ---------------------------------------------------------------- 9. check
B '9/9 Checking'
$port = A forward tcp:0 tcp:9119
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/" -TimeoutSec 5 | Out-Null; $ok = $true } catch { Start-Sleep 2 }
}
A forward --remove "tcp:$port" | Out-Null
if ($ok) { Say 'Hermes is running on the phone.' } else { Say "Hermes didn't answer yet; the app's Setup check shows what's missing." }
Restore

B 'Done. Say hi in Hermes Mobile on the phone.'
Say 'Xiaomi/HyperOS: also turn on Autostart for Termux and Hermes Mobile (Settings > Apps).'
Say 'Keep the Termux notification: Hermes runs inside Termux.'
Say 'Update later: run this again.'
