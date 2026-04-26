param(
  [string]$App = "hedge-in-a-box-site",
  [string[]]$Tickers = @("NICE", "ITRN", "STRS.TA"),
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $repoRoot "outputs"
}

$fly = Join-Path $env:USERPROFILE ".fly\bin\flyctl.exe"
if (-not (Test-Path $fly)) {
  throw "flyctl not found at $fly"
}

if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

function Get-LatestDashboardEntry([string]$Ticker, [string[]]$Lines) {
  $escaped = [Regex]::Escape($Ticker)
  $regex = "/_site_runs/(${escaped}_(\d+)_([^/]+))/${escaped}_dashboard\.json$"
  $hits = @()
  foreach ($line in $Lines) {
    $m = [Regex]::Match($line, $regex)
    if (-not $m.Success) { continue }
    $hits += [pscustomobject]@{
      RunDir = $m.Groups[1].Value
      Ts = [int64]$m.Groups[2].Value
      RemotePath = $line
      Ticker = $Ticker
    }
  }
  if (-not $hits.Count) { return $null }
  return $hits | Sort-Object Ts -Descending | Select-Object -First 1
}

Write-Host "Using flyctl: $fly"
Write-Host "Sync source app: $App"
Write-Host "Local output root: $OutputRoot"
$findLines = & $fly ssh sftp find /data/outputs/_site_runs --app $App
if ($LASTEXITCODE -ne 0) {
  throw "Failed to scan /data/outputs/_site_runs on Fly app '$App'."
}

$downloaded = @()
$missing = @()

foreach ($ticker in $Tickers) {
  $tickerUpper = [string]$ticker
  $tickerUpper = $tickerUpper.ToUpper().Trim()
  if (-not $tickerUpper) { continue }

  $entry = Get-LatestDashboardEntry -Ticker $tickerUpper -Lines $findLines
  if (-not $entry) {
    Write-Warning "No dashboard json found on Fly for ticker '$tickerUpper'."
    $missing += $tickerUpper
    continue
  }

  $localRunDir = Join-Path $OutputRoot ("_site_runs\" + $entry.RunDir)
  if (-not (Test-Path $localRunDir)) {
    New-Item -ItemType Directory -Path $localRunDir -Force | Out-Null
  }

  $localDashboard = Join-Path $localRunDir ("{0}_dashboard.json" -f $tickerUpper)
  if (Test-Path $localDashboard) {
    Remove-Item -LiteralPath $localDashboard -Force
  }

  & $fly ssh sftp get $entry.RemotePath $localDashboard --app $App
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed downloading $($entry.RemotePath)"
    $missing += $tickerUpper
    continue
  }

  $downloaded += [pscustomobject]@{
    ticker = $tickerUpper
    run_dir = $entry.RunDir
    remote = $entry.RemotePath
    local = $localDashboard
  }
}

Write-Host ""
Write-Host "Dashboard sync summary"
if ($downloaded.Count) {
  foreach ($row in $downloaded) {
    Write-Host ("  OK   {0}  ->  {1}" -f $row.ticker, $row.local)
  }
}
if ($missing.Count) {
  foreach ($t in $missing) {
    Write-Host ("  MISS {0}" -f $t)
  }
}
