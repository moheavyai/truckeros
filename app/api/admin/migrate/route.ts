import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const MIGRATION_SQL = `ALTER TABLE IF EXISTS permit_requests
  ADD COLUMN IF NOT EXISTS cost_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS distance_miles NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(6,2);`.trim()

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({ 
      hasAdmin: false, 
      columnsExist: null,
      message: 'No service role key found' 
    })
  }

  try {
    // Try to select the new columns — this will fail if they don't exist
    const { error } = await supabaseAdmin
      .from('permit_requests')
      .select('cost_breakdown, distance_miles, duration_hours')
      .limit(1)

    const columnsExist = !error

    return NextResponse.json({
      hasAdmin: true,
      columnsExist,
      needsMigration: !columnsExist,
      error: error?.message || null,
    })
  } catch (err: any) {
    return NextResponse.json({
      hasAdmin: true,
      columnsExist: false,
      needsMigration: true,
      error: err.message,
    })
  }
}

export async function POST() {
  // We cannot reliably run raw ALTER TABLE from the JS client without a custom RPC.
  // Instead, we return the exact SQL the user should run.
  return NextResponse.json({
    success: false,
    needsManualRun: true,
    sql: MIGRATION_SQL,
    instructions: [
      '1. Go to your Supabase Dashboard',
      '2. Open the SQL Editor',
      '3. Paste the SQL above and click "Run"',
      '4. Refresh this page — it should now detect the columns'
    ],
  })
}
