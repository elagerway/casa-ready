---
name: Cross-Domain JavaScript Source File Inclusion
slug: cross-domain-javascript-source-file-inclusion
zap_plugin_ids: [10017]
zap_alert_names:
  - "Cross-Domain JavaScript Source File Inclusion"
cwe: 829
category: noise
severity_override: null
---

# Cross-Domain JavaScript Source File Inclusion

## What ZAP detects

ZAP flags every `<script src="...">` element where the `src` attribute points to a domain other than the page's origin. This includes legitimate CDN-hosted libraries, payment provider SDKs, analytics, embedded widgets, etc.

## Why this is typically noise

Modern web apps reliably include scripts from third-party domains: Stripe.js, Google Tag Manager, Sentry, your CDN-hosted React/Vue bundle, embedded chat widgets, and so on. Each of these triggers this finding, but none of them constitute a security issue *unless* you're loading from a domain you don't trust.

CASA reviewers expect this finding to appear and expect it to be dismissed for known-trusted CDNs. The dismissal reasoning is: you've vetted the third-party provider, you trust their CDN's integrity, and (ideally) you've added Subresource Integrity (SRI) hashes to pin the expected file content.

## Why this is noise

The check is structural (any cross-origin `<script>` qualifies), not semantic (no inspection of *what* the script does or whether the source is trustworthy). The signal-to-noise ratio is essentially zero for any modern web app.

## When to escalate to Actionable

Reclassify and fix if:

- An instance points at a domain you do NOT recognize or did NOT intentionally include (could indicate an XSS or supply-chain compromise)
- A critical script (auth, payments) lacks Subresource Integrity hashes (`<script src="..." integrity="sha384-..." crossorigin>`)
- A script is loaded from a domain that lacks HTTPS (`http://...`) — that should be Actionable on its own (Mixed Content)

For CASA submission: the SAQ entry for this finding (if any) just lists your trusted CDN partners. Most submissions don't need an SAQ entry for it at all.
