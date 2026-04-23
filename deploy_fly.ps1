param(
  [string]$AppName = "ai-hedge-telegram-bot",
  [string]$Region = "iad",
  [int]$VolumeSizeGb = 20,
  [string]$TelegramBotToken = "",
  [string]$DeepseekApiKey = "",
  [string]$ValuationIterations = "",
  [string]$LlmWorkers = ""
)

$ErrorActionPreference = "Stop"
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"

if (-not (Test-Path $fly)) {
  throw "flyctl not found at $fly. Install Fly CLI first."
}

Write-Host "Using flyctl: $fly"

# Ensure logged in
& $fly auth whoami | Out-Host

# Update app name in fly.toml to match param
$flyToml = Join-Path $PSScriptRoot "fly.toml"
if (-not (Test-Path $flyToml)) {
  throw "fly.toml not found in project root."
}

$content = Get-Content $flyToml -Raw
$content = [regex]::Replace($content, '(?m)^app\s*=\s*".*"$', "app = `"$AppName`"")
Set-Content -Path $flyToml -Value $content -Encoding UTF8
Write-Host "Updated fly.toml app name to: $AppName"

# Create app if missing
$appExists = $false
try {
  & $fly status --app $AppName | Out-Null
  $appExists = $true
} catch {
  $appExists = $false
}

if (-not $appExists) {
  & $fly apps create $AppName | Out-Host
}

# Create volume if missing
$volumes = & $fly volumes list --app $AppName 2>$null
if ($volumes -notmatch "bot_data") {
  & $fly volumes create bot_data --size $VolumeSizeGb --region $Region --app $AppName | Out-Host
}

# Required secrets
if ([string]::IsNullOrWhiteSpace($TelegramBotToken) -or [string]::IsNullOrWhiteSpace($DeepseekApiKey)) {
  throw "Provide -TelegramBotToken and -DeepseekApiKey."
}
& $fly secrets set TELEGRAM_BOT_TOKEN="$TelegramBotToken" DEEPSEEK_API_KEY="$DeepseekApiKey" --app $AppName | Out-Host

# Optional tuning
$optional = @{}
if (-not [string]::IsNullOrWhiteSpace($ValuationIterations)) { $optional["VALUATION_ITERATIONS"] = $ValuationIterations }
if (-not [string]::IsNullOrWhiteSpace($LlmWorkers)) { $optional["LLM_WORKERS"] = $LlmWorkers }
if ($optional.Count -gt 0) {
  $pairs = $optional.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
  & $fly secrets set @pairs --app $AppName | Out-Host
}

# Deploy + ensure one always-on machine.
# Force Fly remote builder and disable Depot because some networks block api.depot.dev.
& $fly deploy --app $AppName --remote-only --depot=false | Out-Host
& $fly scale count 1 --app $AppName | Out-Host

Write-Host "Deployment complete."
Write-Host "Tail logs with: $fly logs --app $AppName"
