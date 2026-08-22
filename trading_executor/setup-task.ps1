param(
    [Parameter(Mandatory = $true)]
    [string]$PythonExe,
    [string]$TaskName = "HedgeInABox-IBKR-Paper-Executor"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$arguments = "-m trading_executor run"
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 7) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Localhost-only IBKR Paper executor" -Force
Write-Host "Installed scheduled task $TaskName. It starts at interactive logon and stores no IBKR password."
