#Requires -Version 5.1
<#
.SYNOPSIS
  Safety-first workflow: zip backup, git commit/push, Supabase migrations.
.DESCRIPTION
  Run via: npm run safety:backup
#>

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Configuration (exported for Pester via dot-sourcing)
# ---------------------------------------------------------------------------

$script:ExcludeDirNames = @(
    "node_modules",
    ".next",
    ".git",
    "backups",
    "out",
    "build",
    ".vercel",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "dist",
    "coverage",
    ".turbo",
    ".pnp",
    "agent-tools",
    ".supabase"
)

$script:ExcludeFilePatterns = @(
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.crt",
    "*.cer"
)

$script:ExcludeFileNames = @(
    "id_rsa",
    "id_rsa.pub",
    "id_ed25519",
    "id_ed25519.pub",
    "credentials.json",
    "secrets.json",
    "production.env",
    ".npmrc"
)

$script:SecretScanBinaryExtensions = @(
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".zip", ".pdf",
    ".exe", ".dll", ".woff", ".woff2", ".mp4", ".mp3", ".pyc", ".so",
    ".db", ".sqlite", ".bin", ".dat"
)

$script:SecretContentPatterns = @(
    '(?i)-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----',
    '(?i)SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{20,}',
    '(?i)SUPABASE_JWT_SECRET\s*=\s*\S{20,}',
    '(?i)DATABASE_URL\s*=\s*postgres(?:ql)?://\S+',
    '(?i)AWS_SECRET_ACCESS_KEY\s*=\s*\S{16,}',
    '(?i)GITHUB_TOKEN\s*=\s*(?:ghp_|github_pat_)\S+',
    '(?i)api[_-]?key\s*[:=]\s*[''"][^''"]{20,}[''"]',
    '(?i)//registry\.npmjs\.org/:_authToken=\S{20,}',
    '(?i)_authToken=\S{20,}'
)

$script:SecretScanSkipPaths = @(
    'scripts/backup-and-push.ps1',
    'scripts/backup-and-push.Tests.ps1',
    'SAFETY-CHECKLIST.md'
)

$script:SupabaseBenignErrorPatterns = @(
    'project is not linked',
    'not linked to a remote',
    'Cannot find project ref',
    'Run supabase link',
    'Access token not provided',
    'not logged in',
    'You are not logged in',
    'Login required'
)

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
        $lines = @()
        if ($null -ne $output) {
            $lines = @($output | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    $_.ToString()
                }
                else {
                    "$_"
                }
            })
        }

        if (-not $Quiet -and $lines.Count -gt 0) {
            $lines | ForEach-Object {
                Write-Host "  $_" -ForegroundColor DarkGray
            }
        }

        return [pscustomobject]@{
            ExitCode   = $exitCode
            Output     = $lines
            OutputText = ($lines -join "`n")
        }
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Test-BackupExcluded {
    param([string]$RelativePath)

    $normalized = $RelativePath -replace '\\', '/'
    $segments = $normalized -split '/'

    foreach ($segment in $segments) {
        if ($script:ExcludeDirNames -contains $segment) {
            return $true
        }
    }

    $leaf = [System.IO.Path]::GetFileName($normalized)
    if ($leaf -like ".env*" -or $leaf -like "*.env") {
        return $true
    }

    foreach ($pattern in $script:ExcludeFilePatterns) {
        if ($leaf -like $pattern) {
            return $true
        }
    }

    if ($script:ExcludeFileNames -contains $leaf) {
        return $true
    }

    return $false
}

function Get-SafeRelativePath {
    param(
        [string]$FullPath,
        [string]$Root
    )

    try {
        $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        $normalizedFile = [System.IO.Path]::GetFullPath($FullPath)

        if (-not $normalizedFile.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return $null
        }

        return $normalizedFile.Substring($normalizedRoot.Length)
    }
    catch {
        return $null
    }
}

