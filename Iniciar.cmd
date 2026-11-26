@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Instala Node.js 20 o superior. & pause & exit /b 1)
if not exist node_modules\playwright-core\package.json (
  call npm ci || (pause & exit /b 1)
)
node -e "const p=require('playwright-core'),fs=require('node:fs');process.exit([p.chromium,p.webkit].every(b=>fs.existsSync(b.executablePath())) ? 0 : 1)"
if errorlevel 1 (
  call npx --no-install playwright-core install chromium webkit || (pause & exit /b 1)
)
call node server.mjs --open
if errorlevel 1 pause
