# Installs the Review tracker's counter on this PC (see review-counter.mts): copies it to
# %LOCALAPPDATA%\VRPrime\review-counter, asks once for the Supabase secret key (hidden, kept only in that folder),
# and registers a Windows task that runs it every 5 days at 10 am, or as soon as the PC is on after a missed time.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-review-counter.ps1            install or update
#   powershell -ExecutionPolicy Bypass -File scripts\install-review-counter.ps1 -RunNow    and count right away
#   powershell -ExecutionPolicy Bypass -File scripts\install-review-counter.ps1 -NewKey    ask for the key again
#   powershell -ExecutionPolicy Bypass -File scripts\install-review-counter.ps1 -Remove    remove the task and folder

param([switch]$RunNow, [switch]$NewKey, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$TaskName = 'VR Prime review counter'
$repo = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $env:LOCALAPPDATA 'VRPrime\review-counter'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    Write-Host 'Removed the task and its folder.' -ForegroundColor Green
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js was not found. Install it from nodejs.org, then run this again.' -ForegroundColor Red; exit 1 }

# The counter and the review-reading code it uses, as one small folder of their own.
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $repo 'scripts\review-counter.mts') $dir -Force
Copy-Item (Join-Path $repo 'src\lib\review-count.ts') $dir -Force
[IO.File]::WriteAllText((Join-Path $dir 'package.json'), '{ "type": "module" }')

# The settings: the project address from the repo's .env.local, and the secret key typed here.
$envFile = Join-Path $dir '.env'
if ($NewKey -or -not (Test-Path $envFile)) {
    $url = (Get-Content (Join-Path $repo '.env.local') | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' } | Select-Object -First 1) -replace '^NEXT_PUBLIC_SUPABASE_URL=', ''
    if (-not $url) { Write-Host "NEXT_PUBLIC_SUPABASE_URL is not in $repo\.env.local." -ForegroundColor Red; exit 1 }
    Write-Host ''
    Write-Host 'Paste the Supabase SECRET key (starts with sb_secret_), then press Enter. It is hidden on screen.' -ForegroundColor Cyan
    Write-Host 'Where: Supabase > your project > Project Settings > API Keys > Secret keys.' -ForegroundColor DarkGray
    Write-Host "It is saved only in $envFile on this PC." -ForegroundColor DarkGray
    $secure = Read-Host 'Key' -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if (-not $key.StartsWith('sb_secret_')) { Write-Host 'That does not start with sb_secret_, so nothing was saved. Run this again to retry.' -ForegroundColor Red; exit 1 }
    [IO.File]::WriteAllLines($envFile, [string[]]@("NEXT_PUBLIC_SUPABASE_URL=$url", "SUPABASE_SECRET_KEY=$key"))
}

# Every 5 days at 10 am; a missed run happens as soon as the PC is on. Hidden window, up to 45 minutes.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$node' --no-warnings '$dir\review-counter.mts'`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 5 -At 10am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Reads the written reviews on every VRPRIME Flipkart and Shopsy link and saves them to hub.vrprime.in (Review tracker).' -Force | Out-Null
Write-Host "Installed: '$TaskName' runs every 5 days at 10 am. Log: $dir\review-counter.log" -ForegroundColor Green

if ($RunNow) {
    Write-Host 'Counting now (a few minutes)...' -ForegroundColor Cyan
    & $node --no-warnings (Join-Path $dir 'review-counter.mts')
}
