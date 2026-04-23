param(
  [Parameter(Position = 0)]
  [ValidateSet(
    "site",
    "bot",
    "status-site",
    "status-bot",
    "logs-site",
    "logs-bot",
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
$botApp = "ai-hedge-telegram-bot"
$siteConfig = Join-Path $root "fly.site.toml"
$botConfig = Join-Path $root "fly.toml"

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
  Write-Host "  bot          Deploy telegram bot app (ai-hedge-telegram-bot)"
  Write-Host "  status-site  Show website app status"
  Write-Host "  status-bot   Show bot app status"
  Write-Host "  logs-site    Tail website logs"
  Write-Host "  logs-bot     Tail bot logs"
  Write-Host ""
  Write-Host "Options:"
  Write-Host "  -NoDepot     Deploy with --depot=false"
  Write-Host "  -NoRemote    Omit --remote-only"
  Write-Host ""
  Write-Host "Examples:"
  Write-Host "  .\deploy_fly.ps1 site"
  Write-Host "  .\deploy_fly.ps1 bot -NoDepot"
  Write-Host "  .\deploy_fly.ps1 status-site"
  Write-Host ""
}

Assert-FlyCli
& $fly auth whoami | Out-Host

switch ($Action) {
  "site" {
    Invoke-Deploy -app $siteApp -configPath $siteConfig
    break
  }
  "bot" {
    Invoke-Deploy -app $botApp -configPath $botConfig
    break
  }
  "status-site" {
    & $fly status --app $siteApp | Out-Host
    break
  }
  "status-bot" {
    & $fly status --app $botApp | Out-Host
    break
  }
  "logs-site" {
    & $fly logs --app $siteApp | Out-Host
    break
  }
  "logs-bot" {
    & $fly logs --app $botApp | Out-Host
    break
  }
  default {
    Show-Help
    break
  }
}
