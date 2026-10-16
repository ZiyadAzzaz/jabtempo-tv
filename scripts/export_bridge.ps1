# Prepare a local public-ready source folder; never creates a remote repository or publishes.
[CmdletBinding()] param([string]$OutputDirectory='.cache/public-ready/tv-pose-bridge')
$ErrorActionPreference='Stop'
if($env:CONDA_DEFAULT_ENV -ne 'amazon-tv'){throw 'Activate amazon-tv first.'}
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination=[IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
if(-not $destination.StartsWith($repoRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Export must stay inside workspace.'}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$source=Join-Path $repoRoot 'packages/tv-pose-bridge'
foreach($item in @('src','test','examples','.github','package.json','package-lock.json','environment.yml','README.md','protocol.md','LICENSE')){
  Copy-Item -LiteralPath (Join-Path $source $item) -Destination $destination -Recurse -Force
}
Write-Output "Prepared source for owner review: $destination"
Write-Output 'No remote repository, account action, publication or submission was performed.'
