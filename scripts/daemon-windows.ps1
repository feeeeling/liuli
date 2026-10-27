#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Check', 'Build', 'Start')]
    [string]$Action = 'Start',
    [ValidateRange(1, 65535)]
    [int]$Port = 17891
)

$ErrorActionPreference = 'Stop'
$daemonDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'daemon'
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
$nodeVersion = & $nodeCommand.Source -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 22) {
    throw 'Liuli requires Node.js 22 or newer.'
}

function Invoke-LiuliNpm {
    param([string[]]$NpmArguments)
    & $npmCommand.Source @NpmArguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($NpmArguments -join ' ') failed (exit $LASTEXITCODE)."
    }
}

$previousPort = $env:LIULI_PORT
Push-Location -LiteralPath $daemonDirectory
try {
    if ($PSBoundParameters.ContainsKey('Port')) { $env:LIULI_PORT = [string]$Port }
    if ($Action -eq 'Install') {
        Invoke-LiuliNpm -NpmArguments @('ci', '--no-audit', '--no-fund')
        return
    }
    if (-not (Test-Path -LiteralPath 'node_modules/.bin/tsx.cmd')) {
        throw 'Dependencies are missing. Run: .\scripts\daemon-windows.ps1 -Action Install'
    }
    switch ($Action) {
        'Check' {
            Invoke-LiuliNpm -NpmArguments @('run', 'typecheck')
            Invoke-LiuliNpm -NpmArguments @('test')
            Invoke-LiuliNpm -NpmArguments @('run', 'build')
            Invoke-LiuliNpm -NpmArguments @('run', 'smoke')
        }
        'Build' { Invoke-LiuliNpm -NpmArguments @('run', 'build') }
        'Start' {
            # Run node directly so Ctrl+C reaches the daemon without an npm wrapper.
            & $nodeCommand.Source '--import' 'tsx' 'src/index.ts'
            if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1073741510) {
                throw "Liuli daemon exited with code $LASTEXITCODE."
            }
        }
    }
} finally {
    $env:LIULI_PORT = $previousPort
    Pop-Location
}
