<#
.SYNOPSIS
    Stores the two secrets Money Monkey needs on Azure (the Neon connection string and the Gmail app password) without
    them passing through chat, logs or the portal. Run it in a normal PowerShell window; the values are typed or
    pasted invisibly. Leave one empty to keep its current value.
.EXAMPLE
    cd C:\repos\folio
    .\deploy\azure\set-secrets.ps1
#>
param(
    [string] $ResourceGroup = 'folio',
    [string] $App = 'folio'
)

$ErrorActionPreference = 'Stop'

function Read-Secret([string] $Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
}

$db = Read-Secret 'Neon connection string (postgresql://...), or Enter to skip'
$pw = (Read-Secret 'Gmail app password, or Enter to skip') -replace '\s', ''

if ($db -and -not $db.StartsWith('postgres')) { throw 'That does not look like a Neon connection string; it starts with postgresql://' }
if ($pw -and $pw.Length -ne 16) { Write-Warning "A Gmail app password has 16 characters; this one has $($pw.Length). Saving it anyway." }

$secrets = @()
if ($db) { $secrets += "database-url=$db" }
if ($pw) { $secrets += "email-password=$pw" }
if (-not $secrets) { Write-Host 'Nothing entered; nothing changed.'; return }

Write-Host "Saving $($secrets.Count) secret(s) on container app $App..."
az containerapp secret set -g $ResourceGroup -n $App --secrets @secrets --only-show-errors -o none
if ($LASTEXITCODE -ne 0) { throw 'az containerapp secret set failed' }

az containerapp secret list -g $ResourceGroup -n $App --query "[].name" -o tsv
Write-Host 'Saved. Next: start a new revision (ask Claude, or rerun deploy.ps1 with the same image).'
