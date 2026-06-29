param(
  [switch]$DownloadVepData,
  [string]$DataRoot = "C:\vep_data",
  [string]$Branch = "release/116",
  [string]$Distro = "CMUHCHVEP"
)

$ErrorActionPreference = "Stop"

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

Write-Host "CMUHCH VEP WSL source setup"
Write-Host "Branch: $Branch"
Write-Host "Distro: $Distro"
Write-Host "Data root: $DataRoot"
Write-Host ""

$Wsl = Get-Command wsl -ErrorAction SilentlyContinue
if (-not $Wsl) {
  throw "WSL was not found. Run: wsl --install"
}

$ListOutput = & wsl -l -q --all 2>$null
if ($LASTEXITCODE -ne 0 -or -not ($ListOutput | Where-Object { $_.Trim() -eq $Distro })) {
  throw "WSL distribution '$Distro' is not ready. Run: wsl --install Ubuntu --name $Distro, restart if requested, then open it once to create the Linux user."
}

$InstallData = if ($DownloadVepData) { "1" } else { "0" }
$Bash = @'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "sudo is required when not running as root." >&2
  exit 1
fi

$SUDO apt-get update
$SUDO apt-get install -y \
  git curl unzip build-essential cpanminus make gcc g++ \
  perl libdbi-perl libdbd-mysql-perl zlib1g-dev libbz2-dev \
  liblzma-dev libcurl4-openssl-dev libssl-dev \
  libwww-perl libbio-perl-perl

if [ ! -d "$HOME/ensembl-vep/.git" ]; then
  git clone https://github.com/Ensembl/ensembl-vep.git "$HOME/ensembl-vep"
fi

cd "$HOME/ensembl-vep"
git fetch --all --prune
git checkout "__BRANCH__"

perl INSTALL.pl --AUTO a --SPECIES homo_sapiens --ASSEMBLY GRCh38 --CACHEDIR /mnt/c/vep_data/cache --NO_TEST

if [ "__INSTALL_DATA__" = "1" ]; then
  perl INSTALL.pl --AUTO cf --SPECIES homo_sapiens --ASSEMBLY GRCh38 --CACHEDIR /mnt/c/vep_data/cache --REFSEQ --NO_TEST
fi

perl vep --help | head -n 1
'@

$Bash = $Bash.Replace("__BRANCH__", $Branch).Replace("__INSTALL_DATA__", $InstallData)

$TempScript = Join-Path $env:TEMP "cmuhch_vep_wsl_setup.sh"
[System.IO.File]::WriteAllText($TempScript, $Bash, [System.Text.UTF8Encoding]::new($false))
$Drive = $TempScript.Substring(0, 1).ToLower()
$PathWithoutDrive = $TempScript.Substring(2).Replace("\", "/")
$WslScript = "/mnt/$Drive$PathWithoutDrive"

wsl -d $Distro -u root bash $WslScript
if ($LASTEXITCODE -ne 0) {
  throw "WSL VEP source setup failed."
}

Write-Host ""
Write-Host "Done. Website runner is configured for wsl_source in vep_config.json."
