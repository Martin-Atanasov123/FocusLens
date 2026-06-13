@echo off
REM Allow the FocusLens phone companion to reach the desktop agent over the
REM local network (TCP port 48732). Run this ONCE.
REM
REM   Right-click this file  ->  "Run as administrator"
REM
REM The rule is scoped to the Private profile and the local subnet, so it
REM only accepts connections from devices on your own Wi-Fi/LAN.

netsh advfirewall firewall delete rule name="FocusLens" >nul 2>&1
netsh advfirewall firewall add rule name="FocusLens" dir=in action=allow protocol=TCP localport=48732 profile=private remoteip=localsubnet

if %errorlevel%==0 (
  echo.
  echo   FocusLens firewall rule added. Your phone can now reach the desktop.
) else (
  echo.
  echo   Failed. Make sure you ran this as administrator
  echo   ^(right-click the file -^> Run as administrator^).
)
echo.
pause
