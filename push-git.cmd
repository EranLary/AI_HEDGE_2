@echo off
setlocal

if "%~1"=="" (
  powershell -ExecutionPolicy Bypass -File "%~dp0push-git.ps1"
) else (
  powershell -ExecutionPolicy Bypass -File "%~dp0push-git.ps1" -Message "%*"
)
