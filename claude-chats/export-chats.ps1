# Is PC ki Claude Code chats ko project ke "claude-chats" folder mein copy karta hai.
# Chalane ka tareeqa (project folder mein):
#   powershell -ExecutionPolicy Bypass -File claude-chats\export-chats.ps1

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$encoded = $projectRoot -replace '[^A-Za-z0-9]', '-'
$source = Join-Path $env:USERPROFILE ".claude\projects\$encoded"

if (-not (Test-Path $source)) {
    Write-Host "Chats ka folder nahi mila: $source" -ForegroundColor Red
    exit 1
}

$dest = Join-Path $PSScriptRoot 'sessions'
New-Item -ItemType Directory -Force $dest | Out-Null

# .jsonl = chat files, GUID wale folders = un chats ka extra data
Get-ChildItem $source -Filter '*.jsonl' | Copy-Item -Destination $dest -Force
Get-ChildItem $source -Directory |
    Where-Object { $_.Name -match '^[0-9a-f]{8}-[0-9a-f]{4}-' } |
    ForEach-Object { Copy-Item $_.FullName -Destination $dest -Recurse -Force }

$count = (Get-ChildItem $dest -Filter '*.jsonl').Count
Write-Host "$count chat(s) copy ho gayi: $dest" -ForegroundColor Green
