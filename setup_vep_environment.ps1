param(
  [switch]$DownloadVepData,
  [switch]$PullImage,
  [string]$ConfigPath = ".\vep_config.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Cannot find $ConfigPath"
}

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$DataRoot = $Config.host_data_dir
$Image = $Config.docker_image

$Folders = @(
  $DataRoot,
  (Join-Path $DataRoot "cache"),
  (Join-Path $DataRoot "fasta"),
  (Join-Path $DataRoot "plugins")
)

foreach ($Folder in $Folders) {
  if (-not (Test-Path -LiteralPath $Folder)) {
    New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  }
}

Write-Host "CMUHCH VEP environment setup"
Write-Host "Data root: $DataRoot"
Write-Host "Docker image: $Image"
Write-Host ""

$Docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $Docker) {
  Write-Warning "Docker CLI was not found. Install Docker Desktop first, then rerun this script."
  Write-Host "Download: https://www.docker.com/products/docker-desktop/"
  exit 1
}

docker --version

if ($PullImage) {
  Write-Host ""
  Write-Host "Pulling VEP Docker image..."
  docker pull $Image
  if ($LASTEXITCODE -ne 0) {
    throw "docker pull failed. Please retry later, switch network, or import the image from a saved Docker tar file."
  }
}

if ($DownloadVepData) {
  Write-Host ""
  Write-Host "Downloading Ensembl VEP GRCh38 cache and FASTA. This can take a long time."
  docker run -t -i -v "${DataRoot}:/data" $Image INSTALL.pl -a cf -s homo_sapiens -y GRCh38 -c /data/cache
  if ($LASTEXITCODE -ne 0) {
    throw "VEP INSTALL.pl failed. Check Docker, network, and available disk space."
  }
}

Write-Host ""
Write-Host "Folder check:"
foreach ($Folder in $Folders) {
  $Exists = Test-Path -LiteralPath $Folder
  Write-Host "  [$Exists] $Folder"
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Open http://127.0.0.1:8765/"
Write-Host "  2. Click '檢查 VEP 環境'"
Write-Host "  3. If Docker/cache checks pass, run a small VEP test from the website."
