[CmdletBinding()]
param(
    [ValidateSet("backend", "frontend", "obs", "db", "all")]
    [string]$Scope = "all",
    [switch]$IncludeLiveDb
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param(
        [string]$Label,
        [scriptblock]$Command
    )

    Write-Host "`n==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Test-Backend {
    Invoke-Checked "Python tests" {
        python -m pytest -q --basetemp=.tmp/pytest
    }
}

function Test-Frontend {
    $changed = @(
        git diff --name-only --diff-filter=ACMR "origin/main...HEAD"
        git diff --name-only --diff-filter=ACMR
    ) | Where-Object {
        $_ -match '^frontend/.+\.(ts|tsx|js|jsx|mjs|cjs)$'
    } | Sort-Object -Unique | ForEach-Object {
        $_.Substring("frontend/".Length)
    }

    Push-Location (Join-Path $repoRoot "frontend")
    try {
        if ($changed.Count -gt 0) {
            Invoke-Checked "Frontend lint (changed files)" { npm.cmd exec -- eslint $changed }
        }
        else {
            Write-Host "`n==> Frontend lint (no changed JS/TS files)"
        }
        Invoke-Checked "Frontend middleware tests" { npm.cmd run test:middleware }
        Invoke-Checked "Frontend report tests" { npm.cmd run test:reports }
        Invoke-Checked "Frontend portfolio tests" { npm.cmd run test:portfolio }
        Invoke-Checked "Frontend production build" { npm.cmd run build }
    }
    finally {
        Pop-Location
    }
}

function Test-Obs {
    $changed = @(
        git diff --name-only --diff-filter=ACMR "origin/main...HEAD"
        git diff --name-only --diff-filter=ACMR
    ) | Where-Object {
        $_ -match '^frontend-obs/.+\.(ts|tsx|js|jsx|mjs|cjs)$'
    } | Sort-Object -Unique | ForEach-Object {
        $_.Substring("frontend-obs/".Length)
    }

    Push-Location (Join-Path $repoRoot "frontend-obs")
    try {
        if ($changed.Count -gt 0) {
            Invoke-Checked "Observability lint (changed files)" { npm.cmd exec -- eslint $changed }
        }
        else {
            Write-Host "`n==> Observability lint (no changed JS/TS files)"
        }
        Invoke-Checked "Observability production build" { npm.cmd run build }
    }
    finally {
        Pop-Location
    }
}

function Test-Database {
    Invoke-Checked "Pending migration check" { python scripts/migrate.py --dry-run }
    Invoke-Checked "Read-only database audit" { python scripts/db_audit.py --strict }
}

Push-Location $repoRoot
try {
    switch ($Scope) {
        "backend" { Test-Backend }
        "frontend" { Test-Frontend }
        "obs" { Test-Obs }
        "db" { Test-Database }
        "all" {
            Test-Backend
            Test-Frontend
            Test-Obs
            if ($IncludeLiveDb) {
                Test-Database
            }
        }
    }
    Invoke-Checked "Whitespace check" { git diff --check }
    Write-Host "`nVerification completed successfully."
}
finally {
    Pop-Location
}
