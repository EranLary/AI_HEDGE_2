param(
  [switch]$NoDepot,
  [switch]$NoRemote
)

$script = Join-Path $PSScriptRoot "deploy_fly.ps1"
& $script obs @PSBoundParameters
