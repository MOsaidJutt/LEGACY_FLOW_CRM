<#
  Installs the Legacy Flow desktop agent on a Windows workstation.
  Run in an elevated PowerShell, in the folder that also contains LegacyFlowAgent.ps1:

    powershell -ExecutionPolicy Bypass -File .\Install-LegacyFlowAgent.ps1 -Url "https://crm.example.com" -Token "lfd_..."

  Add -ReportApps to also report the foreground program name (Management option).
  Uninstall:  Unregister-ScheduledTask -TaskName "Legacy Flow Agent" -Confirm:$false
#>
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Token,
    [switch]$ReportApps
)

$ErrorActionPreference = "Stop"
if (-not $Token.StartsWith("lfd_")) { throw "The token should start with lfd_. Copy it again from Admin > Workstations." }

$dir = Join-Path $env:ProgramData "LegacyFlow"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "LegacyFlowAgent.ps1") -Destination (Join-Path $dir "LegacyFlowAgent.ps1") -Force

$config = @{ url = $Url.TrimEnd("/"); token = $Token; reportApps = [bool]$ReportApps } | ConvertTo-Json
Set-Content -Path (Join-Path $dir "agent.json") -Value $config -Encoding UTF8

# only administrators and SYSTEM may change the files; signed-in users may read them
& icacls $dir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null

$agent = Join-Path $dir "LegacyFlowAgent.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agent`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Legacy Flow Agent" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

try { Start-ScheduledTask -TaskName "Legacy Flow Agent" } catch { }
Write-Host "Legacy Flow agent installed. It starts automatically at every Windows sign-in."
