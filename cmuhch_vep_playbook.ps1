param(
  [ValidateSet(
    "Status",
    "StartWebsite",
    "OpenWebsite",
    "SetupWslVep",
    "DownloadVepData",
    "TestVep",
    "Debug",
    "StopWebsite",
    "AllLocal"
  )]
  [string]$Action = "Status",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot "vep_config.json"
$Python = "C:\Users\t1600\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$WebsiteUrl = "http://127.0.0.1:$Port/"
$ApiBase = "http://127.0.0.1:$Port"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Cannot find vep_config.json at $ConfigPath"
  }
  return Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-WebsiteProcessId {
  $rows = netstat -ano | Select-String ":$Port\s+.*LISTENING"
  if (-not $rows) { return $null }
  $line = $rows[0].Line.Trim()
  $parts = $line -split "\s+"
  return [int]$parts[-1]
}

function Invoke-Status {
  $config = Read-Config
  Write-Step "Project"
  Write-Host "Root: $ProjectRoot"
  Write-Host "Website: $WebsiteUrl"
  Write-Host "Runner: $($config.vep_runner)"
  Write-Host "WSL distro: $($config.wsl_distro)"
  Write-Host "Data root: $($config.host_data_dir)"

  Write-Step "Local tools"
  Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
  Write-Host "Python: $Python"
  Write-Host "Python exists: $(Test-Path -LiteralPath $Python)"
  Write-Host "WSL exists: $(Test-CommandExists wsl)"
  Write-Host "Docker exists: $(Test-CommandExists docker)"

  Write-Step "Folders"
  @(
    $config.host_data_dir,
    (Join-Path $config.host_data_dir "cache"),
    (Join-Path $config.host_data_dir "fasta"),
    (Join-Path $config.host_data_dir "plugins")
  ) | ForEach-Object {
    Write-Host "[$(Test-Path -LiteralPath $_)] $_"
  }

  Write-Step "Website API"
  try {
    $status = Invoke-RestMethod -Uri "$ApiBase/api/vep/status" -TimeoutSec 20
    Write-Host "API ok: $($status.ok)"
    foreach ($check in $status.checks) {
      $mark = if ($check.ok) { "OK" } else { "FAIL" }
      Write-Host "[$mark] $($check.name): $($check.detail)"
    }
  } catch {
    Write-Host "API not reachable: $($_.Exception.Message)"
  }
}

function Start-Website {
  $pid = Get-WebsiteProcessId
  if ($pid) {
    Write-Host "Website already running at $WebsiteUrl (PID $pid)"
    return
  }
  if (-not (Test-Path -LiteralPath $Python)) {
    throw "Bundled Python not found: $Python"
  }
  Start-Process powershell.exe `
    -WorkingDirectory $ProjectRoot `
    -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "start_cmuhch_vep.ps1" `
    -WindowStyle Hidden
  Start-Sleep -Seconds 2
  Write-Host "Website started: $WebsiteUrl"
}

function Stop-Website {
  $pid = Get-WebsiteProcessId
  if (-not $pid) {
    Write-Host "Website is not running on port $Port"
    return
  }
  Stop-Process -Id $pid -Force
  Write-Host "Stopped website process PID $pid"
}

function Open-Website {
  Start-Website
  Start-Process $WebsiteUrl
}

function Setup-WslVep {
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "setup_vep_wsl_source.ps1")
}

function Download-VepData {
  & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "setup_vep_wsl_source.ps1") -DownloadVepData
}

function Test-Vep {
  Start-Website
  $body = @{
    inputs = @("ENST00000275493.6:c.2240_2257delTAAGAGAAGCAACATCTC")
  } | ConvertTo-Json -Depth 5
  $result = Invoke-RestMethod -Uri "$ApiBase/api/vep/run" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180
  Write-Host "VEP ok: $($result.ok)"
  Write-Host "Job: $($result.job_id)"
  Write-Host "Records: $($result.record_count)"
  if (-not $result.ok) {
    Write-Host ""
    Write-Host "STDERR:"
    Write-Host $result.stderr
  }
}

function Test-SourceFiles {
  Write-Step "Source syntax"
  & $Python -m py_compile (Join-Path $ProjectRoot "run_server.py")
  if ($LASTEXITCODE -ne 0) { throw "Python syntax check failed." }
  $Node = "C:\Users\t1600\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $Node) {
    & $Node --check (Join-Path $ProjectRoot "app.js")
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed." }
  } else {
    Write-Host "Node not found, skipped app.js syntax check: $Node"
  }
  Write-Host "Syntax checks passed."
}

function Get-InfoValue {
  param(
    [string]$Info,
    [string]$Key
  )
  foreach ($part in ($Info -split ";")) {
    if ($part.StartsWith("$Key=")) {
      return ($part.Substring($Key.Length + 1) -split ",")[0]
    }
  }
  return ""
}

function Test-SampleVcfs {
  Write-Step "Sample VCF parse"
  $files = @(
    @{ Kind = "SNV"; Path = "C:\Users\t1600\Downloads\snv-Unfiltered-sa3.vcf" },
    @{ Kind = "INDEL"; Path = "C:\Users\t1600\Downloads\indel-Unfiltered-sa3.vcf" }
  )
  $total = 0
  $vepInputs = New-Object System.Collections.Generic.HashSet[string]
  $samples = New-Object System.Collections.Generic.HashSet[string]
  foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file.Path)) {
      Write-Host "Missing $($file.Kind): $($file.Path)"
      continue
    }
    $count = 0
    foreach ($line in Get-Content -LiteralPath $file.Path -Encoding UTF8) {
      if (-not $line -or $line.StartsWith("#")) { continue }
      $fields = $line -split "`t"
      if ($fields.Count -lt 8) { continue }
      $info = $fields[7]
      $sid = Get-InfoValue -Info $info -Key "SID"
      if ($sid) { [void]$samples.Add($sid) }
      $ann = Get-InfoValue -Info $info -Key "ANN"
      $parts = $ann -split "\|"
      if ($parts.Count -gt 9 -and $parts[6] -and $parts[9]) {
        [void]$vepInputs.Add("$($parts[6]):$($parts[9])")
      }
      $count += 1
    }
    $total += $count
    Write-Host "$($file.Kind): $count variants"
  }
  Write-Host "Samples: $([string]::Join(', ', $samples))"
  Write-Host "Total variants: $total"
  Write-Host "Unique VEP inputs: $($vepInputs.Count)"
}

function Invoke-Debug {
  Test-SourceFiles
  Invoke-Status
  Test-SampleVcfs
  Write-Step "VEP smoke test"
  Test-Vep
}

Set-Location -LiteralPath $ProjectRoot

switch ($Action) {
  "Status" { Invoke-Status }
  "StartWebsite" { Start-Website }
  "OpenWebsite" { Open-Website }
  "SetupWslVep" { Setup-WslVep }
  "DownloadVepData" { Download-VepData }
  "TestVep" { Test-Vep }
  "Debug" { Invoke-Debug }
  "StopWebsite" { Stop-Website }
  "AllLocal" {
    Setup-WslVep
    Download-VepData
    Start-Website
    Invoke-Status
  }
}
