# Start this repository's local phone server and native TV emulator.
# No certificate trust, firewall changes, public tunnels or paid services.
[CmdletBinding()]
param(
    [string]$LanIP,
    [switch]$CheckOnly,
    [ValidateRange(1024,4096)][int]$MemoryMB = 1536
)
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'Run conda activate amazon-tv first.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$androidRoot = if ($env:JABTEMPO_ANDROID_ROOT) { [IO.Path]::GetFullPath($env:JABTEMPO_ANDROID_ROOT).TrimEnd('\') } else { 'D:\android-fire-TV' }
$node = (Get-Command node -ErrorAction Stop).Source
$environmentPrefix = [IO.Path]::GetFullPath($env:CONDA_PREFIX).TrimEnd('\') + '\'
if (-not [IO.Path]::GetFullPath($node).StartsWith($environmentPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Node must come from amazon-tv.' }
$apk = Join-Path $androidRoot 'projects\jabtempo\apps\tv\android\app\build\outputs\apk\debug\app-debug.apk'
$avdName = 'JabTempo_TV_1080p'
$serial = 'emulator-5580'
$adb = Join-Path $androidRoot 'sdk\platform-tools\adb.exe'
$emulator = Join-Path $androidRoot 'sdk\emulator\emulator.exe'
$avdConfig = Join-Path $androidRoot 'avd\JabTempo_TV_1080p.avd\config.ini'
$stateFile = Join-Path $repoRoot '.cache\jabtempo-running-services.json'
$serverScript = Join-Path $PSScriptRoot 'iphone_dev_server.mjs'
$gatewayScript = Join-Path $PSScriptRoot 'emulator_gateway.mjs'

function Get-LanAddresses {
    foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($adapter.OperationalStatus -ne 'Up' -or $adapter.NetworkInterfaceType -notin @('Ethernet','Wireless80211')) { continue }
        $properties = $adapter.GetIPProperties()
        $hasGateway = @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' }).Count -gt 0
        foreach ($address in $properties.UnicastAddresses) {
            $ip = $address.Address.ToString()
            if ($address.Address.AddressFamily -eq 'InterNetwork' -and $ip -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
                [pscustomobject]@{ address=$ip; adapter=$adapter.Name; hasGateway=$hasGateway }
            }
        }
    }
}
function Get-ProcessInfo([int]$ProcessId) {
    Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
}
function Test-NodeIdentity($Process,[string]$Script) {
    if (-not $Process -or -not $Process.ExecutablePath -or -not $Process.CommandLine) { return $false }
    if (-not [string]::Equals([IO.Path]::GetFullPath($Process.ExecutablePath),$node,[StringComparison]::OrdinalIgnoreCase)) { return $false }
    $command = $Process.CommandLine.Replace('/','\').Trim()
    # Absolute paths establish repository ownership. A relative script path is ambiguous.
    $pattern = '^"?' + [regex]::Escape($node) + '"?\s+"?' + [regex]::Escape($Script) + '"?\s*$'
    return $command -match $pattern
}
function Get-ServiceListener([int[]]$Ports,[string]$Script) {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in $Ports })
    if ($listeners.Count -eq 0) { return $null }
    $ids = @($listeners.OwningProcess | Sort-Object -Unique)
    if ($ids.Count -ne 1) { throw "Ports $($Ports -join ', ') have multiple owners. Close only the JabTempo service you started, then retry." }
    $process = Get-ProcessInfo $ids[0]
    if (-not (Test-NodeIdentity $process $Script)) {
        throw "Port $($listeners[0].LocalPort) is occupied by an unverified process (PID $($ids[0])). Nothing was stopped. A manually started relative-path service must be stopped in its own terminal before using this launcher."
    }
    if (@($listeners.LocalPort | Sort-Object -Unique).Count -ne $Ports.Count) { throw "JabTempo PID $($ids[0]) is only partly listening. Inspect its terminal/log, stop that service, then retry." }
    if ($Script -eq $gatewayScript -and @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count) { throw 'The emulator gateway must listen on loopback only.' }
    return $process
}
function Get-EmulatorProcess {
    $emulatorCandidates = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $androidRoot 'sdk\emulator\'),[StringComparison]::OrdinalIgnoreCase) -and
        $_.CommandLine -match '(?:^|\s)-avd\s+"?JabTempo_TV_1080p"?(?:\s|$)' -and
        $_.CommandLine -match '(?:^|\s)-port\s+5580(?:\s|$)'
    })
    $qemu = @($emulatorCandidates | Where-Object { $_.Name -like 'qemu-system-*' })
    if ($qemu.Count -gt 1) { throw 'More than one host process matches the JabTempo emulator. Inspect them before continuing.' }
    if ($qemu.Count -eq 1) { return $qemu[0] }
    if ($emulatorCandidates.Count -gt 1) { throw 'The JabTempo emulator is still starting. Wait a few seconds and retry.' }
    if ($emulatorCandidates.Count) { return $emulatorCandidates[0] }
    return $null
}
function Convert-ProcessRecord($Process,[string]$Role) {
    [ordered]@{ role=$Role; pid=[int]$Process.ProcessId; executable=$Process.ExecutablePath; commandLine=$Process.CommandLine; createdUtc=$Process.CreationDate.ToUniversalTime().ToString('o') }
}
function Save-State {
    $state.updatedUtc = [DateTime]::UtcNow.ToString('o')
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding UTF8
}
function Start-NodeService([string]$Script,[string]$Role,[int[]]$Ports) {
    $existing = Get-ServiceListener $Ports $Script
    if ($existing) { Write-Host "Reusing $Role (PID $($existing.ProcessId))."; return $existing }
    $outLog = Join-Path $env:TEMP "jabtempo-$Role-$stamp.out.log"
    $errLog = Join-Path $env:TEMP "jabtempo-$Role-$stamp.err.log"
    $started = Start-Process -FilePath $node -ArgumentList @(('"'+$Script+'"')) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $process = Get-ProcessInfo $started.Id
    if (-not (Test-NodeIdentity $process $Script)) { throw "Could not verify the newly started $Role process." }
    $state.services[$Role] = Convert-ProcessRecord $process $Role
    Save-State
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $started.Refresh()
        if ($started.HasExited) { throw "$Role exited. Read $errLog" }
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in $Ports })
        if (@($listeners.LocalPort | Sort-Object -Unique).Count -eq $Ports.Count) {
            $listening = Get-ServiceListener $Ports $Script
            if ($listening.ProcessId -ne $started.Id) { throw "$Role port ownership changed while starting. Nothing was stopped." }
            return $listening
        }
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Role did not become ready. Read $errLog"
}
function Invoke-Adb([string[]]$Arguments,[switch]$NoSerial) {
    $adbArguments = @()
    if (-not $NoSerial) { $adbArguments += @('-s',$serial) }
    $adbArguments += $Arguments
    # Windows PowerShell 5.1 promotes native stderr to NativeCommandError when
    # ErrorActionPreference is Stop. ADB writes ordinary cold-start progress
    # there, so capture both streams and decide from its process exit code.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $adb @adbArguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    $output = (@($lines | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ($exitCode -ne 0) { throw "Android command failed: $($adbArguments -join ' ')`n$output" }
    return $output
}

