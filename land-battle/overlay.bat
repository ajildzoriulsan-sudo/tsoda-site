@echo off
chcp 65001 >nul
rem Тоглоомыг LIVE Studio / OBS-д барихад зориулсан тусдаа Edge цонх.
rem  - тусдаа профайл: Edge-ийн "далд цонхыг унтуулах" тохиргоог унтраах боломжтой
rem  - дуу дарахгүйгээр автоматаар асна
rem start.bat -> [1] ажиллаж байх ёстой.
start "" msedge --app="http://localhost:8787/?ws=auto&overlay=1" --window-size=608,1080 --window-position=0,0 --user-data-dir="%LOCALAPPDATA%\LandBattleOverlay" --no-first-run --autoplay-policy=no-user-gesture-required --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling
