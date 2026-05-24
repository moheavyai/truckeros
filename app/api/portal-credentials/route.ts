import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'
import { 
  generatePortalPrefill,
  compareRecommendedVsPortalRoute,
  createPortalSubmissionRecord 
} from '@/lib/portal-assistant'

// Server-only encryption helpers (AES-256-GCM)
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function encryptCredential(plainText: string, keyBase64: string): string {
  if (!keyBase64) throw new Error('PORTAL_CREDENTIALS_KEY is not configured')
  const key = Buffer.from(keyBase64, 'base64')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function decryptCredential(encryptedText: string, keyBase64: string): string {
  if (!keyBase64) throw new Error('PORTAL_CREDENTIALS_KEY is not configured')
  const key = Buffer.from(keyBase64, 'base64')
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const encryptionKey = process.env.PORTAL_CREDENTIALS_ENCRYPTION_KEY

/**
 * POST /api/portal-credentials
 *
 * Supports two modes:
 * 1. Save credentials (no "action" field)
 * 2. Framework actions: generate-prefill, compare-routes, record-submission
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, stateCode, username, password, requestData, portalOutput } = body

    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // === Mode 1: Save credentials ===
    if (!action) {
      if (!encryptionKey) {
        return NextResponse.json({ error: 'Missing encryption key' }, { status: 500 })
      }

      const encrypted = encryptCredential(password, encryptionKey)

      const { error } = await supabase
        .from('user_portal_credentials')
        .upsert({
          user_id: user.id,
          state_code: stateCode.toUpperCase(),
          username,
          password_encrypted: encrypted,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,state_code' })

      if (error) throw error

      return NextResponse.json({ success: true, message: 'Credentials saved securely' })
    }

    // === Mode 2: Framework actions ===
    if (action === 'generate-prefill') {
      const prefill = generatePortalPrefill(requestData, stateCode)
      return NextResponse.json({ prefill })
    }

    if (action === 'compare-routes') {
      const comparison = compareRecommendedVsPortalRoute(
        requestData.route_corridor,
        portalOutput?.route_corridor
      )
      return NextResponse.json({ comparison })
    }

    if (action === 'record-submission') {
      const record = createPortalSubmissionRecord(
        requestData.id,
        stateCode,
        generatePortalPrefill(requestData, stateCode),
        portalOutput
      )
      return NextResponse.json({ submission: record, message: 'Submission recorded (demo)' })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (error: any) {
    console.error('[portal-credentials] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * GET /api/portal-credentials?state=TX
 * Server-side only retrieval of decrypted credentials.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const stateCode = searchParams.get('state')?.toUpperCase()

  const authHeader = request.headers.get('authorization')
  if (!authHeader || !encryptionKey || !stateCode) {
    return NextResponse.json({ error: 'Unauthorized or missing params' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('user_portal_credentials')
    .select('*')
    .eq('user_id', user.id)
    .eq('state_code', stateCode)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'No credentials found for this state' }, { status: 404 })
  }

  try {
    const password = decryptCredential(data.password_encrypted, encryptionKey)
    return NextResponse.json({
      stateCode,
      username: data.username,
      password, // server only
      portalUrl: data.portal_url,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Decryption failed' }, { status: 500 })
  }
}


