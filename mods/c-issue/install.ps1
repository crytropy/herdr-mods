# 把 c-issue 裝進 herdr，並設定面板要切換的三個 repo。
# 用法：powershell -ExecutionPolicy Bypass -File mods\c-issue\install.ps1
$ErrorActionPreference = 'Stop'

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
$target = Join-Path $appHome 'mods\c-issue'
$configPath = Join-Path $target 'config.json'

Write-Host ''
Write-Host 'c-issue：GitHub Issue 面板' -ForegroundColor Cyan
Write-Host "安裝到：$target"
Write-Host ''

$current = @()
if (Test-Path $configPath) {
    try { $current = @((Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json).repos) } catch { $current = @() }
}

Write-Host '請輸入最多三個 repo，格式 owner/name，例如 cli/cli。'
Write-Host '直接按 Enter：保留目前的值；沒有目前的值就略過。'

$repos = @()
for ($i = 0; $i -lt 3; $i++) {
    $old = if ($i -lt $current.Count) { [string]$current[$i] } else { '' }
    $prompt = if ($old) { "repo $($i + 1)（目前：$old）" } else { "repo $($i + 1)" }
    while ($true) {
        $raw = (Read-Host $prompt).Trim()
        if (-not $raw) { $raw = $old }
        if (-not $raw -or $raw -match '^[^/\s]+/[^/\s]+$') { break }
        Write-Host '格式不對，要像 owner/name。' -ForegroundColor Yellow
    }
    if ($raw) { $repos += $raw }
}

if ($repos.Count -eq 0) {
    Write-Host '至少要一個 repo。沒有安裝。' -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Force $target | Out-Null
foreach ($file in 'main.js', 'mod.json', 'jsconfig.json') {
    Copy-Item -Force (Join-Path $PSScriptRoot $file) (Join-Path $target $file)
}

$json = ConvertTo-Json @{ repos = $repos }
[IO.File]::WriteAllText($configPath, $json, (New-Object Text.UTF8Encoding $false))

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
Write-Host "repo：$($repos -join '、')"
Write-Host '面板會在 30 秒內更新，也可以按面板右上角的「重新整理」。'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host '找不到 gh。請先安裝 GitHub CLI 並執行 gh auth login。' -ForegroundColor Yellow
}
