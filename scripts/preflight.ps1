conda activate amazon-tv
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv' -or -not $env:CONDA_PREFIX) {
    throw 'Activate the amazon-tv environment in initialized PowerShell first.'
}

$taskPrefix = [IO.Path]::GetFullPath($env:CONDA_PREFIX).TrimEnd('\') + '\'
foreach ($taskTool in @('node', 'npm', 'python', 'java')) {
    $taskCommand = Get-Command $taskTool -ErrorAction Stop
    $taskResolved = [IO.Path]::GetFullPath($taskCommand.Source)
    if (-not $taskResolved.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$taskTool resolves outside amazon-tv: $taskResolved"
    }
    Write-Output "$taskTool=$taskResolved"
}
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node verification failed' }
node -e "if (process.versions.node.split('.')[0] !== '20') process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Node 20 is required' }
python -c "import sys; assert sys.version_info[:2] == (3, 11); print(sys.version)"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required' }
java -version
if ($LASTEXITCODE -ne 0) { throw 'Java verification failed' }

$taskSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$taskAdb = Join-Path $taskSdk 'platform-tools\adb.exe'
$taskEmulator = Join-Path $taskSdk 'emulator\emulator.exe'
if (-not (Test-Path -LiteralPath $taskAdb) -or -not (Test-Path -LiteralPath $taskEmulator)) {
    Write-Output "G0 INCOMPLETE: Android SDK/emulator not available at $taskSdk"
    exit 2
}
& $taskAdb version
& $taskEmulator -accel-check
if ($LASTEXITCODE -ne 0) { throw 'Emulator acceleration is not ready. Inspect WHPX/virtualization.' }
& $taskEmulator -list-avds
Write-Output 'Tool preflight complete; G0 also requires a successful sample run and screenshot.'
