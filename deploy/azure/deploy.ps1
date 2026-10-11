<#
.SYNOPSIS
    Creates or updates Money Monkey on Azure Container Apps: resource group, environment, the app, its settings and the
    two secrets you fill in yourself. Safe to run again; a rerun updates the image and settings.
.DESCRIPTION
    Free-grant friendly: consumption plan, scales to zero, 0.25 vCPU / 0.5 GiB, one replica at most. Needs
    `az login` on the subscription to use and an image already on Docker Hub (push-image.ps1).

    After it runs, put the real values into the two secrets in the Azure portal (Container App → Security → Secrets) or with:
        az containerapp secret set -g folio -n folio --secrets "database-url=postgresql://..." "email-password=xxxx xxxx xxxx xxxx"
    then start a new revision so the app picks them up:
        .\deploy\azure\deploy.ps1 -Image <same image>   (or: az containerapp update -g folio -n folio --set-env-vars DEPLOYED_AT=now)

    The script ends by printing the two DNS records to add in Cloudflare (DNS only, proxy off); bind-domain.ps1
    then attaches the host name with a free managed certificate.
.EXAMPLE
    .\deploy\azure\deploy.ps1 -Image docker.io/<you>/folio:<tag>
    .\deploy\azure\deploy.ps1 -Image docker.io/<you>/folio:<tag> -AllowedEmails 'you@gmail.com,partner@example.com'
#>
param(
    [Parameter(Mandatory)] [string] $Image,
    [string] $ResourceGroup = 'folio',
    [string] $Location = 'canadacentral',
    [string] $Environment = 'folio-env',
    [string] $App = 'folio',
    # The public host name (FOLIO_HOSTNAME in .env when not given).
    [string] $Hostname,
    # Who may sign in. Leave it out to keep the list already set on the app (or, for a new app, the one in .env).
    [string] $AllowedEmails,
    # The Gmail address that sends the sign-in emails (FOLIO_GMAIL_USER in .env when not given).
    [string] $GmailUser,
    # Optional backup quotes (ALPHAVANTAGE_API_KEY in .env when not given).
    [string] $AlphaVantageKey = ''
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

# Settings that differ per person live in .env (ignored by git), the same file docker compose reads.
$dotEnv = @{}
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $dotEnv[$Matches[1]] = $Matches[2] }
    }
}
if (-not $Hostname) { $Hostname = $dotEnv['FOLIO_HOSTNAME'] }
if (-not $Hostname) { throw 'Give -Hostname (e.g. moneymonkey.example.com) or set FOLIO_HOSTNAME in .env.' }
if (-not $GmailUser) { $GmailUser = $dotEnv['FOLIO_GMAIL_USER'] }
if (-not $GmailUser) { throw 'Give -GmailUser (the Gmail address that sends sign-in emails) or set FOLIO_GMAIL_USER in .env.' }
if (-not $AlphaVantageKey) { $AlphaVantageKey = $dotEnv['ALPHAVANTAGE_API_KEY'] }

# The allowed list is data you edit, not deployment configuration: a publish must not reset it.
if (-not $PSBoundParameters.ContainsKey('AllowedEmails')) {
    $AllowedEmails = az containerapp show -g $ResourceGroup -n $App --query "properties.template.containers[0].env[?name=='Auth__AllowedEmails'].value | [0]" -o tsv 2>$null
    if (-not $AllowedEmails) { $AllowedEmails = $dotEnv['FOLIO_ALLOWED_EMAILS'] }
    if (-not $AllowedEmails) { throw 'Give -AllowedEmails (comma-separated; an empty string lets anyone sign up) or set FOLIO_ALLOWED_EMAILS in .env.' }
}
Write-Host "Allowed emails: $AllowedEmails"

function Assert-Az([string] $Step) {
    if ($LASTEXITCODE -ne 0) { throw "az $Step failed (exit code $LASTEXITCODE)" }
}

