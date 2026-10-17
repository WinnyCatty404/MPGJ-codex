$ErrorActionPreference = 'Stop'

# 兼容旧入口：统一转到带数据库身份保护的开发启动器。
& (Join-Path $PSScriptRoot 'dev-start.ps1') -ProjectRoot $PSScriptRoot
exit $LASTEXITCODE

