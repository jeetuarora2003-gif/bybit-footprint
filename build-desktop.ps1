$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"
$desktopWebDir = Join-Path $backendDir "cmd\desktop\web"
$outputDir = Join-Path $root "desktop-app"
$outputExe = Join-Path $outputDir "Bybit Footprint.exe"
$desktopDir = [Environment]::GetFolderPath("Desktop")
$desktopShortcut = Join-Path $desktopDir "Bybit Footprint.lnk"

Write-Host "Building frontend bundle..."
Push-Location $frontendDir
try {
  npm run build
} finally {
  Pop-Location
}

Write-Host "Refreshing embedded desktop assets..."
New-Item -ItemType Directory -Force -Path $desktopWebDir | Out-Null
Get-ChildItem -Force $desktopWebDir |
  Where-Object { $_.Name -notin @(".gitignore") } |
  Remove-Item -Recurse -Force
Copy-Item (Join-Path $frontendDir "dist\*") $desktopWebDir -Recurse -Force

Write-Host "Compiling desktop app..."
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Push-Location $backendDir
try {
  go build -o $outputExe .\cmd\desktop
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Desktop app ready:"
Write-Host "  $outputExe"

if ($desktopDir -and (Test-Path $desktopDir)) {
  Write-Host "Creating desktop shortcut..."
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($desktopShortcut)
  $shortcut.TargetPath = $outputExe
  $shortcut.WorkingDirectory = $outputDir
  $shortcut.IconLocation = $outputExe
  $shortcut.Save()

  Write-Host "Desktop shortcut ready:"
  Write-Host "  $desktopShortcut"
}
