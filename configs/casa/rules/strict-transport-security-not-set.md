---
name: Strict-Transport-Security Header Not Set
slug: strict-transport-security-not-set
zap_plugin_ids: [10035]
zap_alert_names:
  - "Strict-Transport-Security Header Not Set"
cwe: 319
category: actionable
saq_section: "2.3"
saq_section_title: Browser Security Headers
severity_override: null
fix_pattern: hsts-header
---

# Strict-Transport-Security Header Not Set

## What ZAP detects

ZAP flags HTTPS responses that lack the `Strict-Transport-Security` (HSTS) header. HSTS instructs browsers to ONLY connect to your site via HTTPS for a specified duration, defending against SSL-stripping and HTTPS-downgrade attacks.

## Why this is "Actionable" for CASA

CASA Tier 2 §2.3 expects HSTS on all HTTPS endpoints. Without it, a user on an untrusted network (coffee shop wifi, hotel) can be transparently downgraded to HTTP by a man-in-the-middle and have their session cookies stolen.

## Standard fix pattern

Add the HSTS header to all HTTPS responses:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Recommended initial deployment:

1. Start with a short `max-age` (e.g., `300` = 5 minutes) for a day or two to verify nothing breaks
2. Increase to `86400` (1 day) for a week
3. Then set to `31536000` (1 year)
4. Once stable for months, consider adding `preload` and submitting to https://hstspreload.org

In nginx:

```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

In Express:

```javascript
import helmet from 'helmet';
app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
```

In Next.js (`next.config.js`):

```javascript
async headers() {
  return [{
    source: '/(.*)',
    headers: [{
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    }],
  }];
}
```

In Cloudflare: SSL/TLS → Edge Certificates → HSTS Settings (built-in toggle).

## How to spot the source in your code

```bash
curl -I https://your-app.com/ | grep -i strict-transport-security
```

Same layer-discovery as CSP/nosniff. Note: HSTS only applies on HTTPS responses — the header on an HTTP response is ignored by browsers (and that's by design, to prevent attackers from setting it via MITM).

## Caution

`includeSubDomains` is a one-way commitment: once a browser caches it, the user cannot visit `http://anything.your-app.com` for the cache duration (up to `max-age`). Verify all subdomains are HTTPS-ready before enabling `includeSubDomains`.

## SAQ answer template (rare)

> HSTS is configured at `<MECHANISM>` with `max-age=<VALUE>` and `<INCLUDESUBDOMAINS_OR_NOT>`. Endpoints flagged by ZAP at `<URLs>` were `<EXPLAIN>`.
