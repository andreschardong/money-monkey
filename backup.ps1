# Dumps the Folio database to backups\folio-<timestamp>.sql. Run from this folder with the stack up.
#   .\backup.ps1
# Restore a dump (replaces everything in the database):
#   Get-Content backups\folio-2026-10-10-1405.sql | docker compose exec -T db psql -U folio -d folio
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force backups | Out-Null
$file = "backups\folio-$(Get-Date -Format 'yyyy-MM-dd-HHmm').sql"
docker compose exec -T db pg_dump -U folio --clean --if-exists folio | Set-Content -Encoding utf8 $file
"Saved $((Get-Item $file).FullName) ($([math]::Round((Get-Item $file).Length / 1KB)) KB)"
