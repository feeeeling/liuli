# Verify the deployed filename layout, including OPC-escaped scoped npm packages.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$package = Get-ChildItem "$root/dist/windows-packages" -Filter *.msix -Recurse | Select-Object -First 1
if (-not $package) { throw 'No MSIX package found.' }
$makeAppx = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin/*/x64/makeappx.exe" |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeAppx) { throw 'Windows SDK MakeAppx.exe is required.' }
$unpacked = Join-Path $root 'dist/windows-unpacked'
& $makeAppx.FullName unpack /p $package.FullName /d $unpacked /o
if ($LASTEXITCODE -ne 0) { throw 'MSIX unpack failed.' }
foreach ($relative in @('Liuli.Windows.exe', 'Liuli.Core.dll', 'LICENSE.txt', 'runtime/node.exe', 'runtime/LICENSE.node.txt', 'daemon/index.mjs', 'daemon/node_modules/@earendil-works/pi-coding-agent/package.json')) {
    if (-not (Test-Path (Join-Path $unpacked $relative))) { throw "Missing packaged file: $relative" }
}
& dotnet run --project "$root/windows/Liuli.Core.Tests" -c Release -- "$unpacked/runtime/node.exe" "$unpacked/daemon/index.mjs" "$root/daemon/src/windows-fixture.ts"
if ($LASTEXITCODE -ne 0) { throw 'Packaged daemon contract checks failed.' }
