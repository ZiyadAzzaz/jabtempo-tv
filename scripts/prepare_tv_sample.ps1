conda activate amazon-tv
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'amazon-tv must be active' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskSample = Join-Path $taskRoot '.cache\amazon-tv-sample'
$taskRevision = 'a2dce86ee2d0bdbf03b4fdda9985672213d3647e'
if (-not (Test-Path -LiteralPath $taskSample)) {
    git clone https://github.com/AmazonAppDev/react-native-multi-tv-app-sample.git $taskSample
    if ($LASTEXITCODE -ne 0) { throw 'Sample clone failed' }
    git -C $taskSample checkout --detach $taskRevision
    if ($LASTEXITCODE -ne 0) { throw 'Pinned sample revision unavailable' }
}
$taskHead = git -C $taskSample rev-parse HEAD
if ($taskHead -ne $taskRevision) { throw 'Unexpected sample revision; inspect before changing the checkout' }
$env:YARN_GLOBAL_FOLDER = Join-Path $env:CONDA_PREFIX 'yarn-cache'
$env:YARN_ENABLE_TELEMETRY = '0'
$env:EXPO_TV = '1'
$env:CI = '1'
yarn --cwd $taskSample install --immutable
if ($LASTEXITCODE -ne 0) { throw 'Sample dependency install failed' }
yarn --cwd $taskSample workspace @multi-tv/expo-multi-tv exec expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { throw 'Android TV prebuild failed' }
Write-Output 'Native project prepared. G0 still requires SDK, emulator, build, launch and screenshot.'
