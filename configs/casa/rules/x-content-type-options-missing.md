---
name: X-Content-Type-Options Header Missing
slug: x-content-type-options-missing
zap_plugin_ids: [10021]
zap_alert_names:
  - "X-Content-Type-Options Header Missing"
cwe: 693
category: actionable
saq_section: "2.3"
saq_section_title: Browser Security Headers
severity_override: null
fix_pattern: nosniff-header
---

# X-Content-Type-Options Header Missing

## What ZAP detects

ZAP flags responses that lack the `X-Content-Type-Options: nosniff` header. This header instructs browsers not to MIME-sniff content, preventing certain content-type confusion attacks (e.g., an uploaded `.txt` containing `<script>` getting executed as JavaScript).

## Why this is "Actionable" for CASA

CASA Tier 2 §2.3 expects standard browser security headers to be set. `X-Content-Type-Options: nosniff` is the cheapest of all of them — one header, no policy decisions, applies to every response. Missing it is a clear gap.

## Standard fix pattern

Add to every response:

```
X-Content-Type-Options: nosniff
```

In nginx:

```
add_header X-Content-Type-Options "nosniff" always;
```

In Express (`helmet` includes it by default):

```javascript
import helmet from 'helmet';
app.use(helmet.noSniff());
```

In Next.js (`next.config.js`):

```javascript
async headers() {
  return [{
    source: '/(.*)',
    headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
  }];
}
```

In Cloudflare: Page Rule → "Browser Integrity Check" related; or use a Workers script to inject it.

## How to spot the source in your code

Same approach as CSP:

```bash
curl -I https://your-app.com/ | grep -i x-content-type-options
```

Find the response-header config layer (CDN > web server > framework middleware > static hosting headers file) and add `X-Content-Type-Options: nosniff`.

## SAQ answer template (rare)

> The `X-Content-Type-Options: nosniff` header is set by `<MECHANISM>` on all responses. The instances flagged by ZAP at `<URLs>` were `<EXPLAIN>` (e.g., served by a third-party endpoint we proxy through, fixed in `<ISSUE_ID>`).
