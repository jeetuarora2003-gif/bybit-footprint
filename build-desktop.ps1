$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherSource = Join-Path $root "Launch Footprint.bat"
$desktopDir = [Environment]::GetFolderPath("Desktop")
$desktopLauncher = Join-Path $desktopDir "Launch Footprint.bat"
$oldShortcut = Join-Path $desktopDir "Bybit Footprint.lnk"

if (-not (Test-Path $launcherSource)) {
  throw "Launch Footprint.bat was not found at $launcherSource"
}

if (-not $desktopDir -or -not (Test-Path $desktopDir)) {
  throw "Desktop folder not found."
}

Write-Host "Copying launcher to Desktop..."
Copy-Item -LiteralPath $launcherSource -Destination $desktopLauncher -Force

if (Test-Path $oldShortcut) {
  Write-Host "Removing old desktop shortcut..."
  Remove-Item -LiteralPath $oldShortcut -Force
}

Write-Host ""
Write-Host "Launcher ready:"
Write-Host "  $desktopLauncher"
