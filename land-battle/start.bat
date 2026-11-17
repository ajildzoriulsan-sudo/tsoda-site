@echo off
chcp 65001 >nul
setlocal
title ГАЗРЫН ТУЛААН - LAND BATTLE LIVE
cd /d "%~dp0bridge"

set "USERFILE=%~dp0bridge\tiktok-user.txt"
set "AZKEYFILE=%~dp0bridge\azure-key.txt"
set "AZREGIONFILE=%~dp0bridge\azure-region.txt"

rem ---------- 1. Node.js суусан эсэх ----------
where node >nul 2>nul
if errorlevel 1 goto nonode

rem ---------- 2. Эхний удаа сан суулгах ----------
if exist "node_modules\tiktok-live-connector" goto deps_ok
echo.
echo  Эхний удаа шаардлагатай сангуудыг суулгаж байна... 1-2 минут
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail
:deps_ok

rem ---------- 3. Azure монгол хоолой - заавал биш ----------
set "AZURE_SPEECH_KEY="
set "AZURE_SPEECH_REGION=eastasia"
if exist "%AZKEYFILE%" set /p AZURE_SPEECH_KEY=<"%AZKEYFILE%"
if exist "%AZREGIONFILE%" set /p AZURE_SPEECH_REGION=<"%AZREGIONFILE%"

:menu
cls
echo.
echo  ==============================================
echo            ГАЗРЫН ТУЛААН  -  LAND BATTLE LIVE
echo  ==============================================
echo.
set "TTUSER=tsoda.studio"
if exist "%USERFILE%" set /p TTUSER=<"%USERFILE%"
if defined TTUSER echo   TikTok нэр : @%TTUSER%
if not defined TTUSER echo   TikTok нэр : - тохируулаагүй -
if defined AZURE_SPEECH_KEY echo   AI хоолой  : Azure монгол хоолой
if not defined AZURE_SPEECH_KEY echo   AI хоолой  : браузер TTS
echo.
echo   [1]  TikTok LIVE-тэй холбох   - эхлээд TikTok дээр LIVE эхлүүлнэ үү
echo   [2]  Туршилт - TikTok-гүй, хуурамч үзэгчид
echo   [3]  TikTok нэр солих
echo   [4]  Azure монгол хоолойн түлхүүр оруулах
echo   [5]  Гарах
echo.
choice /c 12345 /n /m "  Сонголт [1-5]: "
if errorlevel 5 goto end
if errorlevel 4 goto setazure
if errorlevel 3 goto setuser
if errorlevel 2 goto mock
if errorlevel 1 goto live
goto menu

:live
if not defined TTUSER goto setuser_then_live
cls
echo.
echo   @%TTUSER% LIVE-д холбогдож байна...
echo   Браузер автоматаар нээгдэнэ. Энэ цонхыг LIVE дуустал бүү хаа!
echo.
node server.js --user=%TTUSER% --open
echo.
echo   Bridge зогслоо.
pause
goto menu

:mock
cls
echo.
echo   Туршилтын горим: хуурамч Follow / Like / Gift үүсгэнэ.
echo.
node server.js --mock --open
echo.
pause
goto menu

:setuser_then_live
call :askuser
if defined TTUSER goto live
goto menu

:setuser
call :askuser
goto menu

:askuser
echo.
set "NEWUSER="
set /p NEWUSER="  TikTok нэрээ бичнэ үү, жишээ нь @bataa_mn : "
if not defined NEWUSER goto :eof
set "NEWUSER=%NEWUSER:@=%"
set "NEWUSER=%NEWUSER: =%"
>"%USERFILE%" echo %NEWUSER%
set "TTUSER=%NEWUSER%"
echo   Хадгаллаа: @%NEWUSER%
timeout /t 1 >nul
goto :eof

:setazure
echo.
echo   Azure портал - Speech service - Keys and Endpoint хэсгээс KEY 1 болон Location-ийг хуулна.
echo   Хоосон орхивол Azure хоолойг унтраана.
echo.
set "NEWKEY="
set /p NEWKEY="  Azure түлхүүр: "
if not defined NEWKEY goto azure_off
set "NEWREGION="
set /p NEWREGION="  Region, жишээ нь eastasia: "
if not defined NEWREGION set "NEWREGION=eastasia"
>"%AZKEYFILE%" echo %NEWKEY%
>"%AZREGIONFILE%" echo %NEWREGION%
set "AZURE_SPEECH_KEY=%NEWKEY%"
set "AZURE_SPEECH_REGION=%NEWREGION%"
echo   Хадгаллаа.
timeout /t 1 >nul
goto menu
:azure_off
if exist "%AZKEYFILE%" del "%AZKEYFILE%"
set "AZURE_SPEECH_KEY="
echo   Azure хоолой унтарлаа.
timeout /t 1 >nul
goto menu

:nonode
echo.
echo   Node.js суугаагүй байна.
echo   Нээгдэх хуудаснаас LTS хувилбарыг татаж суулгаад энэ файлыг дахин ажиллуулна уу.
echo.
start "" "https://nodejs.org/"
pause
goto end

:npmfail
echo.
echo   Сан суулгахад алдаа гарлаа. Интернэт холболтоо шалгаад дахин оролдоно уу.
pause
goto end

:end
endlocal
