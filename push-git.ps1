param(
  [string]$Message = "chore: update",
  [string]$Remote = "origin",
  [string]$Branch = ""
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed"
  }
}

Invoke-Git @("rev-parse", "--is-inside-work-tree")

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not detect current branch."
  }
}

if ($Branch -eq "HEAD") {
  throw "Detached HEAD detected. Checkout a branch before pushing."
}

Write-Output "Branch: $Branch"
Write-Output "Remote: $Remote"

Invoke-Git @("add", "-A")

$stagedFiles = & git diff --cached --name-only
if ($LASTEXITCODE -ne 0) {
  throw "Failed to inspect staged changes."
}

if ([string]::IsNullOrWhiteSpace(($stagedFiles -join ""))) {
  Write-Output "No local changes to commit."
} else {
  Invoke-Git @("commit", "-m", $Message)
}

& git rev-parse --abbrev-ref --symbolic-full-name "@{u}" *> $null
$hasUpstream = ($LASTEXITCODE -eq 0)

if ($hasUpstream) {
  Invoke-Git @("push")
} else {
  Invoke-Git @("push", "-u", $Remote, $Branch)
}

Write-Output "Done."
