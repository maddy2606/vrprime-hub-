# Installs the Listing check on this PC (see listing-check.mts): copies it to %LOCALAPPDATA%\VRPrime\listing-check and
# registers a Windows task that runs it every day at 9:15 am, or as soon as the PC is on after a missed time. It saves
# through the Supabase CLI where it is already signed in and linked (the vrprime-db-setup folder next to the repo, or
# -CliDir), so no key is kept; without that it asks once for the Supabase secret key (hidden, kept only in that folder).
# Flipkart is only read, never written.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-listing-check.ps1            install or update
#   powershell -ExecutionPolicy Bypass -File scripts\install-listing-check.ps1 -RunNow    and check right away
#   powershell -ExecutionPolicy Bypass -File scripts\install-listing-check.ps1 -NewKey    use a secret key instead
#   powershell -ExecutionPolicy Bypass -File scripts\install-listing-check.ps1 -Remove    remove the task and folder

param([switch]$RunNow, [switch]$NewKey, [switch]$Remove, [string]$CliDir = '')
$ErrorActionPreference = 'Stop'
$TaskName = 'VR Prime listing check'
$repo = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $env:LOCALAPPDATA 'VRPrime\listing-check'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    Write-Host 'Removed the task and its folder.' -ForegroundColor Green
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js was not found. Install it from nodejs.org, then run this again.' -ForegroundColor Red; exit 1 }

# The check and the page-reading code it uses, as one small folder of their own.
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $repo 'scripts\listing-check.mts') $dir -Force
Copy-Item (Join-Path $repo 'src\lib\listing-check.ts') $dir -Force
[IO.File]::WriteAllText((Join-Path $dir 'package.json'), '{ "type": "module" }')

# The settings: the signed-in Supabase CLI folder when there is one; else the project address from the repo's
# .env.local and the secret key typed here.
$envFile = Join-Path $dir '.env'
if (-not $CliDir) { $CliDir = Join-Path (Split-Path $repo -Parent) 'vrprime-db-setup' }
if (-not $NewKey -and (Test-Path (Join-Path $CliDir 'supabase\.temp\linked-project.json'))) {
    [IO.File]::WriteAllLines($envFile, [string[]]@("SUPABASE_CLI_DIR=$((Resolve-Path $CliDir).Path)"))
    Write-Host "Saving through the Supabase CLI signed in at $CliDir (no key needed)." -ForegroundColor Green
} elseif ($NewKey -or -not (Test-Path $envFile)) {
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

# Every day at 9:15 am; a missed run happens as soon as the PC is on. Hidden window, up to 45 minutes.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$node' --no-warnings '$dir\listing-check.mts'`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 9:15am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Reads whether every VRPRIME Flipkart and Shopsy link can be bought, and its price, and saves it to hub.vrprime.in (Listing check).' -Force | Out-Null
Write-Host "Installed: '$TaskName' runs every day at 9:15 am. Log: $dir\listing-check.log" -ForegroundColor Green

if ($RunNow) {
    Write-Host 'Checking now (a few minutes)...' -ForegroundColor Cyan
    & $node --no-warnings (Join-Path $dir 'listing-check.mts')
}