function Test-SupabaseBenignError {
    param([string]$OutputText)

    foreach ($pattern in $script:SupabaseBenignErrorPatterns) {
        if ($OutputText.IndexOf($pattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
        }
    }

    return $false
}

function Write-SupabaseSetupInstructions {
    Write-Warn "To enable automatic migrations:"
    Write-Host '    1. npx supabase init' -ForegroundColor DarkGray
    Write-Host '    2. npx supabase login' -ForegroundColor DarkGray
    Write-Host '    3. npx supabase link --project-ref YOUR_PROJECT_REF' -ForegroundColor DarkGray
    Write-Host '    4. Re-run: npm run safety:backup' -ForegroundColor DarkGray
}

function Protect-BackupsDirectory {
    param([string]$BackupsDir)

    $icacls = Get-Command icacls -ErrorAction SilentlyContinue
    if (-not $icacls) {
        Write-Warn "icacls not available; skipping backups/ ACL hardening."
        return
    }

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $grantArg = "`"${currentUser}:(OI)(CI)F`""
    $aclResult = Invoke-External -Command @(
        "icacls",
        $BackupsDir,
        "/inheritance:r",
        "/grant:r",
        $grantArg
    ) -Quiet

    if ($aclResult.ExitCode -ne 0) {
        Write-Warn "Could not restrict backups/ ACL (exit $($aclResult.ExitCode))."
        return
    }

    Write-Ok "Restricted backups/ folder ACL to $currentUser"
}

function Unquote-GitPath {
    param([string]$Path)

    $trimmed = $Path.Trim()
    if ($trimmed.Length -ge 2 -and $trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
        return $trimmed.Substring(1, $trimmed.Length - 2)
    }

    return $trimmed
}

function Get-ChangedGitPaths {
    param([string]$StatusText)

    $paths = New-Object System.Collections.Generic.List[string]
    foreach ($line in ($StatusText -split "`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line.Length -lt 3) {
            continue
        }

        $pathPart = $line.Substring(3).Trim()
        $resolvedPath = $null

        if ($pathPart -match '^"([^"]+)"\s+->\s+"([^"]+)"$') {
            $resolvedPath = $matches[2]
        }
        elseif ($pathPart -match '^(.+?)\s+->\s+(.+)$') {
            $resolvedPath = Unquote-GitPath -Path $matches[2]
        }
        else {
            $resolvedPath = Unquote-GitPath -Path $pathPart
        }

        if (-not [string]::IsNullOrWhiteSpace($resolvedPath)) {
            $paths.Add($resolvedPath)
        }
    }

    return $paths.ToArray()
}

function Test-SensitiveFileName {
    param([string]$RelativePath)

    $leaf = [System.IO.Path]::GetFileName(($RelativePath -replace '\\', '/'))
    if ($leaf -like ".env*" -or $leaf -like "*.env") {
        return $true
    }

    if ($leaf -like "*.pem" -or $leaf -like "*.key" -or $leaf -like "*.p12" -or $leaf -like "*.pfx") {
        return $true
    }

    if ($script:ExcludeFileNames -contains $leaf) {
        return $true
    }

    return $false
}

function Test-IsBinaryScanExtension {
    param([string]$RelativePath)

    $extension = [System.IO.Path]::GetExtension($RelativePath)
    if ([string]::IsNullOrWhiteSpace($extension)) {
        return $false
    }

    return $script:SecretScanBinaryExtensions -contains $extension.ToLowerInvariant()
}

function Test-ChangedFilesForSecrets {
    param(
        [string]$ProjectRoot,
        [string[]]$ChangedPaths
    )

    $findings = New-Object System.Collections.Generic.List[string]
    $warnings = New-Object System.Collections.Generic.List[string]

    foreach ($relativePath in $ChangedPaths) {
        $normalizedForSkip = $relativePath -replace '\\', '/'
        if ($script:SecretScanSkipPaths -contains $normalizedForSkip) {
            continue
        }

        if (Test-SensitiveFileName -RelativePath $relativePath) {
            $findings.Add("sensitive filename: $relativePath")
            continue
        }

        if (Test-IsBinaryScanExtension -RelativePath $relativePath) {
            $warnings.Add("skipped binary content scan: $relativePath")
            continue
        }

        $normalized = $relativePath -replace '/', '\'
        $fullPath = Join-Path $ProjectRoot $normalized
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            continue
        }

        try {
            $content = Get-Content -LiteralPath $fullPath -Raw -ErrorAction Stop
            foreach ($pattern in $script:SecretContentPatterns) {
                if ($content -match $pattern) {
                    $findings.Add("sensitive content in: $relativePath")
                    break
                }
            }
        }
        catch {
            $warnings.Add("could not scan: $relativePath ($($_.Exception.Message))")
        }
    }

    return [pscustomobject]@{
        Findings = $findings.ToArray()
        Warnings = $warnings.ToArray()
    }
}

