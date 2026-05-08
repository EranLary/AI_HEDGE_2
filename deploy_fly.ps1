param(
  [Parameter(Position = 0)]
  [ValidateSet(
    "site",
    "status-site",
    "logs-site",
    "obs",
    "status-obs",
    "logs-obs",
    "help"
  )]
  [string]$Action = "help",
  [switch]$NoDepot,
  [switch]$NoRemote
)

$ErrorActionPreference = "Stop"
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"
$root = $PSScriptRoot

$siteApp = "hedge-in-a-box-site"
$siteConfig = Join-Path $root "fly.site.toml"
$obsApp = "hedge-in-a-box-obs"
$obsConfig = Join-Path $root "fly.obs.toml"

function Assert-FlyCli {
  if (-not (Test-Path $fly)) {
    throw "flyctl not found at $fly. Install Fly CLI first."
  }
  Write-Host "Using flyctl: $fly"
}

function Assert-Config([string]$configPath) {
  if (-not (Test-Path $configPath)) {
    throw "Config file not found: $configPath"
  }
}

function Invoke-Deploy([string]$app, [string]$configPath) {
  Assert-Config $configPath

  $args = @("deploy", "--app", $app, "--config", $configPath)
  if (-not $NoRemote) {
    $args += "--remote-only"
  }
  if ($NoDepot) {
    $args += "--depot=false"
  }

  Write-Host "Deploying app '$app' with config '$configPath'..."
  & $fly @args | Out-Host
  & $fly status --app $app | Out-Host
}

function Show-Help {
  Write-Host ""
  Write-Host "Fly Deploy Helper"
  Write-Host "Usage: .\deploy_fly.ps1 <action> [options]"
  Write-Host ""
  Write-Host "Actions:"
  Write-Host "  site         Deploy website app (hedge-in-a-box-site)"
  Write-Host "  status-site  Show website app status"
  Write-Host "  logs-site    Tail website logs"
  Write-Host "  obs          Deploy observability app (hedge-in-a-box-obs)"
  Write-Host "  status-obs   Show obs app status"
  Write-Host "  logs-obs     Tail obs app logs"
  Write-Host ""
  Write-Host "Options:"
  Write-Host "  -NoDepot     Deploy with --depot=false"
  Write-Host "  -NoRemote    Omit --remote-only"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  .\deploy_fly.ps1 site"
  Write-Host "  .\deploy_fly.ps1 obs"
  Write-Host "  .\deploy_fly.ps1 logs-obs"
  Write-Host ""
}

Assert-FlyCli
& $fly auth whoami | Out-Host

switch ($Action) {
  "site" {
    Invoke-Deploy -app $siteApp -configPath $siteConfig
    break
  }
  "status-site" {
    & $fly status --app $siteApp | Out-Host
    break
  }
  "logs-site" {
    & $fly logs --app $siteApp | Out-Host
    break
  }
  "obs" {
    Invoke-Deploy -app $obsApp -configPath $obsConfig
    break
  }
  "status-obs" {
    & $fly status --app $obsApp | Out-Host
    break
  }
  "logs-obs" {
    & $fly logs --app $obsApp | Out-Host
    break
  }
  default {
    Show-Help
    break
  }
}
