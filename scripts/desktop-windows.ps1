#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Check', 'Start', 'Package')]
    [string]$Action = 'Start'
)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$desktopDirectory = Join-Path $projectDirectory 'desktop'
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$nodeVersion = & node.exe -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.12.0') {
    throw 'The Windows desktop app requires Node.js 22.12 or newer.'
}

function Invoke-DesktopNpm {
    param([string[]]$NpmArguments)
    & $npmCommand.Source @NpmArguments
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArguments -join ' ') failed (exit $LASTEXITCODE)." }
}

if ($Action -eq 'Install') {
    & (Join-Path $PSScriptRoot 'daemon-windows.ps1') -Action Install
    Push-Location -LiteralPath $desktopDirectory
    try {
        Invoke-DesktopNpm -NpmArguments @('ci', '--no-audit', '--no-fund')
        Invoke-DesktopNpm -NpmArguments @('run', 'setup')
    } finally { Pop-Location }
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $desktopDirectory 'node_modules/electron/dist/electron.exe'))) {
    throw 'Dependencies are missing. Run: .\scripts\desktop-windows.ps1 -Action Install'
}
if ($Action -eq 'Check') {
    & (Join-Path $PSScriptRoot 'daemon-windows.ps1') -Action Check
} else {
    & (Join-Path $PSScriptRoot 'daemon-windows.ps1') -Action Build
}
Push-Location -LiteralPath $desktopDirectory
try {
    switch ($Action) {
        'Check' {
            Invoke-DesktopNpm -NpmArguments @('test')
            Invoke-DesktopNpm -NpmArguments @('run', 'test:e2e')
        }
        'Package' { Invoke-DesktopNpm -NpmArguments @('run', 'package') }
        'Start' { Invoke-DesktopNpm -NpmArguments @('start') }
    }
} finally { Pop-Location }
