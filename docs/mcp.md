# MoHeavy MCP (Model Context Protocol)

Remote MCP endpoint so external Grok bots and other agents can run the Permit Engine with org-scoped API keys.

## Endpoint

| | |
|--|--|
| **URL** | `https://moheavy.com/api/mcp` |
| **Transport** | Streamable HTTP (JSON-RPC 2.0 over POST) |
| **Auth** | `Authorization: Bearer mh_live_…` |
| **Keys** | Create at `/settings/api-keys` (Owner/Admin) |

## Tool: `analyze_permit`

Analyzes an OSOW load for corridor, permits, escorts, DOT notes, and cost.

**Required:** `origin` (city + state), `destination` (city + state), `weight`, `length`, `width`, `height`

**Optional:** street/zip/query, `originLat`/`originLon`/`destinationLat`/`destinationLon` (highway waypoints), `specialInstructions`

City/state is geocoded server-side. Explicit coordinates always win.

## Smoke (curl)

### 1. Discover

```bash
curl https://moheavy.com/api/mcp
```

### 2. List tools

```bash
curl -X POST https://moheavy.com/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mh_live_YOUR_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 3. Call analyze_permit

```bash
curl -X POST https://moheavy.com/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mh_live_YOUR_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "analyze_permit",
      "arguments": {
        "origin": { "city": "Kansas City", "state": "MO" },
        "destination": { "city": "St Louis", "state": "MO" },
        "weight": 120000,
        "length": 80,
        "width": 12,
        "height": 14
      }
    }
  }'
```

## Client config examples

### Cursor / Claude Desktop style (HTTP MCP)

```json
{
  "mcpServers": {
    "moheavy-permit": {
      "url": "https://moheavy.com/api/mcp",
      "headers": {
        "Authorization": "Bearer mh_live_YOUR_KEY"
      }
    }
  }
}
```

Exact client field names vary by host; the important pieces are the **URL** and the **Bearer API key**.

### Grok / xAI agents

Point the remote MCP / tool connector at:

- URL: `https://moheavy.com/api/mcp`
- Header: `Authorization: Bearer mh_live_…`

The agent will see tool `analyze_permit` and can pass city/state loads without pre-geocoding.

## Security

- Keys are org-scoped and hashed at rest
- Scope required: `analyze_permit`
- Revoke keys anytime at `/settings/api-keys`
- Never commit live keys to git or share them in chat
