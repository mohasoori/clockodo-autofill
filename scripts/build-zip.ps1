# Builds the load-unpacked distribution zip next to the repo root.
# Usage:  pwsh scripts/build-zip.ps1        (or right-click → Run with PowerShell)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$zip = Join-Path $root "clockodo-autofill.zip"

$items = @(
  "manifest.json",
  "src",
  "assets",
  "docs",
  "README.md",
  "LICENSE",
  "CHANGELOG.md"
) | ForEach-Object { Join-Path $root $_ }

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $items -DestinationPath $zip
Write-Host "Built $zip (v$($manifest.version), $((Get-Item $zip).Length) bytes)"
