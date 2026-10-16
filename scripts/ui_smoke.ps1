# Run after: conda activate amazon-tv
# Requires an installed app, running authorized Android TV emulator/device, and reviewed navigation plan.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z][A-Za-z0-9_.]+$')][string]$PackageName,
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [ValidatePattern('^[A-Za-z0-9_.:-]+$')][string]$Serial,
    [string]$OutputDirectory = 'results/ui_smoke',
    [int]$SettleMs = 600
)
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'Activate amazon-tv before running UI smoke.' }
if ($SettleMs -lt 0 -or $SettleMs -gt 10000) { throw 'SettleMs must be 0..10000.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPath = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
if (-not $outputPath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay inside the repository.' }
$plan = @(Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json)
if ($plan.Count -eq 0) { throw 'Navigation plan must contain at least one screen.' }
$allowedKeys = @('DPAD_UP','DPAD_DOWN','DPAD_LEFT','DPAD_RIGHT','DPAD_CENTER','BACK','MEDIA_PLAY_PAUSE')
foreach ($step in $plan) {
    if ($step.name -notmatch '^[a-zA-Z0-9_-]+$' -or -not $step.expectedText -or @($step.keys).Count -eq 0) { throw 'Each plan screen needs safe name, expectedText and keys.' }
    foreach ($key in $step.keys) { if ($key -notin $allowedKeys) { throw "Unsupported remote key: $key" } }
}
$adbPath = (Get-Command adb -ErrorAction Stop).Source
$deviceArgs = @()
if ($Serial) { $deviceArgs = @('-s',$Serial) }
function Invoke-Adb([string[]]$CommandArgs) {
    $result = & $adbPath @deviceArgs @CommandArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "adb failed: $($result -join ' ')" }
    return ($result -join "`n")
}
function Save-Screenshot([string]$Destination) {
    # Read binary stdout directly: Windows PowerShell's '>' can corrupt PNG bytes.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $adbPath
    $start.Arguments = ((@($deviceArgs) + @('exec-out','screencap','-p')) -join ' ')
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $stream = [IO.File]::Create($Destination)
    try {
        if (-not $process.Start()) { throw 'Could not start screenshot capture.' }
        $process.StandardOutput.BaseStream.CopyTo($stream)
        $errorText = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "Screenshot failed: $errorText" }
    } finally { $stream.Dispose(); $process.Dispose() }
    $bytes = [IO.File]::ReadAllBytes($Destination)
    if ($bytes.Length -lt 8 -or ($bytes[0..7] -join ',') -ne '137,80,78,71,13,10,26,10') { throw 'Screenshot did not contain a PNG.' }
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$deviceState = Invoke-Adb @('get-state')
if ($deviceState.Trim() -ne 'device') { throw 'An authorized connected emulator/device is required.' }
$logPath = Join-Path $outputPath 'runtime.log'
$errorPath = Join-Path $outputPath 'logcat-stderr.log'
$logProcess = $null
$checks = @()
$reportPath = Join-Path $outputPath 'report.json'
try {
    # -T 1 starts at the newest line without clearing existing device diagnostics.
    $logProcess = Start-Process -FilePath $adbPath -ArgumentList (@($deviceArgs) + @('logcat','-T','1','-v','brief','AndroidRuntime:E','ActivityManager:E','*:S')) -WindowStyle Hidden -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $errorPath
    Invoke-Adb @('shell','am','start','-W','-a','android.intent.action.MAIN','-c','android.intent.category.LEANBACK_LAUNCHER','-p',$PackageName) | Out-Null
    foreach ($step in $plan) {
        foreach ($key in $step.keys) { Invoke-Adb @('shell','input','keyevent',"KEYCODE_$key") | Out-Null; Start-Sleep -Milliseconds $SettleMs }
        $file = Join-Path $outputPath ($step.name + '.png')
        Save-Screenshot $file
        Invoke-Adb @('shell','uiautomator','dump','/sdcard/jabtempo-smoke.xml') | Out-Null
        $hierarchy = Invoke-Adb @('exec-out','cat','/sdcard/jabtempo-smoke.xml')
        $hierarchy | Set-Content -LiteralPath (Join-Path $outputPath ($step.name + '.xml')) -Encoding UTF8
        $found = $hierarchy.Contains([string]$step.expectedText)
        $pidText = Invoke-Adb @('shell','pidof',$PackageName)
        $checks += [pscustomobject]@{ screen=$step.name; expectedText=$step.expectedText; found=$found; appRunning=([bool]$pidText.Trim()); screenshot=$file }
        if (-not $found) { throw "Expected screen text not found: $($step.name). Review screenshot and XML; do not count this as PASS." }
        if (-not $pidText.Trim()) { throw "App process exited on screen $($step.name)." }
    }
    Start-Sleep -Milliseconds 500
    $logs = Get-Content -LiteralPath $logPath -Raw
    if ($logs -match 'FATAL EXCEPTION|ANR in|am_anr|Application Not Responding') { throw 'Crash/ANR detected; inspect runtime.log.' }
    [pscustomobject]@{ status='PASS'; setup='actual adb-connected TV emulator/device'; package=$PackageName; capturedUtc=[DateTime]::UtcNow.ToString('o'); checks=$checks; limitations='Checks text, process liveness, PNG capture and runtime errors. Human review still required for focus rings, layout, audio and accessibility.' } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Output "UI smoke PASS. Evidence: $reportPath"
} catch {
    [pscustomobject]@{ status='FAIL'; package=$PackageName; reason=$_.Exception.Message; checks=$checks } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    throw
} finally {
    if ($logProcess -and -not $logProcess.HasExited) { Stop-Process -Id $logProcess.Id }
}