Write-Host "Subscription: $(az account show --query name -o tsv)"
az extension add --name containerapp --upgrade --only-show-errors
az provider register --namespace Microsoft.App --wait --only-show-errors
Assert-Az 'provider register Microsoft.App'
az provider register --namespace Microsoft.OperationalInsights --wait --only-show-errors
Assert-Az 'provider register Microsoft.OperationalInsights'

Write-Host "Resource group $ResourceGroup in $Location"
az group create --name $ResourceGroup --location $Location --only-show-errors -o none
Assert-Az 'group create'

$envExists = az containerapp env show -g $ResourceGroup -n $Environment --query name -o tsv 2>$null
if (-not $envExists) {
    Write-Host "Container Apps environment $Environment (consumption; a Log Analytics workspace is created with it)"
    az containerapp env create -g $ResourceGroup -n $Environment --location $Location --only-show-errors -o none
    Assert-Az 'containerapp env create'
}

# Plain settings. Secrets are referenced, never written here: database-url and email-password start as placeholders
# that you replace; the Alpha Vantage key is taken from .env when present.
$settings = @(
    "ConnectionStrings__Folio=secretref:database-url",
    "DATABASE_URL=secretref:database-url",
    "Auth__PublicUrl=https://$Hostname",
    "Auth__PasskeyDomain=$Hostname",
    "Auth__BehindProxy=true",
    "Auth__AllowedEmails=$AllowedEmails",
    "Auth__InboxUrl=",
    "Email__Host=smtp.gmail.com",
    "Email__Port=587",
    "Email__Security=StartTls",
    "Email__User=$GmailUser",
    "Email__Password=secretref:email-password",
    "Email__From=Money Monkey <$GmailUser>",
    "MarketData__AlphaVantageApiKey=secretref:alphavantage-key",
    "LogFile__Path=",
    "TZ=America/Toronto",
    "DEPLOYED_AT=$(Get-Date -Format o)"
)
$alphaSecret = if ($AlphaVantageKey) { $AlphaVantageKey } else { 'none' }

$appExists = az containerapp show -g $ResourceGroup -n $App --query name -o tsv 2>$null
if (-not $appExists) {
    Write-Host "Container app $App from $Image"
    az containerapp create -g $ResourceGroup -n $App --environment $Environment --image $Image `
        --ingress external --target-port 8080 --transport auto `
        --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi `
        --secrets "database-url=replace-me" "email-password=replace-me" "alphavantage-key=$alphaSecret" `
        --env-vars @settings --only-show-errors -o none
    Assert-Az 'containerapp create'
} else {
    Write-Host "Updating $App to $Image"
    if ($AlphaVantageKey) {
        az containerapp secret set -g $ResourceGroup -n $App --secrets "alphavantage-key=$AlphaVantageKey" --only-show-errors -o none
        Assert-Az 'containerapp secret set'
    }
    az containerapp update -g $ResourceGroup -n $App --image $Image `
        --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi `
        --set-env-vars @settings --only-show-errors -o none
    Assert-Az 'containerapp update'
}

$fqdn = az containerapp show -g $ResourceGroup -n $App --query properties.configuration.ingress.fqdn -o tsv
$verification = az containerapp env show -g $ResourceGroup -n $Environment --query properties.customDomainConfiguration.customDomainVerificationId -o tsv
$label = $Hostname.Split('.')[0]
$domain = $Hostname.Substring($label.Length + 1)

Write-Host ''
Write-Host "Money Monkey is at https://$fqdn (temporary address; sign in only once the custom domain is bound)."
Write-Host ''
Write-Host "DNS records to add at your DNS provider for $domain (with Cloudflare: DNS only, proxy off):"
Write-Host "  CNAME  $label          ->  $fqdn"
Write-Host "  TXT    asuid.$label    ->  $verification"
Write-Host ''
Write-Host 'Then: .\deploy\azure\bind-domain.ps1'
