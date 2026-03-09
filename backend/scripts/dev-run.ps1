Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $PSScriptRoot
Set-Location $backendDir

$listen = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($listen) {
  $pids = $listen | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $pids) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      Write-Host "Stopping process on 8080: PID=$procId NAME=$($proc.ProcessName)"
      Stop-Process -Id $procId -Force
    } catch {
      Write-Host "Skipping PID=$procId (already stopped)"
    }
  }
  Start-Sleep -Seconds 1
}

Write-Host "Starting backend with Gradle wrapper..."
& .\gradlew.bat bootRun --no-daemon
