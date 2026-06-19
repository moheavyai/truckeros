#Requires -Version 5.1
<#
.SYNOPSIS
  Safety-first workflow: zip backup, git commit/push, Supabase migrations.
.DESCRIPTION
  Run via: npm run safety:backup
#>

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Skip([string]$Message) {
    Write-Host "  [SKIP] $Message" -ForegroundColor Yellow
}

function Write-Warn([string]$Message) {
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail([string]$Message) {
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Step $Name
    try {
        & $Action
    }
    catch {
        Write-Fail "$Name failed."
        Write-Host $_.Exception.Message -ForegroundColor Red
        if ($_.ScriptStackTrace) {
            Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
        }
        exit 1
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Command,
        [switch]$Quiet
    )

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Command[0] @($Command[1..($Command.Length - 1)]) 2>&1
        $exitCode = $LASTEXITCODE

        if (-not $Quiet -and $null -ne $output) {
            @($output) | ForEach-Object {
                $line = if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    $_.ToString()
                }
                else {
                    "$_"
                }
                Write-Host "  $line" -ForegroundColor DarkGray
            }
        }

        return $exitCode
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

# ---------------------------------------------------------------------------
# Project root detection
# ---------------------------------------------------------------------------

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path

if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    Write-Fail "Could not detect project root (package.json not found)."
    Write-Host "  Script dir: $ScriptDir" -ForegroundColor DarkGray
    Write-Host "  Resolved root: $ProjectRoot" -ForegroundColor DarkGray
    exit 1
}

Set-Location $ProjectRoot
Write-Ok "Project root: $ProjectRoot"

$Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"

# Directories and file patterns excluded from zip backups
$ExcludeDirNames = @(
    "node_modules",
    ".next",
    ".git",
    "backups",
    "out",
    "build",
    ".vercel",
    "__pycache__",
    ".venv",
    "dist",
    "coverage",
    ".turbo",
    ".pnp",
    "agent-tools"
)

function Test-BackupExcluded {
    param([string]$RelativePath)

    $normalized = $RelativePath -replace '\\', '/'
    $segments = $normalized -split '/'

    foreach ($segment in $segments) {
        if ($ExcludeDirNames -contains $segment) {
            return $true
        }
    }

    $leaf = [System.IO.Path]::GetFileName($normalized)
    if ($leaf -like ".env*") {
        return $true
    }

    return $false
}

# ---------------------------------------------------------------------------
# Step 1: Zip backup
# ---------------------------------------------------------------------------

$BackupPath = $null

Invoke-Step "Step 1/4: Create zip backup" {
    $BackupsDir = Join-Path $ProjectRoot "backups"
    if (-not (Test-Path $BackupsDir)) {
        New-Item -ItemType Directory -Path $BackupsDir | Out-Null
        Write-Ok "Created backups/ folder"
    }

    $ZipName = "truckeros-backup-$Timestamp.zip"
    $ZipPath = Join-Path $BackupsDir $ZipName

    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -Path $ProjectRoot -Recurse -File -Force -ErrorAction SilentlyContinue
        $added = 0

        foreach ($file in $files) {
            $relative = $file.FullName.Substring($ProjectRoot.Length).TrimStart('\', '/')
            if (Test-BackupExcluded -RelativePath $relative) {
                continue
            }

            $entryName = $relative -replace '\\', '/'
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
            $added++
        }

        if ($added -eq 0) {
            throw "No files were added to the backup archive."
        }

        $sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
        Write-Ok "Backup created: backups/$ZipName ($added files, ${sizeMb} MB)"
        $script:BackupPath = $ZipPath
    }
    finally {
        $zip.Dispose()
    }
}

# ---------------------------------------------------------------------------
# Step 2: Git commit (only if changes exist)
# ---------------------------------------------------------------------------

$CommitMessage = "chore: safety backup $Timestamp"

Invoke-Step "Step 2/4: Git commit" {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        throw "git is not installed or not on PATH."
    }

    if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
        throw "Not a git repository (.git not found)."
    }

    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $status = git status --porcelain 2>&1 | Out-String
    $ErrorActionPreference = $previousErrorAction

    if ($LASTEXITCODE -ne 0) {
        throw "git status failed: $status"
    }

    if ([string]::IsNullOrWhiteSpace($status)) {
        Write-Skip "No changes to commit."
        return
    }

    $addExit = Invoke-External -Command @("git", "add", "-A")
    if ($addExit -ne 0) {
        throw "git add failed."
    }

    $commitExit = Invoke-External -Command @("git", "commit", "-m", $CommitMessage)
    if ($commitExit -ne 0) {
        throw "git commit failed."
    }

    Write-Ok "Committed: $CommitMessage"
}

