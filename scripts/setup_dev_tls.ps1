# Run after: conda activate amazon-tv
# Creates workspace-local development certificates only. Does not trust/install any certificate.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$LanIP)
$ErrorActionPreference = 'Stop'
if ($env:CONDA_DEFAULT_ENV -ne 'amazon-tv' -or -not $env:CONDA_PREFIX) { throw 'Activate amazon-tv before generating development TLS.' }
if ($LanIP -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' -or @($LanIP.Split('.') | Where-Object { [int]$_ -gt 255 }).Count -gt 0) { throw 'LanIP must be a dotted IPv4 address, for example 192.168.1.20.' }
$ipAddress = $null
if (-not [Net.IPAddress]::TryParse($LanIP, [ref]$ipAddress) -or $ipAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ipAddress.ToString() -ne $LanIP) { throw 'LanIP must use canonical dotted IPv4 notation.' }
$envPrefix = [IO.Path]::GetFullPath($env:CONDA_PREFIX).TrimEnd('\') + '\'
$keytool = (Get-Command keytool -ErrorAction Stop).Source
if (-not [IO.Path]::GetFullPath($keytool).StartsWith($envPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'keytool must resolve inside amazon-tv JDK.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tlsFolder = Join-Path $repoRoot ('.cache\tls\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $tlsFolder -Force | Out-Null
$pfxPath = Join-Path $tlsFolder 'jabtempo-dev.p12'
$certPath = Join-Path $tlsFolder 'jabtempo-dev.cer'
if (-not $env:JABTEMPO_TLS_PASSWORD) {
    $passwordBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($passwordBytes) } finally { $generator.Dispose() }
    $env:JABTEMPO_TLS_PASSWORD = [Convert]::ToBase64String($passwordBytes)
}
if ($env:JABTEMPO_TLS_PASSWORD.Length -lt 12) { throw 'Development TLS password must have at least 12 characters.' }
# :env avoids placing a private-keystore password in process command lines/output.
& $keytool -genkeypair -alias jabtempo-dev -keyalg RSA -keysize 2048 -sigalg SHA256withRSA -storetype PKCS12 -keystore $pfxPath -storepass:env JABTEMPO_TLS_PASSWORD -keypass:env JABTEMPO_TLS_PASSWORD -dname 'CN=localhost, OU=Local Development, O=JabTempo TV' -validity 30 -ext "SAN=dns:localhost,ip:127.0.0.1,ip:$LanIP" -ext 'EKU=serverAuth' -ext 'KU=digitalSignature,keyEncipherment' -ext 'BC=ca:false' -noprompt
if ($LASTEXITCODE -ne 0) { throw 'keytool development key generation failed.' }
& $keytool -exportcert -alias jabtempo-dev -keystore $pfxPath -storetype PKCS12 -storepass:env JABTEMPO_TLS_PASSWORD -file $certPath
if ($LASTEXITCODE -ne 0) { throw 'keytool public certificate export failed.' }
$env:JABTEMPO_TLS_PFX = $pfxPath
$env:JABTEMPO_PUBLIC_RELAY_URL = "wss://${LanIP}:8787/bridge"
$metadata = [pscustomobject]@{ developmentOnly=$true; generatedUtc=[DateTime]::UtcNow.ToString('o'); expiresAfterDays=30; lanIP=$LanIP; pfxPath=$pfxPath; certificatePath=$certPath; publicCertificateSha256=(Get-FileHash -LiteralPath $certPath -Algorithm SHA256).Hash; trustInstalled=$false }
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $tlsFolder 'metadata.json') -Encoding UTF8
Write-Output "Development PKCS12 created: $pfxPath"
Write-Output "Public certificate created: $certPath"
Write-Output "Certificate file SHA256: $($metadata.publicCertificateSha256)"
Write-Output 'TLS environment variables are set for this PowerShell process. Run npm run dev in this shell.'
Write-Output 'No certificate trust, firewall rule, OS setting or phone configuration was changed. Phone/browser trust remains pending.'
