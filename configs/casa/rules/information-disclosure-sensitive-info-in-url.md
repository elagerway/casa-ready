---
name: Information Disclosure - Sensitive Information in URL
slug: information-disclosure-sensitive-info-in-url
zap_plugin_ids: [10024]
zap_alert_names:
  - "Information Disclosure - Sensitive Information in URL"
cwe: 598
category: actionable
saq_section: "3.2"
saq_section_title: Information Disclosure
severity_override: null
fix_pattern: post-body-not-query-string
---

# Information Disclosure - Sensitive Information in URL

## What ZAP detects

ZAP inspects request URLs (path + query string) for substrings that look like sensitive data: `password=`, `token=`, `apikey=`, `session=`, `auth=`, credit-card-shaped numbers, email addresses with credentials embedded, etc.

## Why this is "Actionable" for CASA

URLs are logged in many places where bodies are not: web server access logs, browser history, proxy server logs, CDN logs, Referer headers sent to third parties, analytics tools. Putting credentials, tokens, or PII in a URL means leaking them to all of these systems.

CASA Tier 2 §3.2 (Information Disclosure) considers this a real information leak and expects sensitive data to travel in request bodies (POST/PUT) or headers (Authorization), never query strings.

## Standard fix pattern

Move the sensitive parameter from the URL to the request body or header:

```javascript
// Before (BAD)
fetch(`/api/login?password=${pw}&user=${u}`);

// After (GOOD)
fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: u, password: pw }),
});
```

For OAuth-style tokens, use the `Authorization: Bearer <token>` header pattern instead of `?token=...`.

For password-reset / email-verification links: use a single-use, time-limited, opaque token in the URL (not the user's actual credentials), and exchange it server-side for the verification action.

## How to spot the source in your code

Grep patterns:
- `\?password=`
- `\?token=`
- `\?apikey=`
- `\?api_key=`
- `\?session=`
- URL builders that interpolate auth params: `\$\{token\}` or `\$\{password\}` inside template literals that look like URLs

Common locations:
- Client-side auth flows (login, password reset, magic-link)
- OAuth callback handlers (the auth code in `?code=...` is acceptable; long-lived secrets are not)
- API endpoints accepting credentials
- Any redirect URL that includes a session identifier

Note: a query-string parameter like `?page=2` or `?filter=active` is NOT this finding. Only authenticator/secret material qualifies.

## SAQ answer template (only if instance is actually safe)

If ZAP flagged a parameter that is not actually sensitive (e.g., a non-secret enum value with a name like `token` for a UI tab):

> The parameter `<PARAM>` flagged at `<URL>` is not a credential or secret — it is a `<DESCRIBE: UI state token / non-secret correlation ID / etc.>`. We confirm no actual secret material travels in our URLs.
