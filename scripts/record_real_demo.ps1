param(
    [ValidateRange(20, 170)][int]$Seconds = 90,
    [ValidatePattern('^emulator-[0-9]+$')][string]$Serial = 'emulator-5580'
)

$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'Run conda activate amazon-tv first.' }
. (Join-Path $PSScriptRoot 'use_android_sdk.ps1')
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw 'ADB was not found in the configured SDK.' }
$state = (& $adb -s $Serial get-state 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $state -ne 'device') { throw "Emulator $Serial is not ready: $state" }
$focus = & $adb -s $Serial shell dumpsys window
if ($LASTEXITCODE -ne 0 -or -not ($focus | Select-String 'mCurrentFocus=.*org\.jabtempo\.tv/')) {
    throw 'Open JabTempo TV in the emulator before recording.'
}

$privateDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'local_private\demo'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remote = "/sdcard/jabtempo-real-demo-$stamp.mp4"
$local = Join-Path $privateDir "native_real_round_$stamp.mp4"
Write-Host "Recording the emulator screen for $Seconds seconds. Click the emulator and play a REAL iPhone round now."
Write-Host 'This captures the TV picture only. It does not capture your phone camera, your voice, or the game sound.'
Write-Host 'The recording will stay in ignored local_private/demo. Do not put a raw recording in Git.'
& $adb -s $Serial shell screenrecord --size 1280x720 --bit-rate 6000000 --time-limit $Seconds $remote
if ($LASTEXITCODE -ne 0) { throw 'Android screen recording failed.' }
& $adb -s $Serial pull $remote $local
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $local)) { throw "Recording could not be copied. It remains at $remote on the emulator." }
& $adb -s $Serial shell rm $remote
if ($LASTEXITCODE -ne 0) { Write-Warning "Copied recording, but could not remove emulator copy $remote" }
Write-Host "REAL ROUND VIDEO: $local"
Write-Host 'Review the clip before sharing it. Use only with your consent and the consent of anyone shown or heard.'
