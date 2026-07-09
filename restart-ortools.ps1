#Requires -Version 5.1
<#
.SYNOPSIS
  Kill hung OR-Tools processes and start a fresh uvicorn instance on port 8000.
.DESCRIPTION
  Run via: npm run restart:ortools
  API route uses -Detached to spawn uvicorn in a new PowerShell window.
#>

param(
    [switch]$Detached
)

$ErrorActionPreference = "Continue"

$Port = 8000
$ServiceDir = Join-Path $PSScriptRoot "or-tools-service"
$VenvActivate = Join-Path $ServiceDir ".venv\Scripts\Activate.ps1"

function Test-LocalAddressOnPort {
    param(
        [string]$LocalAddress,
        [int]$TargetPort
    )

    if ([string]::IsNullOrWhiteSpace($LocalAddress)) { return $false }

    $portSuffix = ":$TargetPort"
    return $LocalAddress.EndsWith($portSuffix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Stop-ProcessesOnPort {
    param([int]$TargetPort)

    $processIds = @()
    $netstatLines = netstat -ano 2>$null | Select-String ":$TargetPort\s"

    foreach ($line in $netstatLines) {
        $trimmed = ($line.ToString() -replace '\s+', ' ').Trim()
        $parts = $trimmed.Split(' ')
        if ($parts.Length -lt 5) { continue }

        $localAddress = $parts[1]
        $state = $parts[3]
        $processIdText = $parts[-1]
        if ($state -notmatch 'LISTENING' -and $state -notmatch 'ESTABLISHED') { continue }
        if ($processIdText -notmatch '^\d+$' -or $processIdText -eq '0') { continue }
        if (-not (Test-LocalAddressOnPort -LocalAddress $localAddress -TargetPort $TargetPort)) { continue }

        $processIds += [int]$processIdText
    }

    foreach ($processId in ($processIds | Select-Object -Unique)) {
        Write-Host "Stopping process on port $TargetPort (PID $processId)..."
        try {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        } catch {}
        try {
            & taskkill /PID $processId /F 2>$null | Out-Null
        } catch {}
    }
}

function Stop-OrToolsPythonProcesses {
    try {
        Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -like '*or-tools-service*' -or
                $_.CommandLine -like '*app.main:app*'
            } |
            ForEach-Object {
                Write-Host "Stopping OR-Tools python process (PID $($_.ProcessId))..."
                try {
                    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                } catch {}
                try {
                    & taskkill /PID $_.ProcessId /F 2>$null | Out-Null
                } catch {}
            }
    } catch {
        Write-Warning "Could not enumerate python processes: $_"
    }
}

Write-Host "Restarting OR-Tools service on port $Port..."

Stop-ProcessesOnPort -TargetPort $Port
Start-Sleep -Milliseconds 400
Stop-OrToolsPythonProcesses
Start-Sleep -Milliseconds 400
Stop-ProcessesOnPort -TargetPort $Port

if (-not (Test-Path $VenvActivate)) {
    Write-Error "Virtual environment not found at $VenvActivate. Create it in or-tools-service first."
    exit 1
}

$uvicornArgs = @(
    "app.main:app",
    "--host", "127.0.0.1",
    "--port", "$Port",
    "--reload"
)

if ($Detached) {
    $argList = ($uvicornArgs | ForEach-Object { "'$($_ -replace "'", "''")'" }) -join ", "
    $startCommand = "Set-Location -LiteralPath '$ServiceDir'; & '$VenvActivate'; uvicorn $argList"
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command", $startCommand
    ) -WindowStyle Normal | Out-Null
    Write-Host "OR-Tools service started in a new window."
    exit 0
}

Set-Location -LiteralPath $ServiceDir
& $VenvActivate
uvicorn @uvicornArgs