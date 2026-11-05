@echo off
setlocal
cd /d "%~dp0..\.."
set ELECTRON_RUN_AS_NODE=
"node_modules\electron\dist\electron.exe" "prototypes\video-cover\main.cjs"
endlocal
