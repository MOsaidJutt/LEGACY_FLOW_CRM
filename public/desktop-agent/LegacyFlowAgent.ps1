<#
  Legacy Flow desktop agent.
  Every 30 seconds it reports how long the keyboard and mouse have been idle on this
  computer (and, if enabled, the name of the program in the foreground) to Legacy Flow.
  It does not record keystrokes, screen contents or window titles.

  Installed and started by Install-LegacyFlowAgent.ps1; reads its settings from
  %ProgramData%\LegacyFlow\agent.json  ->  { "url": "...", "token": "lfd_...", "reportApps": false }
#>
param([string]$ConfigPath = "$env:ProgramData\LegacyFlow\agent.json")

$ErrorActionPreference = "Continue"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LegacyFlowInput {
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    public static uint IdleSeconds() {
        var info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) return 0;
        return unchecked((uint)Environment.TickCount - info.dwTime) / 1000;
    }

    public static string ForegroundProcess() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }
}
"@

$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$uri = $config.url.TrimEnd("/") + "/api/desktop/heartbeat"
$headers = @{ Authorization = "Bearer $($config.token)" }

while ($true) {
    $body = @{ idleSeconds = [int][LegacyFlowInput]::IdleSeconds() }
    if ($config.reportApps) { $body.app = [LegacyFlowInput]::ForegroundProcess() }
    try {
        Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 15 | Out-Null
    } catch {
        # network hiccup or server restart: try again on the next beat
    }
    Start-Sleep -Seconds 30
}
