$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$env:OCTOP_HOME = Join-Path $repo '.sourcing-runtime'
$env:PYTHONUTF8 = '1'
$listener = Get-NetTCPConnection -LocalPort 8088 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host '8088 已有服务运行，请访问 http://localhost:8088/'
    exit 0
}
Start-Process -FilePath (Join-Path $repo '.venv/Scripts/octop.exe') -ArgumentList 'run' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:OCTOP_HOME 'server.log') -RedirectStandardError (Join-Path $env:OCTOP_HOME 'server-error.log')
Write-Host '选品工作台启动中：http://localhost:8088/'
Write-Host ('登录信息：' + (Join-Path $env:OCTOP_HOME 'login.txt'))
