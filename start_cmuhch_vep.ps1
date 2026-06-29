param(
  [switch]$Intranet,
  [string]$HostAddress = "127.0.0.1",
  [int]$Port = 8765,
  [string[]]$AllowedOrigins = @()
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$Python = "C:\Users\t1600\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

$env:CMUHCH_VEP_PORT = [string]$Port
if ($Intranet) {
  $env:CMUHCH_VEP_HOST = "0.0.0.0"
  if (-not $AllowedOrigins -or $AllowedOrigins.Count -eq 0) {
    $origins = @("http://$HostAddress`:$Port")
  } else {
    $origins = $AllowedOrigins
  }
  $env:CMUHCH_VEP_ALLOWED_ORIGINS = ($origins -join ",")
  Write-Host "CMUHCH VEP intranet mode"
  Write-Host "Open from intranet: http://$HostAddress`:$Port/"
  Write-Host "Allowed origins: $env:CMUHCH_VEP_ALLOWED_ORIGINS"
} else {
  $env:CMUHCH_VEP_HOST = "127.0.0.1"
  $env:CMUHCH_VEP_ALLOWED_ORIGINS = ""
  Write-Host "CMUHCH VEP local mode"
  Write-Host "Open: http://127.0.0.1:$Port/"
}

& $Python ".\run_server.py"
