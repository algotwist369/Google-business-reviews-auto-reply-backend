# Server Restart Script
Write-Host "=== Stopping all Node.js server processes ===" -ForegroundColor Yellow

# Find and kill all node processes running server.js
Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
    if ($cmdLine -and ($cmdLine -like '*server.js*' -or $cmdLine -like '*nodemon*')) {
        Write-Host "Stopping process $($_.Id): $cmdLine" -ForegroundColor Red
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 2

# Check if port 5000 is free
$portInUse = netstat -ano | findstr :5000
if ($portInUse) {
    Write-Host "`nWARNING: Port 5000 is still in use!" -ForegroundColor Red
    Write-Host "You may need to manually kill the process using port 5000" -ForegroundColor Yellow
    Write-Host "Run: netstat -ano | findstr :5000" -ForegroundColor Yellow
} else {
    Write-Host "`nPort 5000 is now free!" -ForegroundColor Green
}

Write-Host "`n=== Starting server ===" -ForegroundColor Green
Write-Host "Run: npm start" -ForegroundColor Cyan
Write-Host "Or: npm run dev (for nodemon)" -ForegroundColor Cyan