# ---------------------------------------------------------------------------
# Step 3: Git push to main
# ---------------------------------------------------------------------------

Invoke-Step "Step 3/4: Git push to main" {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $currentBranch = (git rev-parse --abbrev-ref HEAD 2>&1 | Out-String).Trim()
    $branchExit = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction

    if ($branchExit -ne 0) {
        throw "Could not determine current branch: $currentBranch"
    }

    if ($currentBranch -ne "main") {
        Write-Warn "Current branch is '$currentBranch', not 'main'. Pushing current branch to origin."
        $pushExit = Invoke-External -Command @("git", "push", "origin", $currentBranch)
        if ($pushExit -ne 0) {
            throw "git push origin $currentBranch failed."
        }
        Write-Ok "Pushed branch '$currentBranch' to origin."
        return
    }

    $pushMainExit = Invoke-External -Command @("git", "push", "origin", "main")
    if ($pushMainExit -ne 0) {
        throw "git push origin main failed."
    }

    Write-Ok "Pushed to origin/main."
}

# ---------------------------------------------------------------------------
# Step 4: Supabase migrations
# ---------------------------------------------------------------------------

Write-Step "Step 4/4: Supabase migrations"

$SupabaseFailed = $false

try {
    $MigrationsDir = Join-Path $ProjectRoot "supabase\migrations"
    if (-not (Test-Path $MigrationsDir)) {
        Write-Skip "No supabase/migrations folder found."
    }
    else {
        $migrationCount = (Get-ChildItem -Path $MigrationsDir -Filter "*.sql" -ErrorAction SilentlyContinue).Count
        Write-Ok "Found $migrationCount migration file(s) in supabase/migrations/"

        $ConfigToml = Join-Path $ProjectRoot "supabase\config.toml"
        if (-not (Test-Path $ConfigToml)) {
            Write-Warn "supabase/config.toml not found - Supabase CLI project not initialized."
            Write-Warn "To enable automatic migrations:"
            Write-Host '    1. npx supabase init' -ForegroundColor DarkGray
            Write-Host '    2. npx supabase link --project-ref YOUR_PROJECT_REF' -ForegroundColor DarkGray
            Write-Host "    3. Re-run: npm run safety:backup" -ForegroundColor DarkGray
            Write-Warn "Skipping db push. Apply migrations manually in the Supabase SQL editor if needed."
        }
        else {
            $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
            if (-not $npxCmd) {
                Write-Warn "npx not found. Install Node.js/npm to run Supabase CLI."
                Write-Warn "Skipping db push."
            }
            else {
                Write-Host "  Running: npx supabase db push" -ForegroundColor DarkGray
                $previousErrorAction = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                $pushOutput = npx supabase db push 2>&1
                $pushExit = $LASTEXITCODE
                $ErrorActionPreference = $previousErrorAction

                @($pushOutput) | ForEach-Object {
                    $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { "$_" }
                    Write-Host "  $line" -ForegroundColor DarkGray
                }

                if ($pushExit -ne 0) {
                    $outputText = (@($pushOutput) | ForEach-Object {
                        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { "$_" }
                    }) -join "`n"

                    if ($outputText -match "not linked|project ref|login|access token|not authenticated") {
                        Write-Warn "Supabase project is not linked or you are not logged in."
                        Write-Warn "Run: npx supabase login"
                        Write-Warn 'Then: npx supabase link --project-ref YOUR_PROJECT_REF'
                        Write-Warn "Skipping db push (backup and git steps completed)."
                    }
                    else {
                        throw "npx supabase db push failed (exit $pushExit)."
                    }
                }
                else {
                    Write-Ok "Supabase migrations pushed successfully."
                }
            }
        }
    }
}
catch {
    $SupabaseFailed = $true
    Write-Fail "Supabase migration step failed."
    Write-Host $_.Exception.Message -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($SupabaseFailed) {
    Write-Host "  Safety backup completed with warnings" -ForegroundColor Yellow
}
else {
    Write-Host "  Safety backup workflow complete" -ForegroundColor Green
}
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Timestamp : $Timestamp"
if ($BackupPath) {
    Write-Host "  Backup    : $BackupPath"
}
Write-Host "  Next      : Review SAFETY-CHECKLIST.md before major changes"
Write-Host ""

if ($SupabaseFailed) {
    exit 1
}

exit 0