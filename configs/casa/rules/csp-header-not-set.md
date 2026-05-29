---
name: Content Security Policy (CSP) Header Not Set
slug: csp-header-not-set
zap_plugin_ids: [10038]
zap_alert_names:
  - "Content Security Policy (CSP) Header Not Set"
  - "CSP: Wildcard Directive"
cwe: 693
category: actionable
saq_section: "2.3"
saq_section_title: Browser Security Headers
severity_override: null
fix_pattern: csp-header
---

# Content Security Policy (CSP) Header Not Set

## What ZAP detects

ZAP fires this alert when an HTTP response (HTML, typically) lacks a `Content-Security-Policy` header, or has one with overly-permissive directives (e.g., `default-src *`, `script-src 'unsafe-inline' 'unsafe-eval'`).

## Why this is "Actionable" for CASA

CSP is the single most effective browser-side defense against XSS. CASA Tier 2 §2.3 (Browser Security Headers) expects production responses to include a meaningful CSP. A missing CSP is a real defense gap; a wildcard CSP is barely better than nothing.

## Standard fix pattern

For a SPA with a known set of trusted domains:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'sha256-<INLINE_HASH>' https://js.stripe.com https://www.googletagmanager.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' https://*.supabase.co https://api.your-app.com;
  frame-src https://js.stripe.com;
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
  object-src 'none';
```

Set this in your web server (nginx `add_header Content-Security-Policy "..."`), CDN (Cloudflare Page Rules), or framework (Next.js `headers()` in `next.config.js`, Express `helmet()` middleware).

For a strict CSP without `unsafe-inline`: use nonces or hashes for inline scripts/styles. Frameworks like Next.js, SvelteKit, and Remix support nonce-based CSP out of the box.

**Test the CSP in report-only mode first:**

```
Content-Security-Policy-Report-Only: <your full policy>; report-uri /csp-report
```

Run for a week, collect violations from the report endpoint, refine the policy until clean, then switch to enforcing mode.

## How to spot the source in your code

For the absence of CSP, you're looking for the *missing* header, not its presence:

```bash
curl -I https://your-app.com/ | grep -i content-security-policy
# (no output = the header is missing)
```

To find the *right place to add it*, check in this order:
1. CDN config (Cloudflare workers, AWS CloudFront response headers policy)
2. Web server config (`nginx.conf`, Apache `.htaccess`, Caddy `Caddyfile`)
3. Framework middleware (Next.js `next.config.js` headers, Express `helmet()`, Astro middleware)
4. Static hosting config (Netlify `_headers` file, Vercel `vercel.json`)

For each layer, grep for `Content-Security-Policy` to see if it's set anywhere. If multiple layers set it, the closest-to-user wins.

## SAQ answer template (rare — better to ship the fix)

> Our Content-Security-Policy is enforced via `<MECHANISM>` (e.g., Cloudflare Page Rules, nginx config). The current policy is: `<POLICY VALUE>`. We are tracking the deployment of a stricter policy in `<ISSUE_ID>`.

(If submitting *without* a CSP header at all, this answer will not pass review — implement the fix.)
