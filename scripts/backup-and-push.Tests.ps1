. (Join-Path $PSScriptRoot "backup-and-push.ps1")

Describe "Test-BackupExcluded" {
    It "excludes node_modules anywhere in the path" {
        Test-BackupExcluded -RelativePath "src/node_modules/pkg/index.js" | Should Be $true
    }

    It "excludes .next build output" {
        Test-BackupExcluded -RelativePath ".next/cache/file" | Should Be $true
    }

    It "excludes backups folder" {
        Test-BackupExcluded -RelativePath "backups/archive.zip" | Should Be $true
    }

    It "excludes .git metadata" {
        Test-BackupExcluded -RelativePath ".git/config" | Should Be $true
    }

    It "excludes agent-tools, .supabase, and .pytest_cache" {
        Test-BackupExcluded -RelativePath "agent-tools/log.txt" | Should Be $true
        Test-BackupExcluded -RelativePath ".supabase/linked" | Should Be $true
        Test-BackupExcluded -RelativePath ".pytest_cache/v/cache" | Should Be $true
    }

    It "excludes .env files and production.env suffix" {
        Test-BackupExcluded -RelativePath ".env.local" | Should Be $true
        Test-BackupExcluded -RelativePath "config/.env.production" | Should Be $true
        Test-BackupExcluded -RelativePath "config/production.env" | Should Be $true
    }

    It "excludes secrets.json and secret file patterns" {
        Test-BackupExcluded -RelativePath "secrets.json" | Should Be $true
        Test-BackupExcluded -RelativePath "certs/server.pem" | Should Be $true
        Test-BackupExcluded -RelativePath "secrets/api.key" | Should Be $true
        Test-BackupExcluded -RelativePath "id_rsa" | Should Be $true
    }

    It "includes normal project files" {
        Test-BackupExcluded -RelativePath "package.json" | Should Be $false
        Test-BackupExcluded -RelativePath "app/page.tsx" | Should Be $false
        Test-BackupExcluded -RelativePath "lib/rev.env.ts" | Should Be $false
        Test-BackupExcluded -RelativePath "scripts/backup-and-push.ps1" | Should Be $false
    }
}

Describe "Test-SensitiveFileName" {
    It "flags env and secret leaf names only" {
        Test-SensitiveFileName -RelativePath ".env.local" | Should Be $true
        Test-SensitiveFileName -RelativePath "config/production.env" | Should Be $true
        Test-SensitiveFileName -RelativePath "secrets.json" | Should Be $true
        Test-SensitiveFileName -RelativePath "lib/rev.env.ts" | Should Be $false
    }
}

Describe "Get-ChangedGitPaths" {
    It "parses simple and quoted paths" {
        $status = @(
            ' M package.json'
            '?? "docs/my file.txt"'
        ) -join "`n"

        $paths = Get-ChangedGitPaths -StatusText $status
        ($paths -contains "package.json") | Should Be $true
        ($paths -contains "docs/my file.txt") | Should Be $true
    }

    It "handles rename lines and quoted renames" {
        $status = @(
            'R  old-name.ts -> new-name.ts'
            'R  "old dir/a.txt" -> "new dir/b.txt"'
        ) -join "`n"

        $paths = Get-ChangedGitPaths -StatusText $status
        ($paths -contains "new-name.ts") | Should Be $true
        ($paths -contains "new dir/b.txt") | Should Be $true
    }
}

Describe "Test-ChangedFilesForSecrets" {
    $testRoot = Join-Path $TestDrive "secret-scan"
    BeforeEach {
        if (Test-Path $testRoot) {
            Remove-Item -LiteralPath $testRoot -Recurse -Force
        }
        New-Item -ItemType Directory -Path $testRoot | Out-Null
    }

    It "detects sensitive content in text files" {
        $file = Join-Path $testRoot "notes.txt"
        Set-Content -LiteralPath $file -Value "SUPABASE_SERVICE_ROLE_KEY=abcdefghijklmnopqrstuvwxyz123456"
        $result = Test-ChangedFilesForSecrets -ProjectRoot $testRoot -ChangedPaths @("notes.txt")
        $result.Findings.Count | Should BeGreaterThan 0
    }

    It "does not abort on missing files" {
        $result = Test-ChangedFilesForSecrets -ProjectRoot $testRoot -ChangedPaths @("missing-file.txt")
        $result.Findings.Count | Should Be 0
        $result.Warnings.Count | Should Be 0
    }

    It "warns but does not abort on unreadable files" {
        $file = Join-Path $testRoot "locked.txt"
        Set-Content -LiteralPath $file -Value "temporary"
        $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        try {
            $result = Test-ChangedFilesForSecrets -ProjectRoot $testRoot -ChangedPaths @("locked.txt")
            $result.Findings.Count | Should Be 0
            ($result.Warnings -join ' ') | Should Match "could not scan"
        }
        finally {
            $stream.Dispose()
        }
    }

    It "skips binary extensions without aborting" {
        $file = Join-Path $testRoot "image.png"
        Set-Content -LiteralPath $file -Value "placeholder"
        $result = Test-ChangedFilesForSecrets -ProjectRoot $testRoot -ChangedPaths @("image.png")
        $result.Findings.Count | Should Be 0
        ($result.Warnings -join ' ') | Should Match "skipped binary content scan"
    }

    It "flags secrets.json by filename" {
        $result = Test-ChangedFilesForSecrets -ProjectRoot $testRoot -ChangedPaths @("secrets.json")
        $result.Findings.Count | Should BeGreaterThan 0
    }
}

Describe "Test-SupabaseBenignError" {
    It "detects link/login related errors" {
        Test-SupabaseBenignError -OutputText "project is not linked to a remote" | Should Be $true
        Test-SupabaseBenignError -OutputText "You are not logged in" | Should Be $true
    }

    It "does not treat real failures as benign" {
        Test-SupabaseBenignError -OutputText "migration 009 failed: syntax error" | Should Be $false
    }
}

Describe "Get-SafeRelativePath" {
    It "returns relative path for files under root" {
        $root = "C:\project"
        $result = Get-SafeRelativePath -FullPath "C:\project\app\page.tsx" -Root $root
        $result | Should Be "app\page.tsx"
    }

    It "returns null for paths outside root" {
        $root = "C:\project"
        Get-SafeRelativePath -FullPath "C:\other\secret.txt" -Root $root | Should Be $null
    }
}