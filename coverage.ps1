<#
.SYNOPSIS
  Runs the engine and API tests under code coverage and fails below the threshold (default 100 %).

.DESCRIPTION
  Needs Docker running (the API tests start PostgreSQL with Testcontainers). Writes to coverage/:
  `Summary.txt`, `Summary.json`, the merged `Cobertura.xml` (line and branch detail per file) and an HTML
  report in `coverage/Index.html`.
  The web app has its own gate: `cd web; npm run coverage`.

.EXAMPLE
  .\coverage.ps1
  .\coverage.ps1 -SkipBuild -Threshold 98
#>
param(
    [switch]$SkipBuild,
    [double]$Threshold = 100
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $SkipBuild) {
    dotnet build Folio.slnx --nologo -v q
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
}

dotnet tool restore | Out-Null
Remove-Item -Recurse -Force coverage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force coverage | Out-Null

$suites = @('Folio.Core.Tests', 'Folio.Api.Tests')
foreach ($suite in $suites) {
    # The test projects are Microsoft.Testing.Platform executables; running the dll through `dotnet` works on every OS.
    $dll = Join-Path $PSScriptRoot 'tests' $suite 'bin' 'Debug' 'net10.0' "$suite.dll"
    $report = Join-Path 'coverage' "$suite.cobertura.xml"
    dotnet dotnet-coverage collect --settings coverage.settings.xml -f cobertura -o $report dotnet $dll
    if ($LASTEXITCODE -ne 0) { throw "$suite failed." }
}

$reports = ($suites | ForEach-Object { Join-Path 'coverage' "$_.cobertura.xml" }) -join ';'
dotnet reportgenerator "-reports:$reports" '-targetdir:coverage' '-reporttypes:TextSummary;JsonSummary;Html;Cobertura' '-assemblyfilters:+Folio.Api;+Folio.Core' | Out-Null
Get-Content (Join-Path 'coverage' 'Summary.txt')

$summary = (Get-Content (Join-Path 'coverage' 'Summary.json') -Raw | ConvertFrom-Json).summary
$failed = @()
if ($summary.linecoverage -lt $Threshold) { $failed += "lines $($summary.linecoverage) %" }
if ($summary.branchcoverage -lt $Threshold) { $failed += "branches $($summary.branchcoverage) %" }
if ($failed) { throw "Coverage below $Threshold %: $($failed -join ', '). Open coverage\Index.html." }
Write-Host "Coverage gate passed ($Threshold %)." -ForegroundColor Green
