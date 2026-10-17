# "claude-chats\sessions" ki chats ko is computer ke Claude Code mein daal deta hai.
# Chalane ka tareeqa (project folder mein):
#   powershell -ExecutionPolicy Bypass -File claude-chats\import-chats.ps1

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$encoded = $projectRoot -replace '[^A-Za-z0-9]', '-'
$target = Join-Path $env:USERPROFILE ".claude\projects\$encoded"
$source = Join-Path $PSScriptRoot 'sessions'

if (-not (Test-Path $source)) {
    Write-Host "Chats nahi milin: $source (pehle export-chats.ps1 chalayein)" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item (Join-Path $source '*') -Destination $target -Recurse -Force

$count = (Get-ChildItem $source -Filter '*.jsonl').Count
Write-Host "$count chat(s) import ho gayi: $target" -ForegroundColor Green
Write-Host "Ab VS Code mein Claude Code kholein -> past conversations, ya terminal mein: claude --resume"
