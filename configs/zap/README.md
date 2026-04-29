# OWASP ZAP CWE Policy Files

This directory will hold the CASA-mapped OWASP ZAP scan policy files.

## What goes here

The App Defense Alliance publishes a CWE-mapped ZAP configuration as part of the official Tier 2 tooling. Source: <https://appdefensealliance.dev/casa/tier-2/tooling-matrix>.

**To populate:** download the official ADA ZAP config (referenced in your CASA notification email) and commit it here, plus any CASA Ready overlays we add for specific app archetypes (SPA, API-only, mobile-backend, etc.).

## Why we vendor these

The official location of the configs has moved at least once (legacy `appdefensealliance-dev/ASA` → current `appdefensealliance/ASA-WG`). Vendoring keeps us reproducible.

## Status

- `form-context-template.xml` — V1.1 ZAP context for `auth.type: 'form'`. `{{var}}` placeholders are substituted by `cli/lib/auth/form.js` via the `renderContext` primitive in `cli/lib/zap-context.js`.
- `supabase-jwt-context-template.xml` — V1.1 ZAP context for `auth.type: 'supabase-jwt'`. Uses ZAP type=4 (script-based auth); references the script below.
- `supabase-jwt-script.js` — V1.1 vendored Nashorn JS that ZAP runs at scan time. Performs the Supabase JSON login and stores the access token in ZAP's session.
- `casa-tier2.policy` — **TODO: confirm against official ADA source.** Currently using a permissive OWASP Top 10 fallback. The App Defense Alliance distributes the CASA-tuned ZAP policy via their tooling matrix at <https://appdefensealliance.dev/casa/tier-2/tooling-matrix>; it should be downloaded from there once the canonical URL is confirmed and replaced here. Note: the ADA ASA-WG GitHub repo (`appdefensealliance/ASA-WG`) does not contain a ZAP policy file — only a Burp Suite JSON config (`CASA/ADA Burp Audit Scan Configuration.json`) and CASA spec/test guide documents.
