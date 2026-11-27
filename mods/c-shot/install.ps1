# 把 c-shot 裝進 herdr，並把 Ctrl+Alt+P 設成開啟標記畫面。
# 用法：powershell -ExecutionPolicy Bypass -File mods\c-shot\install.ps1
$ErrorActionPreference = 'Stop'

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }
$target = Join-Path $appHome 'mods\c-shot'
$keysPath = Join-Path $appHome 'keys.json'
$binding = '"ctrl-alt-p": "mod.open:c-shot"'

Write-Host ''
Write-Host 'c-shot：標記位置' -ForegroundColor Cyan
Write-Host "安裝到：$target"
Write-Host ''

New-Item -ItemType Directory -Force $target | Out-Null
foreach ($file in 'main.js', 'mod.json', 'jsconfig.json') {
    Copy-Item -Force (Join-Path $PSScriptRoot $file) (Join-Path $target $file)
}

$utf8 = New-Object Text.UTF8Encoding $false
if (-not (Test-Path $keysPath)) {
    Write-Host "找不到 $keysPath。請在 keys.json 的 global 加上：$binding" -ForegroundColor Yellow
} else {
    $text = [IO.File]::ReadAllText($keysPath, $utf8)
    if ($text -match '"ctrl-alt-p"\s*:\s*"mod\.open:c-shot"') {
        Write-Host 'Ctrl+Alt+P 已經設定好了。'
    } elseif ($text -match '"ctrl-alt-p"\s*:') {
        Write-Host 'Ctrl+Alt+P 已經有別的用途，我沒有改。要用的話，請自己改 keys.json。' -ForegroundColor Yellow
    } elseif ($text -match '"global"\s*:\s*\{') {
        $text = ([regex]'"global"\s*:\s*\{').Replace($text, "`$0`r`n    $binding,", 1)
        [IO.File]::WriteAllText($keysPath, $text, $utf8)
        Write-Host '已把 Ctrl+Alt+P 加進 keys.json。'
    } else {
        Write-Host "keys.json 沒有 global 區段。請自己加上：$binding" -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
Write-Host '按 Ctrl+Alt+P，或從指令面板找「標記位置（c-shot）」。'
