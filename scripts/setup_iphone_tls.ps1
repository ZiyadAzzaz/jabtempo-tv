# Dot-source after conda activate amazon-tv. Creates local files; never installs trust/firewall rules.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$LanIP,[switch]$NewCertificate)
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv') { throw 'Activate amazon-tv first.' }
$address = $null
if (-not [Net.IPAddress]::TryParse($LanIP,[ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $address.ToString() -ne $LanIP) { throw 'Use the laptop Wi-Fi IPv4 address, for example 192.168.1.20.' }
if ($LanIP -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.0\.0\.1$)') { throw 'Use a private LAN IPv4 address; loopback is allowed for local verification only.' }
$keytool = (Get-Command keytool -ErrorAction Stop).Source
$prefix = [IO.Path]::GetFullPath($env:CONDA_PREFIX).TrimEnd('\')+'\'
if (-not [IO.Path]::GetFullPath($keytool).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'keytool must be from amazon-tv.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tlsBase = Join-Path $repoRoot '.cache\iphone-tls'
$activeFile = Join-Path $tlsBase ('active-'+$LanIP.Replace('.','-')+'.json')
function Set-TaskConnection($Info,[string]$Password) {
    $env:JABTEMPO_TLS_PASSWORD = $Password
    $env:JABTEMPO_TLS_PFX = $Info.serverStore
    $env:JABTEMPO_HOST = $LanIP
    $env:JABTEMPO_PORT = '8787'
    $env:JABTEMPO_PUBLIC_RELAY_URL = "wss://${LanIP}:8787/bridge"
    $env:JABTEMPO_IPHONE_PROFILE = $Info.profile
    $env:JABTEMPO_IPHONE_ROOT = $Info.rootCertificate
    Write-Output "Certificate name: $($Info.name)"
    Write-Output "Public certificate SHA256: $($Info.rootSha256)"
    Write-Output "Public certificate (laptop manual trust): $($Info.rootCertificate)"
    Write-Output "Laptop game: https://${LanIP}:8787/tv-web"
    Write-Output "iPhone camera: https://${LanIP}:8787/phone"
    Write-Output "iPhone profile download: http://${LanIP}:8788/"
    Write-Output 'Next: npm run dev:iphone in THIS terminal. No certificate trust or firewall setting was changed.'
}
if (-not $NewCertificate -and (Test-Path -LiteralPath $activeFile)) {
    $saved = Get-Content -LiteralPath $activeFile -Raw | ConvertFrom-Json
    $valid = $saved.lanIP -eq $LanIP -and [DateTime]::Parse($saved.expiresUtc).ToUniversalTime() -gt [DateTime]::UtcNow.AddHours(1)
    foreach ($file in @($saved.serverStore,$saved.rootCertificate,$saved.profile,$saved.passwordFile)) {
        if (-not $file -or -not [IO.Path]::GetFullPath($file).StartsWith([IO.Path]::GetFullPath($tlsBase).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file)) { $valid = $false }
    }
    if ($valid) {
        $secure = (Get-Content -LiteralPath $saved.passwordFile -Raw).Trim() | ConvertTo-SecureString
        $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { Set-TaskConnection $saved ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle) }
        Write-Output 'Reused the existing certificate. No profile reinstall is needed if already trusted.'
        return
    }
}
$folder = Join-Path $repoRoot ('.cache\iphone-tls\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$rootStore = Join-Path $folder 'root-private.p12'
$rootCert = Join-Path $folder 'jabtempo-root.cer'
$serverStore = Join-Path $folder 'jabtempo-server.p12'
$request = Join-Path $folder 'server.csr'
$reply = Join-Path $folder 'server-signed.cer'
$profile = Join-Path $folder 'jabtempo-iphone.mobileconfig'
$id = [Guid]::NewGuid().ToString()
$name = 'JabTempo Local Camera CA '+$id.Substring(0,8)
function New-TaskPassword {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$env:JABTEMPO_TLS_PASSWORD = New-TaskPassword
$env:JABTEMPO_ROOT_PASSWORD = New-TaskPassword
function Invoke-TaskKeytool([string[]]$Arguments) {
    & $keytool @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Local certificate preparation failed. No trust was installed.' }
}
try {
    Invoke-TaskKeytool @('-genkeypair','-alias','root','-keyalg','RSA','-keysize','2048','-sigalg','SHA256withRSA','-storetype','PKCS12','-keystore',$rootStore,'-storepass:env','JABTEMPO_ROOT_PASSWORD','-dname',"CN=$name, O=JabTempo Local Development",'-validity','30','-ext','BC:critical=ca:true,pathlen:0','-ext','KU:critical=keyCertSign,cRLSign','-noprompt')
    Invoke-TaskKeytool @('-exportcert','-alias','root','-keystore',$rootStore,'-storepass:env','JABTEMPO_ROOT_PASSWORD','-file',$rootCert)
    Invoke-TaskKeytool @('-genkeypair','-alias','server','-keyalg','RSA','-keysize','2048','-sigalg','SHA256withRSA','-storetype','PKCS12','-keystore',$serverStore,'-storepass:env','JABTEMPO_TLS_PASSWORD','-dname',"CN=$LanIP, O=JabTempo Local Development",'-validity','30','-noprompt')
    Invoke-TaskKeytool @('-certreq','-alias','server','-keystore',$serverStore,'-storepass:env','JABTEMPO_TLS_PASSWORD','-file',$request)
    Invoke-TaskKeytool @('-gencert','-alias','root','-keystore',$rootStore,'-storepass:env','JABTEMPO_ROOT_PASSWORD','-infile',$request,'-outfile',$reply,'-validity','30','-ext',"SAN=dns:localhost,ip:127.0.0.1,ip:$LanIP",'-ext','BC:critical=ca:false','-ext','KU:critical=digitalSignature,keyEncipherment','-ext','EKU=serverAuth')
    Invoke-TaskKeytool @('-importcert','-alias','root','-keystore',$serverStore,'-storepass:env','JABTEMPO_TLS_PASSWORD','-file',$rootCert,'-noprompt')
    Invoke-TaskKeytool @('-importcert','-alias','server','-keystore',$serverStore,'-storepass:env','JABTEMPO_TLS_PASSWORD','-file',$reply,'-noprompt')
} finally {
    # This signing key is no longer needed. Exact generated workspace file only, no recursive removal.
    $checkedRoot = [IO.Path]::GetFullPath($rootStore)
    if (-not $checkedRoot.StartsWith([IO.Path]::GetFullPath($folder).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected signing-key path.' }
    if (Test-Path -LiteralPath $checkedRoot) { Remove-Item -LiteralPath $checkedRoot }
    Remove-Item Env:JABTEMPO_ROOT_PASSWORD -ErrorAction SilentlyContinue
}
$publicData = [Convert]::ToBase64String([IO.File]::ReadAllBytes($rootCert))
$xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>org.jabtempo.local.$id</string><key>PayloadUUID</key><string>$id</string>
<key>PayloadDisplayName</key><string>$name</string><key>PayloadDescription</key><string>Local JabTempo camera HTTPS certificate. No VPN, proxy or device management. Remove after testing.</string>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>org.jabtempo.local.$id.root</string><key>PayloadUUID</key><string>$([Guid]::NewGuid())</string>
<key>PayloadDisplayName</key><string>$name</string><key>PayloadCertificateFileName</key><string>jabtempo-root.cer</string>
<key>PayloadContent</key><data>$publicData</data>
</dict></array></dict></plist>
"@
[IO.File]::WriteAllText($profile,$xml,(New-Object Text.UTF8Encoding($false)))
$fingerprint = (Get-FileHash -LiteralPath $rootCert -Algorithm SHA256).Hash
$passwordFile = Join-Path $folder 'password.dpapi'
# Windows current-user DPAPI protection; never a password in source, logs or command arguments.
$env:JABTEMPO_TLS_PASSWORD | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile -Encoding UTF8
$info = [pscustomobject]@{ generatedUtc=[DateTime]::UtcNow.ToString('o'); expiresUtc=[DateTime]::UtcNow.AddDays(30).ToString('o'); expiresAfterDays=30; name=$name; lanIP=$LanIP; rootCertificate=$rootCert; profile=$profile; serverStore=$serverStore; passwordFile=$passwordFile; rootSha256=$fingerprint; trustInstalled=$false; signingKeyRemoved=$true }
$info | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'metadata.json') -Encoding UTF8
$info | ConvertTo-Json | Set-Content -LiteralPath $activeFile -Encoding UTF8
Set-TaskConnection $info $env:JABTEMPO_TLS_PASSWORD
