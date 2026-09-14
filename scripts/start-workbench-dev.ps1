$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Find-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  )
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return $candidate } }

  $workbuddyRoot = Join-Path $env:USERPROFILE ".workbuddy\binaries\node\versions"
  if (Test-Path -LiteralPath $workbuddyRoot) {
    $candidate = Get-ChildItem -LiteralPath $workbuddyRoot -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }
  return $null
}

function Find-PnpmExecutable {
  $command = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return $null
}

function Test-WorkbenchRunning([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch { return $false }
}

try {
  $node = Find-NodeExecutable
  if (-not $node) { throw "Node.js was not found. Install Node.js 22.14 or newer and try again." }
  $nodeVersion = [version](& $node -p 'process.versions.node')
  if ($nodeVersion -lt [version]'22.14.0') { throw "Node.js $nodeVersion is too old. Node.js 22.14 or newer is required." }
  $env:PATH = "$(Split-Path -Parent $node);$env:PATH"

  $url = "http://localhost:3003/"
  $healthUrl = "http://127.0.0.1:3003/"
  $env:PORT = "3003"
  $env:BETTER_AUTH_URL = "http://localhost:3003"

  if (Test-WorkbenchRunning $healthUrl) {
    Write-Host "Knowledge Workbench is already running. Opening the browser..." -ForegroundColor Green
    if (-not $env:WORKBENCH_NO_BROWSER) { Start-Process $url }
    exit 0
  }

  $vinext = Join-Path $projectRoot "node_modules\vinext\dist\cli.js"
  $sqlitePackage = Join-Path $projectRoot "node_modules\better-sqlite3\lib\index.js"
  if (-not (Test-Path -LiteralPath $vinext) -or -not (Test-Path -LiteralPath $sqlitePackage)) {
    $pnpm = Find-PnpmExecutable
    if (-not $pnpm) { throw "Project dependencies are missing and pnpm was not found. Install pnpm and try again." }
    Write-Host "Preparing project dependencies for the first launch..." -ForegroundColor Cyan
    & $pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. Review the message above." }
  }
  if (-not (Test-Path -LiteralPath $vinext)) { throw "The workbench launcher is missing. Reinstall the project dependencies." }

  $server = Join-Path $projectRoot "dist\standalone\server.js"
  $serverBundle = Join-Path $projectRoot "dist\standalone\dist\server\index.js"
  if ($true) {
    Write-Host "Preparing the local production build..." -ForegroundColor Cyan
    & $node $vinext build
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $server) -or -not (Test-Path -LiteralPath $serverBundle)) { throw "The local production build failed. Review the message above." }
  }

  Write-Host ""
  Write-Host "Starting Knowledge Workbench: $url" -ForegroundColor Cyan
  Write-Host "Keep this window open. Closing it stops the workbench." -ForegroundColor DarkGray
  Write-Host ""

  if (-not $env:WORKBENCH_NO_BROWSER) {
    $watcher = @"
`$healthUrl = '$healthUrl'
`$url = '$url'
for (`$i = 0; `$i -lt 45; `$i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri `$healthUrl -TimeoutSec 2 | Out-Null
    Start-Process `$url
    break
  } catch { Start-Sleep -Seconds 1 }
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($watcher))
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoLogo", "-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded
  }

  & $node $server
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "Knowledge Workbench stopped unexpectedly (exit code $exitCode)." }
  Write-Host "Knowledge Workbench stopped."
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host "Keep the error message in this window for troubleshooting." -ForegroundColor Yellow
  if (-not $env:WORKBENCH_NONINTERACTIVE) { Read-Host "Press Enter to close" }
  exit 1
}


