# Stop only processes whose full identity still matches this launcher's record.
[CmdletBinding()]
param([switch]$KeepEmulator,[switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'Run conda activate amazon-tv first.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$androidRoot = if ($env:JABTEMPO_ANDROID_ROOT) { [IO.Path]::GetFullPath($env:JABTEMPO_ANDROID_ROOT).TrimEnd('\') } else { 'D:\android-fire-TV' }
$stateFile = Join-Path $repoRoot '.cache\jabtempo-running-services.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Host 'No launcher record exists. Nothing was stopped.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($state.version -ne 2 -or -not [string]::Equals($state.repository,$repoRoot,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'This is an older or different repository launch record. No process was stopped. Stop manually started servers in their own terminals and close only the JabTempo emulator window.'
}
function Get-VerifiedProcess($Record,[string]$Role) {
    if (-not $Record -or $Record.pid -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$Record.pid)" -ErrorAction Stop
    if (-not $process) { Write-Host "$Role is already stopped."; return $null }
    if ($Record.role -ne $Role -or -not $process.ExecutablePath -or
        -not [string]::Equals($process.ExecutablePath,$Record.executable,[StringComparison]::OrdinalIgnoreCase) -or
        $process.CommandLine -cne $Record.commandLine -or
        $process.CreationDate.ToUniversalTime().ToString('o') -ne $Record.createdUtc) {
        throw "PID $($Record.pid) no longer matches the recorded $Role process. Nothing was stopped for this PID."
    }
    if ($Role -eq 'emulator') {
        if (-not $process.ExecutablePath.StartsWith((Join-Path $androidRoot 'sdk\emulator') + '\',[StringComparison]::OrdinalIgnoreCase) -or
            $process.CommandLine -notmatch '(?:^|\s)-avd\s+"?JabTempo_TV_1080p"?(?:\s|$)' -or
            $process.CommandLine -notmatch '(?:^|\s)-port\s+5580(?:\s|$)') { throw 'Recorded emulator identity is invalid.' }
    } else {
        $file = if ($Role -eq 'https') { 'iphone_dev_server.mjs' } else { 'emulator_gateway.mjs' }
        $script = Join-Path $PSScriptRoot $file
        $node = Join-Path $env:CONDA_PREFIX 'node.exe'
        $pattern = '^"?' + [regex]::Escape($node) + '"?\s+"?' + [regex]::Escape($script) + '"?\s*$'
        if (-not [string]::Equals($process.ExecutablePath,$node,[StringComparison]::OrdinalIgnoreCase) -or $process.CommandLine.Replace('/','\').Trim() -notmatch $pattern) { throw "Recorded $Role is not this repository's Node service." }
    }
    return $process
}
# Verify every identity before changing anything; stale PIDs must never kill a new owner.
$verified = @{}
foreach ($role in @('https','gateway')) { $verified[$role] = Get-VerifiedProcess $state.services.$role $role }
if (-not $KeepEmulator) { $verified.emulator = Get-VerifiedProcess $state.emulator 'emulator' }
if ($CheckOnly) {
    $verified.GetEnumerator() | ForEach-Object { [pscustomobject]@{ service=$_.Key; pid=$_.Value.ProcessId; wouldStop=[bool]$_.Value } } | ConvertTo-Json
    return
}
if (-not $KeepEmulator -and $verified.emulator) {
    $adb = Join-Path $androidRoot 'sdk\platform-tools\adb.exe'
    $name = & $adb -s emulator-5580 emu avd name 2>&1
    if ($LASTEXITCODE -ne 0 -or ($name -join "`n") -notmatch '(?m)^JabTempo_TV_1080p\s*$') { throw 'Could not confirm the emulator AVD name. It and all services were left running.' }
    $null = Get-VerifiedProcess $state.emulator 'emulator'
    & $adb -s emulator-5580 emu kill
    if ($LASTEXITCODE -ne 0) { throw 'The emulator did not accept a graceful close. Services were left running.' }
    $state.emulator = $null
    Write-Host 'Closed the JabTempo TV emulator.'
}
foreach ($role in @('gateway','https')) {
    if ($verified[$role]) {
        $current = Get-VerifiedProcess $state.services.$role $role
        if ($current) { Stop-Process -Id $current.ProcessId -ErrorAction Stop; Write-Host "Stopped JabTempo $role (PID $($current.ProcessId))." }
    }
    $state.services | Add-Member -MemberType NoteProperty -Name $role -Value $null -Force
}
$state.updatedUtc = [DateTime]::UtcNow.ToString('o')
$state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Host 'JabTempo services are stopped. Other applications and the shared adb server were left alone.'
