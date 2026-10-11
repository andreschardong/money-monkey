<#
.SYNOPSIS
    Attaches the custom host name to the Money Monkey container app with a free managed certificate.
.DESCRIPTION
    Run after deploy.ps1 and after the CNAME and TXT records it printed exist in DNS (proxy off in Cloudflare).
    Certificate issue takes a few minutes; the script waits for it.
#>
param(
    [string] $ResourceGroup = 'folio',
    [string] $Environment = 'folio-env',
    [string] $App = 'folio',
    # The public host name (FOLIO_HOSTNAME in .env when not given).
    [string] $Hostname
)

$ErrorActionPreference = 'Stop'

if (-not $Hostname) {
    $envFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^FOLIO_HOSTNAME=(.+)$' } | Select-Object -First 1
        if ($line -match '^FOLIO_HOSTNAME=(.+)$') { $Hostname = $Matches[1].Trim() }
    }
}
if (-not $Hostname) { throw 'Give -Hostname or set FOLIO_HOSTNAME in .env.' }

$label = $Hostname.Split('.')[0]
$domain = $Hostname.Substring($label.Length + 1)
# Asked over DNS-over-HTTPS so a stale answer in the PC's own resolver (or a VPN's) doesn't block the check.
function Resolve-Public([string] $Name, [string] $RecordType) {
    $code = @{ CNAME = 5; TXT = 16 }[$RecordType]
    $answer = (Invoke-RestMethod -Uri "https://cloudflare-dns.com/dns-query?name=$Name&type=$RecordType" -Headers @{ accept = 'application/dns-json' } -TimeoutSec 15).Answer
    @($answer | Where-Object { [int]$_.type -eq $code } | ForEach-Object { $_.data }) -join ' '
}
$cname = Resolve-Public $Hostname 'CNAME'
$txt = Resolve-Public "asuid.$Hostname" 'TXT'
Write-Host "CNAME $Hostname -> $cname"
Write-Host "TXT asuid.$Hostname -> $txt"
if (-not $cname) { throw "The CNAME for $Hostname is not visible yet; add it in Cloudflare (DNS only) and wait a minute." }

$bound = az containerapp hostname list -g $ResourceGroup -n $App --query "[?name=='$Hostname'].name" -o tsv 2>$null
if (-not $bound) {
    az containerapp hostname add -g $ResourceGroup -n $App --hostname $Hostname --only-show-errors -o none
    if ($LASTEXITCODE -ne 0) { throw 'hostname add failed' }
}

Write-Host 'Binding with a managed certificate (a few minutes)...'
az containerapp hostname bind -g $ResourceGroup -n $App --hostname $Hostname --environment $Environment --validation-method CNAME --only-show-errors -o none
if ($LASTEXITCODE -ne 0) { throw 'hostname bind failed' }

az containerapp hostname list -g $ResourceGroup -n $App -o table
Write-Host ''
Write-Host "Done: https://$Hostname"
