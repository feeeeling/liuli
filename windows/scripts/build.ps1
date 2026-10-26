[CmdletBinding()]
param([switch]$SkipPrepare)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $SkipPrepare) { & "$PSScriptRoot/prepare-daemon.ps1" }
$packages = Join-Path $root 'dist/windows-packages/'
& msbuild "$root/windows/Liuli.Windows/Liuli.Windows.csproj" /restore /m /p:Configuration=Release /p:Platform=x64 /p:GenerateAppxPackageOnBuild=true /p:AppxPackageSigningEnabled=false /p:UapAppxPackageBuildMode=SideloadOnly "/p:AppxPackageDir=$packages"
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
$msix = @(Get-ChildItem $packages -Filter *.msix -Recurse)
if ($msix.Count -eq 0) { throw 'Build did not produce an MSIX package.' }
Write-Host "Unsigned preview packages: $packages"