function Get-BackupCandidateFiles {
    param(
        [string]$Directory,
        [string]$ProjectRoot
    )

    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    $errors = New-Object System.Collections.Generic.List[string]

    try {
        $children = Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop
    }
    catch {
        $errors.Add("Enumeration failed for ${Directory}: $($_.Exception.Message)")
        return [pscustomobject]@{
            Files  = @()
            Errors = $errors.ToArray()
        }
    }

    foreach ($item in $children) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            continue
        }

        $relative = Get-SafeRelativePath -FullPath $item.FullName -Root $ProjectRoot
        if ($null -eq $relative) {
            $errors.Add("Skipped path outside project root: $($item.FullName)")
            continue
        }

        if (Test-BackupExcluded -RelativePath $relative) {
            if ($item.PSIsContainer) {
                continue
            }
            continue
        }

        if ($item.PSIsContainer) {
            $nested = Get-BackupCandidateFiles -Directory $item.FullName -ProjectRoot $ProjectRoot
            foreach ($nestedFile in $nested.Files) {
                $files.Add($nestedFile)
            }
            foreach ($nestedError in $nested.Errors) {
                $errors.Add($nestedError)
            }
        }
        else {
            $canonicalRelative = Get-SafeRelativePath -FullPath $item.FullName -Root $ProjectRoot
            if ($null -eq $canonicalRelative) {
                $errors.Add("Skipped file outside project root: $($item.FullName)")
                continue
            }
            $files.Add($item)
        }
    }

    return [pscustomobject]@{
        Files  = $files.ToArray()
        Errors = $errors.ToArray()
    }
}