$addresses = @(Get-LanAddresses)
if ($LanIP) {
    if (-not ($addresses | Where-Object { $_.address -eq $LanIP })) { throw '-LanIP must be a private IPv4 address currently assigned to an active laptop Wi-Fi/Ethernet adapter.' }
} else {
    $candidates = @($addresses | Where-Object hasGateway | Select-Object -ExpandProperty address -Unique)
    if ($candidates.Count -ne 1) {
        $choices = ($addresses | ForEach-Object { "$($_.adapter): $($_.address)" }) -join '; '
        throw "Could not select one Wi-Fi/Ethernet address. Connect the laptop to Wi-Fi, or run .\scripts\start_playing.ps1 -LanIP YOUR_WIFI_IPV4. Available: $choices"
    }
    $LanIP = $candidates[0]
}
foreach ($required in @($adb,$emulator,$avdConfig,$apk,(Join-Path $repoRoot '.cache\models\pose_landmarker_full.task'),(Join-Path $repoRoot 'node_modules\@mediapipe\tasks-vision\wasm\vision_wasm_internal.wasm'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local file is missing: $required. See docs/native_emulator_play.md for setup; no downloads or SDK installation were started." }
}
$config = Get-Content -LiteralPath $avdConfig -Raw
if ($config -notmatch '(?m)^hw.device.name=tv_1080p\s*$' -or $config -notmatch 'android-tv') { throw 'The named AVD is not the expected Android TV emulator.' }
# Inspect the APK itself; source files/build timestamps cannot prove its bundled URL.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    $entry = $archive.GetEntry('assets/index.android.bundle')
    if (-not $entry) { throw 'The APK does not contain a standalone JavaScript bundle. Rebuild the native app.' }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $bundle = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
$dynamicSetup = $bundle.Contains('http://10.0.2.2:8789/connection')
$embeddedUrls = @([regex]::Matches($bundle,'https://[0-9.]+:8787/phone') | ForEach-Object Value | Sort-Object -Unique)
$phoneUrl = "https://${LanIP}:8787/phone"
if (-not $bundle.Contains('ws://10.0.2.2:8789/bridge')) { throw 'The APK is not configured for this emulator gateway. Rebuild with EXPO_PUBLIC_JABTEMPO_RELAY_URL=ws://10.0.2.2:8789/bridge.' }
if (-not $dynamicSetup -and ($embeddedUrls.Count -ne 1 -or $embeddedUrls[0] -ne $phoneUrl)) {
    throw "This older APK points to $($embeddedUrls -join ', '), but the laptop is now $LanIP. Rebuild with the current phone URL and EXPO_PUBLIC_JABTEMPO_SETUP_URL=http://10.0.2.2:8789/connection (see docs/native_emulator_play.md). No services were started."
}
$existingServer = Get-ServiceListener @(8787,8788) $serverScript
$existingGateway = Get-ServiceListener @(8789) $gatewayScript
$existingEmulator = Get-EmulatorProcess
if ($CheckOnly) {
    [ordered]@{ mode='check only; no services started or stopped'; phoneUrl=$phoneUrl; apk=$apk; dynamicPhoneUrl=$dynamicSetup; httpsRunning=[bool]$existingServer; gatewayRunning=[bool]$existingGateway; emulatorRunning=[bool]$existingEmulator; keyboardEnabled=($config -match '(?m)^hw.keyboard=yes\s*$'); mouseEnabled=($config -match '(?m)^hw.screen=multi-touch\s*$') } | ConvertTo-Json
    return
}

$tlsKeys = @('JABTEMPO_TLS_PASSWORD','JABTEMPO_TLS_PFX','JABTEMPO_HOST','JABTEMPO_PORT','JABTEMPO_PUBLIC_RELAY_URL','JABTEMPO_IPHONE_PROFILE','JABTEMPO_IPHONE_ROOT')
$previousTls = @{}
foreach ($key in $tlsKeys) { $previousTls[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
Push-Location $repoRoot
try {
    . (Join-Path $PSScriptRoot 'use_android_sdk.ps1')
    New-Item -ItemType Directory -Path (Join-Path $repoRoot '.cache'),$env:TEMP -Force | Out-Null
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    # Refresh the small browser controller build; native APK installation is handled below.
    & $node (Join-Path $PSScriptRoot 'build_web.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Phone controller build failed. No new services were started.' }
    . (Join-Path $PSScriptRoot 'setup_iphone_tls.ps1') -LanIP $LanIP | Out-Null
    $state = [ordered]@{ version=2; repository=$repoRoot; updatedUtc=''; phoneUrl=$phoneUrl; serial=$serial; avd=$avdName; services=[ordered]@{https=$null;gateway=$null}; emulator=$null }
    if ($existingServer) { $state.services.https = Convert-ProcessRecord $existingServer 'https' }
    if ($existingGateway) { $state.services.gateway = Convert-ProcessRecord $existingGateway 'gateway' }
    if ($existingEmulator) { $state.emulator = Convert-ProcessRecord $existingEmulator 'emulator' }
    Save-State
    $server = Start-NodeService $serverScript 'https' @(8787,8788)
    $state.services.https = Convert-ProcessRecord $server 'https'; Save-State
    $gateway = Start-NodeService $gatewayScript 'gateway' @(8789)
    $state.services.gateway = Convert-ProcessRecord $gateway 'gateway'; Save-State
    # A 200 from the gateway alone does not prove upstream connectivity. Check the
    # phone HTTPS certificate and send a real protocol create through the gateway.
    @'
const https = require('node:https');
const http = require('node:http');
const {readFileSync} = require('node:fs');
const {X509Certificate} = require('node:crypto');
const WebSocket = require('ws');
const ca = new X509Certificate(readFileSync(process.env.JABTEMPO_IPHONE_ROOT)).toString();
function get(client,url,options={}) {return new Promise((resolve,reject)=>{
  const req=client.get(url,options,res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>res.statusCode===200?resolve(body):reject(Error(`HTTP ${res.statusCode}: ${url}`)));});
  req.on('error',reject);req.setTimeout(7000,()=>req.destroy(Error(`Timed out: ${url}`)));
});}
(async()=>{
  const base=`https://${process.env.JABTEMPO_HOST}:8787`;
  if(JSON.parse(await get(https,`${base}/health`,{ca,rejectUnauthorized:true})).ok!==true)throw Error('Phone relay health failed.');
  const connection=JSON.parse(await get(http,'http://127.0.0.1:8789/connection'));
  if(connection.phoneUrl!==`${base}/phone`)throw Error('Existing gateway points to a different Wi-Fi address. Stop these JabTempo services and restart.');
  await get(https,`${base}/assets/camera.js`,{ca,rejectUnauthorized:true});
  await new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:8789/bridge');
    const timer=setTimeout(()=>{ws.terminate();reject(Error('Gateway upstream did not respond.'));},7000);
    ws.on('open',()=>ws.send(JSON.stringify({relay:1,action:'create',versions:[1]})));
    ws.on('message',data=>{try{const msg=JSON.parse(data);if(msg.action!=='created')throw Error('Unexpected relay response.');clearTimeout(timer);ws.close();resolve();}catch(error){clearTimeout(timer);ws.terminate();reject(error);}});
    ws.on('error',error=>{clearTimeout(timer);reject(error);});
    ws.on('close',()=>{clearTimeout(timer);reject(Error('Gateway closed before readiness.'));});
  });
  console.log('Phone HTTPS, controller assets and gateway upstream verified.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
'@ | & $node -
    if ($LASTEXITCODE -ne 0) { throw 'Connection check failed. See the message above; no certificate checks were bypassed.' }

    $devices = Invoke-Adb @('devices') -NoSerial
    if ($devices -match '(?m)^emulator-5580\s' -and -not $existingEmulator) { throw 'Serial emulator-5580 belongs to an unverified host emulator. Nothing was stopped.' }
    if (-not $existingEmulator) {
        & (Get-Command python -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'configure_emulator_controls.py')
        if ($LASTEXITCODE -ne 0) { throw 'Could not enable laptop keyboard and mouse on the stopped development AVD.' }
        Start-Process -FilePath $emulator -ArgumentList @('-avd',$avdName,'-port','5580','-memory',"$MemoryMB",'-gpu','auto','-no-snapshot-save','-no-boot-anim') -WindowStyle Normal -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "jabtempo-emulator-$stamp.out.log") -RedirectStandardError (Join-Path $env:TEMP "jabtempo-emulator-$stamp.err.log") | Out-Null
    }
    Write-Host 'Waiting for the Android TV emulator (up to two minutes)...'
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $ready = $false
    do {
        $ownedEmulator = Get-EmulatorProcess
        if ($ownedEmulator) { $state.emulator = Convert-ProcessRecord $ownedEmulator 'emulator'; Save-State }
        $boot = ''
        try { $boot = Invoke-Adb @('shell','getprop','sys.boot_completed') } catch { }
        if ($boot -eq '1' -and $ownedEmulator) { $ready=$true; break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $ready) { throw "The emulator did not finish booting. Inspect its visible window and $(Join-Path $androidRoot "tmp\jabtempo-emulator-$stamp.err.log")." }
    if ((Invoke-Adb @('emu','avd','name')) -notmatch '(?m)^JabTempo_TV_1080p\s*$') { throw 'The running serial is not our named AVD.' }
    $apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $packagePath = Invoke-Adb @('shell','pm','path','org.jabtempo.tv')
    $installedHash = ''
    if ($packagePath -match '(?m)^package:(/data/app/[^\r\n]+/base.apk)\s*$') {
        $installedPath = $Matches[1]
        if ($installedPath -match '^/data/app/[A-Za-z0-9_+~=/.-]+/base\.apk$') {
            $hashLines = ''
            try { $hashLines = Invoke-Adb @('shell','sha256sum',$installedPath) } catch { }
            if ($hashLines -match '^([a-f0-9]{64})\s') { $installedHash=$Matches[1] }
        }
    }
    if ($installedHash -ne $apkHash) {
        Write-Host 'Installing the current JabTempo APK (saved app data is retained)...'
        $install = Invoke-Adb @('install','-r',$apk)
        if ($install -notmatch '(?m)^Success\s*$') { throw "APK installation did not report success: $install" }
    } else { Write-Host 'The current APK is already installed.' }
    $launch = Invoke-Adb @('shell','am','start','-W','-n','org.jabtempo.tv/.MainActivity')
    if ($launch -notmatch 'Status: ok') { throw "JabTempo launch failed: $launch" }
    $state.apkSha256 = $apkHash; Save-State
    Write-Host ''
    Write-Host 'READY: use the Android TV emulator window on your laptop.'
    Write-Host 'Click the emulator first. Arrow keys move; Enter selects; Escape / toolbar Back goes back.'
    Write-Host "PHONE: $phoneUrl (same Wi-Fi; use Safari on iPhone)."
    Write-Host 'On TV choose Play. On phone enter the current code, tap Connect to TV, then Start camera.'
    Write-Host 'Phone command buttons control the game; TV menu navigation uses the laptop keys / emulator Directional Pad.'
    $certificateHash = (Get-FileHash -LiteralPath $env:JABTEMPO_IPHONE_ROOT -Algorithm SHA256).Hash
    Write-Host "LOCAL CERTIFICATE SHA256: $certificateHash"
    Write-Host 'If Safari warns, follow the manual iPhone trust steps in docs/how_to_play.md.'
    Write-Host 'The servers run in the background. To stop: .\scripts\stop_playing.ps1'
} catch {
    Write-Host 'Startup did not complete. Any verified processes already started are listed in .cache/jabtempo-running-services.json.'
    Write-Host 'Use .\scripts\stop_playing.ps1 to stop only those recorded JabTempo processes.'
    throw
} finally {
    foreach ($key in $tlsKeys) { [Environment]::SetEnvironmentVariable($key,$previousTls[$key],'Process') }
    Pop-Location
}
