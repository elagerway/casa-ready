---
name: X-Frame-Options Header Not Set
slug: x-frame-options-not-set
zap_plugin_ids: [10020]
zap_alert_names:
  - "X-Frame-Options Header Not Set"
  - "Anti-clickjacking Header"
cwe: 1021
category: actionable
saq_section: "2.3"
saq_section_title: Browser Security Headers
severity_override: null
fix_pattern: frame-options-header
---

# X-Frame-Options Header Not Set

## What ZAP detects

ZAP flags HTML responses that lack the `X-Frame-Options` header (and lack the `frame-ancestors` directive in CSP). Without this header, your site can be embedded in an `<iframe>` on a malicious site, enabling clickjacking attacks.

## Why this is "Actionable" for CASA

CASA Tier 2 §2.3 expects clickjacking protection. Either `X-Frame-Options` or `Content-Security-Policy: frame-ancestors` satisfies it. (The latter is more flexible and is the modern preference; `X-Frame-Options` is the older mechanism but still respected by all browsers.)

If your CSP already includes `frame-ancestors 'none'` (or `'self'`), you can skip `X-Frame-Options` — but ZAP doesn't know that, so it'll flag the missing header anyway. The triage skill should detect this case and reclassify to noise.

## Standard fix pattern

Set one of these (preferring CSP if you're already setting one):

**Via CSP (preferred):**

```
Content-Security-Policy: frame-ancestors 'none';
```

(Or `'self'` if your own pages legitimately frame each other.)

**Via dedicated header:**

```
X-Frame-Options: DENY
```

(Or `SAMEORIGIN` if your own pages legitimately frame each other.)

In nginx:

```
add_header X-Frame-Options "DENY" always;
```

In Express:

```javascript
import helmet from 'helmet';
app.use(helmet.frameguard({ action: 'deny' }));
```

In Next.js (`next.config.js`):

```javascript
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      // OR include frame-ancestors in your CSP
    ],
  }];
}
```

## How to spot the source in your code

```bash
curl -I https://your-app.com/ | grep -iE 'x-frame-options|content-security-policy'
```

If neither is set, add either one to your response-header config layer (CDN, web server, framework middleware, static hosting headers file).

## When the finding is noise

If your CSP includes `frame-ancestors 'none'` or `frame-ancestors 'self'`, modern browsers will use that and the dedicated `X-Frame-Options` header is redundant. The triage skill should reclassify this finding to noise in that case (and surface the reasoning to the user).

## SAQ answer template (rare)

> Clickjacking protection is provided via `<MECHANISM>` — either `X-Frame-Options: <VALUE>` or `Content-Security-Policy: frame-ancestors <VALUE>`. The instances flagged by ZAP at `<URLs>` were `<EXPLAIN>`.
