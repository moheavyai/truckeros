import { createClient } from '@supabase/supabase-js'
import { createClient as createBrowserClient } from './supabase/client'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * Browser Supabase client (using @supabase/ssr for reliable auth tokens).
 *
 * For new code in Client Components, prefer:
 *   import { createClient } from '@/lib/supabase/client'
 *   const supabase = createClient()
 *
 * This export is kept for backward compatibility. On the server it falls back
 * to a basic anon client (sufficient for public data like state_permit_rules).
 */
export const supabase =
  typeof window !== 'undefined'
    ? createBrowserClient()
    : createClient(supabaseUrl, supabaseAnonKey)

/**
 * Server client factory for Route Handlers and server-only code.
 * New code should prefer: import { createClient } from '@/lib/supabase/server'
 */
export { createClient as createServerClient } from './supabase/server'

/**
 * Admin client using the Service Role key (bypasses RLS).
 * Only use this server-side. Never expose the service role key to the browser.
 */
export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
  : null

export const hasAdminAccess = !!supabaseAdmin