function New-ProjectBackupZip {
    param(
        [string]$ProjectRoot,
        [string]$ZipPath
    )

    $partialPath = "$ZipPath.partial"
    if (Test-Path $partialPath) {
        Remove-Item -LiteralPath $partialPath -Force
    }
    if (Test-Path $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zip = $null
    try {
        $candidateResult = Get-BackupCandidateFiles -Directory $ProjectRoot -ProjectRoot $ProjectRoot
        if ($candidateResult.Errors.Count -gt 0) {
            foreach ($enumError in $candidateResult.Errors) {
                Write-Warn $enumError
            }
            throw "Backup enumeration failed with $($candidateResult.Errors.Count) error(s)."
        }

        if ($candidateResult.Files.Count -eq 0) {
            throw "No files were eligible for backup."
        }

        $zip = [System.IO.Compression.ZipFile]::Open($partialPath, [System.IO.Compression.ZipArchiveMode]::Create)
        $added = 0

        foreach ($file in $candidateResult.Files) {
            $relative = Get-SafeRelativePath -FullPath $file.FullName -Root $ProjectRoot
            if ($null -eq $relative) {
                Write-Warn "Skipped file outside project root during zip: $($file.FullName)"
                continue
            }

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
    }
    catch {
        if ($null -ne $zip) {
            $zip.Dispose()
            $zip = $null
        }
        if (Test-Path $partialPath) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        }
        throw
    }
    finally {
        if ($null -ne $zip) {
            $zip.Dispose()
        }
    }

    try {
        Move-Item -LiteralPath $partialPath -Destination $ZipPath -Force
    }
    catch {
        if (Test-Path $partialPath) {
            Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        }
        throw "Failed to finalize backup archive: $($_.Exception.Message)"
    }

    return $added
}

# ---------------------------------------------------------------------------
# Main workflow
# ---------------------------------------------------------------------------

function Invoke-SafetyBackupWorkflow {
    $ScriptDir = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($ScriptDir)) {
        $ScriptDir = Split-Path -Parent $PSCommandPath
    }
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
    $CommitMessage = "chore: safety backup $Timestamp"

    $script:BackupPath = $null
    $script:BackupOutcome = "failed"
    $script:CommitOutcome = "skipped"
    $script:PushOutcome = "failed"
    $script:MigrationOutcome = "skipped"
    $script:SupabaseHardFailure = $false

    # Step 1: Zip backup
    Invoke-Step "Step 1/4: Create zip backup" {
        $BackupsDir = Join-Path $ProjectRoot "backups"
        if (-not (Test-Path $BackupsDir)) {
            New-Item -ItemType Directory -Path $BackupsDir | Out-Null
            Write-Ok "Created backups/ folder"
        }

        Protect-BackupsDirectory -BackupsDir $BackupsDir

        $ZipName = "truckeros-backup-$Timestamp.zip"
        $ZipPath = Join-Path $BackupsDir $ZipName

        $added = New-ProjectBackupZip -ProjectRoot $ProjectRoot -ZipPath $ZipPath
        $sizeMb = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 2)
        Write-Ok "Backup created: backups/$ZipName ($added files, ${sizeMb} MB)"
        $script:BackupPath = $ZipPath
        $script:BackupOutcome = "created ($added files, ${sizeMb} MB)"
    }

    # Step 2: Git commit
    Invoke-Step "Step 2/4: Git commit" {
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if (-not $gitCmd) {
            throw "git is not installed or not on PATH."
        }

        if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
            throw "Not a git repository (.git not found)."
        }

        $statusResult = Invoke-External -Command @("git", "status", "--porcelain") -Quiet
        if ($statusResult.ExitCode -ne 0) {
            throw "git status failed: $($statusResult.OutputText)"
        }

        if ([string]::IsNullOrWhiteSpace($statusResult.OutputText)) {
            Write-Skip "No changes to commit."
            $script:CommitOutcome = "skipped (clean working tree)"
            return
        }

        Write-Host "  Pending changes:" -ForegroundColor DarkGray
        $shortStatus = Invoke-External -Command @("git", "status", "--short")
        if ($shortStatus.ExitCode -ne 0) {
            throw "git status --short failed."
        }

        $changedPaths = Get-ChangedGitPaths -StatusText $statusResult.OutputText
        $secretScan = Test-ChangedFilesForSecrets -ProjectRoot $ProjectRoot -ChangedPaths $changedPaths
        foreach ($scanWarning in $secretScan.Warnings) {
            Write-Warn $scanWarning
        }
        if ($secretScan.Findings.Count -gt 0) {
            Write-Fail "Aborting commit: potential secrets detected in changed files."
            foreach ($finding in $secretScan.Findings) {
                Write-Host "    - $finding" -ForegroundColor Red
            }
            throw "Remove or gitignore sensitive files before running safety backup."
        }

        $addResult = Invoke-External -Command @("git", "add", "-A")
        if ($addResult.ExitCode -ne 0) {
            throw "git add failed."
        }

        $commitResult = Invoke-External -Command @("git", "commit", "-m", $CommitMessage)
        if ($commitResult.ExitCode -ne 0) {
            throw "git commit failed."
        }

        Write-Ok "Committed: $CommitMessage"
        $script:CommitOutcome = "committed ($CommitMessage)"
    }

    # Step 3: Git push to main
    Invoke-Step "Step 3/4: Git push to main" {
        $branchResult = Invoke-External -Command @("git", "rev-parse", "--abbrev-ref", "HEAD") -Quiet
        if ($branchResult.ExitCode -ne 0) {
            throw "Could not determine current branch: $($branchResult.OutputText)"
        }

        $currentBranch = $branchResult.OutputText.Trim()
        if ($currentBranch -eq "HEAD") {
            throw "Detached HEAD detected. Checkout branch 'main' before running safety backup."
        }

        if ($currentBranch -ne "main") {
            throw "Safety backup requires branch 'main'. Current branch: '$currentBranch'. Run: git checkout main"
        }

        $pushResult = Invoke-External -Command @("git", "push", "origin", "main")
        if ($pushResult.ExitCode -ne 0) {
            throw "git push origin main failed."
        }

        Write-Ok "Pushed to origin/main."
        $script:PushOutcome = "pushed to origin/main"
    }

    # Step 4: Supabase migrations
    Write-Step "Step 4/4: Supabase migrations"

    try {
        $ConfigToml = Join-Path $ProjectRoot (Join-Path "supabase" "config.toml")
        if (-not (Test-Path $ConfigToml)) {
            Write-Warn "supabase/config.toml not found - db push not attempted."
            Write-Warn "Step 4 attempts migrations only when CLI is initialized and linked (expected until first-time setup)."
            Write-SupabaseSetupInstructions
            Write-Warn "Apply migrations manually in the Supabase SQL editor until CLI is linked."
            $script:MigrationOutcome = "deferred (expected until init/login/link)"
        }
        else {
            $MigrationsDir = Join-Path $ProjectRoot (Join-Path "supabase" "migrations")
            if (Test-Path $MigrationsDir) {
                $migrationCount = (Get-ChildItem -Path $MigrationsDir -Filter "*.sql" -ErrorAction Stop).Count
                Write-Ok "Found $migrationCount migration file(s) in supabase/migrations/"
            }
            else {
                Write-Warn "No supabase/migrations folder found; db push may have nothing to apply."
            }

            $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
            if (-not $npxCmd) {
                Write-Warn "npx not found. Install Node.js/npm to run Supabase CLI."
                Write-Warn "Skipping db push."
                $script:MigrationOutcome = "skipped (npx not found)"
            }
            else {
                Write-Host "  Running: npx supabase db push" -ForegroundColor DarkGray
                $pushResult = Invoke-External -Command @("npx", "supabase", "db", "push")

                if ($pushResult.ExitCode -ne 0) {
                    if (Test-SupabaseBenignError -OutputText $pushResult.OutputText) {
                        Write-Warn "Supabase project is not linked or you are not logged in."
                        Write-SupabaseSetupInstructions
                        Write-Warn "Skipping db push (backup and git steps completed)."
                        $script:MigrationOutcome = "deferred (not linked or not logged in)"
                    }
                    else {
                        throw "npx supabase db push failed (exit $($pushResult.ExitCode)). $($pushResult.OutputText)"
                    }
                }
                else {
                    Write-Ok "Supabase migrations pushed successfully."
                    $script:MigrationOutcome = "pushed successfully"
                }
            }
        }
    }
    catch {
        $script:SupabaseHardFailure = $true
        Write-Fail "Supabase migration step failed."
        Write-Host $_.Exception.Message -ForegroundColor Red
        $script:MigrationOutcome = "failed ($($_.Exception.Message))"
    }

    # Summary
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    if ($script:SupabaseHardFailure) {
        Write-Host "  Safety backup failed during Supabase migrations" -ForegroundColor Red
    }
    else {
        Write-Host "  Safety backup workflow complete" -ForegroundColor Green
    }
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Command   : npm run safety:backup"
    Write-Host "  Timestamp : $Timestamp"
    if ($script:BackupPath) {
        Write-Host "  Backup    : $($script:BackupPath)"
    }
    Write-Host "  Step 1    : $($script:BackupOutcome)"
    Write-Host "  Step 2    : $($script:CommitOutcome)"
    Write-Host "  Step 3    : $($script:PushOutcome)"
    Write-Host "  Step 4    : $($script:MigrationOutcome)"
    Write-Host "  Confirm   : Complete SAFETY-CHECKLIST.md step 5 before major changes"
    Write-Host ""

    if ($script:SupabaseHardFailure) {
        exit 1
    }

    exit 0
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-SafetyBackupWorkflow
}