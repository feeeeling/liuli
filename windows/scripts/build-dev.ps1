# A self-contained folder for UI validation before release signing is configured.
[CmdletBinding()]
param([switch]$SkipPrepare)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $SkipPrepare) { & "$PSScriptRoot/prepare-daemon.ps1" }
$output = Join-Path $root 'dist/windows-dev'
& msbuild "$root/windows/Liuli.Windows/Liuli.Windows.csproj" /restore /t:Publish /m /p:Configuration=Release /p:Platform=x64 /p:WindowsPackageType=None /p:AppxPackage=false /p:GenerateAppxPackageOnBuild=false /p:IntermediateOutputPath=obj/Unpackaged/Release/ /p:OutputPath=bin/Unpackaged/Release/ "/p:PublishDir=$output/"
if ($LASTEXITCODE -ne 0) { throw 'Windows development build failed.' }
foreach ($relative in @('Liuli.Windows.exe', 'runtime/node.exe', 'daemon/index.mjs')) {
    if (-not (Test-Path (Join-Path $output $relative))) { throw "Missing development file: $relative" }
}
Write-Host "Development-only runtime folder: $output"
