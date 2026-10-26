# Build a private production dependency tree; do not copy the developer's credentials.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$daemon = Join-Path $root 'daemon'
$payload = Join-Path $root 'dist/windows-payload'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
    throw 'Run this script using x64 PowerShell and Node for the x64 Windows build.'
}
if ((& $nodePath -p 'process.arch') -ne 'x64') { throw 'An x64 Node runtime is required.' }
$nodeVersion = [version]((& $nodePath -p 'process.versions.node').Trim())
if ($nodeVersion -lt [version]'22.19.0') { throw 'Node >= 22.19.0 is required by Pi SDK.' }
Push-Location $daemon
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Daemon build failed.' }
} finally { Pop-Location }
# This directory is generated only by this script.
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item "$payload/runtime", "$payload/daemon" -ItemType Directory -Force | Out-Null
Copy-Item $nodePath "$payload/runtime/node.exe"
$nodeLicense = Join-Path (Split-Path $nodePath) 'LICENSE'
if (Test-Path $nodeLicense) {
    Copy-Item $nodeLicense "$payload/runtime/LICENSE.node.txt"
} else {
    Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/v$nodeVersion/LICENSE" -OutFile "$payload/runtime/LICENSE.node.txt"
}
Copy-Item "$daemon/dist/index.mjs", "$daemon/package.json", "$daemon/package-lock.json" "$payload/daemon/"
Push-Location "$payload/daemon"
try {
    & npm.cmd ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
} finally { Pop-Location }
Write-Host "Prepared $payload"
