@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-site.ps1" %*
