@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-bot.ps1" %*
