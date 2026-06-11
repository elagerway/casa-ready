---
name: External Redirect
slug: external-redirect
zap_plugin_ids: [20019]
zap_alert_names:
  - "External Redirect"
cwe: 601
category: actionable
saq_section: "3.3"
saq_section_title: Input Validation
severity_override: null
fix_pattern: redirect-allowlist
---

# External Redirect

## What ZAP detects

ZAP's External Redirect active-scan rule (plugin 20019) injects attacker-controlled URLs into request parameters and checks whether the response redirects to them — via a `Location` header (3xx), a `Refresh` header, or a client-side `window.location` / `meta refresh`. On an OAuth callback handler, the most common injection point is a `redirect_uri` / `next` / `returnTo` parameter that the handler uses to decide where to send the user after processing the callback.

## Why this is "Actionable" for CASA

CASA Tier 2 (input validation) requires that redirect targets derived from user input be validated against a server-side allowlist. An open redirect on a callback handler is a real attack primitive: an attacker crafts a link to your trusted domain that silently bounces the authenticated user to a phishing site, or chains with OAuth to leak tokens. It is a code fix, not an SAQ explanation — the handler must stop trusting the parameter.

## Standard fix pattern

Never pass a request-derived value straight into a redirect. Validate against an allowlist of known-safe destinations, and fall back to a safe default:

```javascript
const SAFE_REDIRECTS = new Set([
  '/dashboard',
  '/account',
]);

function safeRedirectTarget(raw) {
  // Only allow same-site, allowlisted paths. Reject absolute URLs outright.
  if (typeof raw !== 'string' || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
    return '/dashboard';
  }
  return SAFE_REDIRECTS.has(raw) ? raw : '/dashboard';
}

// in the callback handler:
res.redirect(safeRedirectTarget(req.query.redirect_uri));
```

The exact-match allowlist is what makes this safe — do not downgrade it to prefix/`startsWith` matching, which is bypassable via backslashes (`/\evil.com`), single-slash schemes (`https:/evil.com`), and tab/newline tricks.

For OAuth specifically, prefer carrying post-login destination in signed server-side state (the `state` parameter you already validate) rather than a free-form `redirect_uri` on the callback.

## How to spot the source in your code

Grep patterns:
- `res\.redirect\(` (Express) / `redirect(` (framework helpers)
- `Location:` header set from a request value
- `window\.location\s*=` driven by a query param
- `NextResponse\.redirect\(` / `redirect\(` (Next.js)
- `meta http-equiv="refresh"` / `Refresh:` header set from a request value
- `redirect_uri`, `returnTo`, `next`, `continue`, `url=` parameters read in the callback handler

Common locations:
- The OAuth/OIDC callback route (`/auth/*/callback`)
- Generic "login then return to where you were" middleware
- Logout handlers that accept a post-logout redirect

## SAQ answer template (only if you cannot ship the fix before submission)

> The redirect target in `<FILE_PATH>` is derived from the `<PARAM>` parameter. We validate it against a same-site allowlist in `<FUNCTION>`; absolute and off-site URLs fall back to `<DEFAULT_PATH>`. The fix is tracked in `<ISSUE_ID>`, scheduled for `<DATE>`.

(Note: TAC reviewers prefer the actual fix. Use this template only when timing genuinely blocks the fix from landing pre-submission.)
