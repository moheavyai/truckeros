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

    It "excludes agent-tools and .supabase" {
        Test-BackupExcluded -RelativePath "agent-tools/log.txt" | Should Be $true
        Test-BackupExcluded -RelativePath ".supabase/linked" | Should Be $true
    }

    It "excludes .env files" {
        Test-BackupExcluded -RelativePath ".env.local" | Should Be $true
        Test-BackupExcluded -RelativePath "config/.env.production" | Should Be $true
    }

    It "excludes secret file patterns" {
        Test-BackupExcluded -RelativePath "certs/server.pem" | Should Be $true
        Test-BackupExcluded -RelativePath "secrets/api.key" | Should Be $true
        Test-BackupExcluded -RelativePath "id_rsa" | Should Be $true
    }

    It "includes normal project files" {
        Test-BackupExcluded -RelativePath "package.json" | Should Be $false
        Test-BackupExcluded -RelativePath "app/page.tsx" | Should Be $false
        Test-BackupExcluded -RelativePath "scripts/backup-and-push.ps1" | Should Be $false
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