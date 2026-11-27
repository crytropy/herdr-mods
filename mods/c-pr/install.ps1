# 把 c-pr 裝進 herdr，並設定面板要顯示哪些 PR。
# 用法：powershell -ExecutionPolicy Bypass -File mods\c-pr\install.ps1
$ErrorActionPreference = 'Stop'

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
$target = Join-Path $appHome 'mods\c-pr'
$configPath = Join-Path $target 'config.json'

Write-Host ''
Write-Host 'c-pr：GitHub PR 面板' -ForegroundColor Cyan
Write-Host "安裝到：$target"
Write-Host ''

$current = $null
if (Test-Path $configPath) {
    try { $current = (Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json).scope } catch { $current = $null }
}

Write-Host '面板要顯示哪些 PR？'
Write-Host '  1. 所有 repo 的 PR'
Write-Host '  2. 指定組織的 PR'
Write-Host '  3. 自行指定（GitHub 搜尋條件）'
if ($null -ne $current) {
    $shown = if ($current) { $current } else { '所有 repo' }
    Write-Host "  0. 保留目前的設定（$shown）"
}

$scope = $null
while ($null -eq $scope) {
    $choice = (Read-Host '請選擇').Trim()
    switch ($choice) {
        '0' { if ($null -ne $current) { $scope = $current } }
        '1' { $scope = '' }
        '2' {
            $orgs = (Read-Host '組織名稱（多個用空白隔開，例如 my-org other-org）').Trim()
            if ($orgs) { $scope = (($orgs -split '\s+') | ForEach-Object { "org:$_" }) -join ' ' }
        }
        '3' {
            Write-Host '  例：user:octocat repo:owner/name label:bug'
            $raw = (Read-Host 'GitHub 搜尋條件').Trim()
            if ($raw) { $scope = $raw }
        }
    }
    if ($null -eq $scope) { Write-Host '請重新選擇。' -ForegroundColor Yellow }
}

New-Item -ItemType Directory -Force $target | Out-Null
foreach ($file in 'main.js', 'mod.json', 'jsconfig.json') {
    Copy-Item -Force (Join-Path $PSScriptRoot $file) (Join-Path $target $file)
}

$json = ConvertTo-Json @{ scope = $scope }
[IO.File]::WriteAllText($configPath, $json, (New-Object Text.UTF8Encoding $false))

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
if ($scope) { Write-Host "搜尋範圍：$scope" } else { Write-Host '搜尋範圍：所有 repo' }
Write-Host '面板會在 30 秒內更新，也可以按面板右上角的「重新整理」。'
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host '找不到 gh。請先安裝 GitHub CLI 並執行 gh auth login。' -ForegroundColor Yellow
}
