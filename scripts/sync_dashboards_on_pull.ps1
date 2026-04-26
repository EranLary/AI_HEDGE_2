param(
  [string]$App = "hedge-in-a-box-site"
)

$ErrorActionPreference = "Continue"

$targetScript = Join-Path $PSScriptRoot "sync_latest_dashboards.ps1"
if (-not (Test-Path $targetScript)) {
  Write-Warning "Dashboard sync script is missing: $targetScript"
  exit 0
}

try {
  & $targetScript -App $App -Tickers @("NICE", "ITRN", "STRS.TA")
} catch {
  Write-Warning ("Dashboard auto-sync failed: " + $_.Exception.Message)
}

exit 0
