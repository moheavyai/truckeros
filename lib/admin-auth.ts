import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

export function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminUser(user: User): boolean {
  if (user.app_metadata?.role === 'admin') {
    return true
  }

  const email = user.email?.toLowerCase()
  if (!email) {
    return false
  }

  return parseAdminEmails().includes(email)
}

export async function requireAdminUser(): Promise<
  { user: User } | { response: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!isAdminUser(user)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}