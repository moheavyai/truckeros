import { createBrowserClient } from '@supabase/ssr'

/**
 * Creates a Supabase client for use in Client Components ('use client').
 * This uses @supabase/ssr which properly handles auth token storage,
 * refresh tokens, and works reliably across page reloads and HMR.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
