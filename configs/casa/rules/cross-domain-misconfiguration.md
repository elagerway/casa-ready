---
name: Cross-Domain Misconfiguration
slug: cross-domain-misconfiguration
zap_plugin_ids: [10098]
zap_alert_names:
  - "Cross-Domain Misconfiguration"
cwe: 264
category: actionable
saq_section: "2.4"
saq_section_title: Network Security
severity_override: null
fix_pattern: cors-allowlist
---

# Cross-Domain Misconfiguration

## What ZAP detects

ZAP flags any HTTP response with `Access-Control-Allow-Origin: *` (wildcard) or with ACAO matching the request's `Origin` header without a server-side allowlist check. The check fires on responses that include CORS headers — typically API endpoints, but also any HTML/JS resource that opts into cross-origin reads.

## Why this is "Actionable" for CASA

CASA Tier 2 §2.4 (Network Security) requires that authenticated endpoints not expose their responses to arbitrary origins. Wildcard CORS on an endpoint that returns user data is a real cross-origin information leak: any malicious site the user visits can issue a `fetch()` against your API and read the response (provided the user is authenticated via a cookie session — the wildcard explicitly disables the browser's same-origin protection).

## Standard fix pattern

Replace wildcard CORS with an allowlist function. For Supabase Edge Functions, the canonical pattern is:

```typescript
// supabase/functions/_shared/cors.ts
const ALLOWED_ORIGINS = [
  'https://your-app.com',
  'https://staging.your-app.com',
  'http://localhost:3000',
];

export function buildCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}
```

Then at each edge function entry point, call `buildCorsHeaders(req.headers.get('origin'))` and merge into the response headers.

For Express/Node:

```javascript
import cors from 'cors';
const ALLOWED_ORIGINS = ['https://your-app.com', 'http://localhost:3000'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
```

The `Vary: Origin` header is critical — without it, intermediary caches will serve the wrong CORS response to a different origin.

## How to spot the source in your code

Grep patterns:
- `Access-Control-Allow-Origin.*\*`
- `'Access-Control-Allow-Origin': '\*'`
- `"Access-Control-Allow-Origin": "\*"`
- `cors\(\)` (default `cors` package config is wildcard)

Common locations:
- Shared CORS module (look for `_shared/cors.ts`, `middleware/cors.js`, `utils/cors.go`)
- Individual route handlers
- Middleware/edge function setup
- API gateway / reverse proxy config (nginx `add_header`, Cloudflare workers, etc.)

## SAQ answer template (only if you cannot ship the fix before submission)

> Our CORS policy is implemented in `<FILE_PATH>`. The endpoint at `<URL>` currently returns a wildcard `Access-Control-Allow-Origin` header for `<REASON>`. We are tracking the migration to a per-origin allowlist in `<ISSUE_ID>`, scheduled for `<DATE>`.

(Note: TAC reviewers prefer the actual fix. Use this template only when timing genuinely blocks the fix from landing pre-submission.)
