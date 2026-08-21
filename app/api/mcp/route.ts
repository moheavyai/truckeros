/**
 * POST /api/mcp — Model Context Protocol (Streamable HTTP, stateless)
 *
 * External agents (Grok bots, Claude, Cursor) call MoHeavy tools with:
 *   Authorization: Bearer mh_live_...
 *
 * JSON-RPC methods: initialize | notifications/initialized | tools/list | tools/call | ping
 * Tool: analyze_permit
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAgentRequest,
  recordAgentUsage,
} from '@/lib/agent-api-auth'
import { runAnalyzePermit } from '@/lib/agent-analyze-permit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = {
  name: 'moheavy-permit-engine',
  version: '1.0.0',
}

const ANALYZE_PERMIT_TOOL = {
  name: 'analyze_permit',
  description:
    'Analyze an oversize/overweight (OSOW) truck load for US state permit requirements, corridor, escorts, DOT restrictions, and estimated costs. Geocodes city/state automatically; pass lat/lon when targeting a specific highway waypoint.',
  inputSchema: {
    type: 'object',
    properties: {
      origin: {
        type: 'object',
        description: 'Pickup location',
        properties: {
          city: { type: 'string', description: 'City name' },
          state: {
            type: 'string',
            description: 'Two-letter US state code, e.g. MO',
          },
          street: { type: 'string', description: 'Optional street address' },
          zip: { type: 'string', description: 'Optional ZIP code' },
          query: {
            type: 'string',
            description: 'Optional free-text address query',
          },
        },
        required: ['city', 'state'],
      },
      destination: {
        type: 'object',
        description: 'Delivery location',
        properties: {
          city: { type: 'string' },
          state: { type: 'string', description: 'Two-letter US state code' },
          street: { type: 'string' },
          zip: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['city', 'state'],
      },
      weight: {
        type: 'number',
        description: 'Gross loaded weight in pounds',
      },
      length: { type: 'number', description: 'Overall length in feet' },
      width: { type: 'number', description: 'Overall width in feet' },
      height: { type: 'number', description: 'Overall height in feet' },
      originLat: {
        type: 'number',
        description:
          'Optional origin latitude (overrides geocode; use for highway waypoints)',
      },
      originLon: { type: 'number', description: 'Optional origin longitude' },
      destinationLat: {
        type: 'number',
        description: 'Optional destination latitude (overrides geocode)',
      },
      destinationLon: {
        type: 'number',
        description: 'Optional destination longitude',
      },
      specialInstructions: {
        type: 'string',
        description: 'Optional routing preferences (avoid states, prefer highways)',
      },
    },
    required: ['origin', 'destination', 'weight', 'length', 'width', 'height'],
  },
}

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: data !== undefined ? { code, message, data } : { code, message },
  }
}

function mcpToolText(payload: unknown) {
  return {
    content: [
      {
        type: 'text',
        text:
          typeof payload === 'string'
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  }
}

async function handleToolsCall(
  request: NextRequest,
  params: Record<string, unknown> | undefined,
  id: JsonRpcId
) {
  const started = Date.now()
  const toolName = typeof params?.name === 'string' ? params.name : ''
  const args =
    params?.arguments && typeof params.arguments === 'object'
      ? (params.arguments as Record<string, unknown>)
      : {}

  const auth = await authenticateAgentRequest(request)
  if (auth.ok === false) {
    return {
      status: auth.status,
      body: jsonRpcError(id, -32001, auth.error),
    }
  }

  if (toolName !== 'analyze_permit') {
    return {
      status: 200,
      body: jsonRpcError(id, -32601, `Unknown tool: ${toolName || '(missing)'}`),
    }
  }

  if (!auth.scopes.includes('analyze_permit')) {
    void recordAgentUsage({
      organizationId: auth.organizationId,
      apiKeyId: auth.apiKeyId,
      tool: 'analyze_permit',
      statusCode: 403,
      latencyMs: Date.now() - started,
      requestId: request.headers.get('x-request-id'),
    })
    return {
      status: 200,
      body: jsonRpcError(id, -32003, 'API key is missing required scope: analyze_permit'),
    }
  }

  try {
    const outcome = await runAnalyzePermit(args)
    const latencyMs = Date.now() - started

    if (outcome.ok === false) {
      void recordAgentUsage({
        organizationId: auth.organizationId,
        apiKeyId: auth.apiKeyId,
        tool: 'analyze_permit',
        statusCode: outcome.status,
        latencyMs,
        requestId: request.headers.get('x-request-id'),
      })
      return {
        status: 200,
        body: jsonRpcResult(
          id,
          mcpToolText({
            ok: false,
            error: outcome.error,
            geocode: outcome.geocode,
          })
        ),
      }
    }

    void recordAgentUsage({
      organizationId: auth.organizationId,
      apiKeyId: auth.apiKeyId,
      tool: 'analyze_permit',
      statusCode: 200,
      latencyMs,
      requestId: request.headers.get('x-request-id'),
    })

    return {
      status: 200,
      body: jsonRpcResult(
        id,
        mcpToolText({
          ok: true,
          tool: 'analyze_permit',
          organization_id: auth.organizationId,
          geocode: outcome.geocode,
          result: outcome.result,
        })
      ),
    }
  } catch (err: any) {
    void recordAgentUsage({
      organizationId: auth.organizationId,
      apiKeyId: auth.apiKeyId,
      tool: 'analyze_permit',
      statusCode: 500,
      latencyMs: Date.now() - started,
      requestId: request.headers.get('x-request-id'),
    })
    return {
      status: 200,
      body: jsonRpcError(id, -32000, err?.message || 'Permit analysis failed'),
    }
  }
}

async function dispatch(
  request: NextRequest,
  rpc: JsonRpcRequest
): Promise<{ status: number; body: unknown }> {
  const id = rpc.id ?? null
  const method = rpc.method || ''

  switch (method) {
    case 'initialize':
      return {
        status: 200,
        body: jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: SERVER_INFO,
        }),
      }

    case 'notifications/initialized':
    case 'initialized':
      return { status: 200, body: jsonRpcResult(id, {}) }

    case 'ping':
      return { status: 200, body: jsonRpcResult(id, {}) }

    case 'tools/list':
      return {
        status: 200,
        body: jsonRpcResult(id, { tools: [ANALYZE_PERMIT_TOOL] }),
      }

    case 'tools/call':
      return handleToolsCall(request, rpc.params, id)

    default:
      return {
        status: 200,
        body: jsonRpcError(id, -32601, `Method not found: ${method}`),
      }
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      jsonRpcError(null, -32700, 'Parse error: invalid JSON'),
      { status: 400 }
    )
  }

  if (Array.isArray(payload)) {
    const results = []
    for (const item of payload) {
      const { body } = await dispatch(request, (item || {}) as JsonRpcRequest)
      results.push(body)
    }
    return NextResponse.json(results, {
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
      },
    })
  }

  const { status, body } = await dispatch(
    request,
    (payload || {}) as JsonRpcRequest
  )

  return NextResponse.json(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    },
  })
}

/** Discovery / health for MCP clients that probe with GET */
export async function GET() {
  return NextResponse.json(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocolVersion: PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: '/api/mcp',
      auth: 'Authorization: Bearer mh_live_… (org API key from /settings/api-keys)',
      tools: ['analyze_permit'],
    },
    {
      headers: { 'MCP-Protocol-Version': PROTOCOL_VERSION },
    }
  )
}
