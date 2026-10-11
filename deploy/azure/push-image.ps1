<#
.SYNOPSIS
    Builds the Money Monkey image from the Dockerfile and pushes it to Docker Hub, where Azure Container Apps pulls it from.
.DESCRIPTION
    Run `docker login` once first. Prints the fully qualified image name to pass to deploy.ps1 (a dated tag, so every
    push becomes a new revision; `latest` is updated too).
.EXAMPLE
    .\deploy\azure\push-image.ps1 -DockerHubUser <you>
#>
param(
    # Your Docker Hub user name (DOCKERHUB_USER in .env when not given).
    [string] $DockerHubUser,
    [string] $Repository = 'folio',
    [string] $Tag = (Get-Date -Format 'yyyyMMdd-HHmm')
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if (-not $DockerHubUser) {
    $envFile = Join-Path $root '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^DOCKERHUB_USER=(.+)$' } | Select-Object -First 1
        if ($line -match '^DOCKERHUB_USER=(.+)$') { $DockerHubUser = $Matches[1].Trim() }
    }
}
if (-not $DockerHubUser) { throw 'Give -DockerHubUser or set DOCKERHUB_USER in .env.' }
$image = "$DockerHubUser/$Repository"

docker build --platform linux/amd64 -t "${image}:$Tag" -t "${image}:latest" $root
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }
docker push "${image}:$Tag"
if ($LASTEXITCODE -ne 0) { throw 'docker push failed (run `docker login` first)' }
docker push "${image}:latest" | Out-Null

Write-Output "docker.io/${image}:$Tag"
