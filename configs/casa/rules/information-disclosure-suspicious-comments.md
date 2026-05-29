---
name: Information Disclosure - Suspicious Comments
slug: information-disclosure-suspicious-comments
zap_plugin_ids: [10027]
zap_alert_names:
  - "Information Disclosure - Suspicious Comments"
cwe: 200
category: saq-explainable
saq_section: "3.2"
saq_section_title: Information Disclosure
severity_override: null
---

# Information Disclosure - Suspicious Comments

## What ZAP detects

ZAP scans HTML, JavaScript, and CSS responses for comment substrings matching a list of suspicious keywords: `TODO`, `FIXME`, `XXX`, `HACK`, `BUG`, `password`, `username`, `admin`, `database`, etc. Any match fires the alert, regardless of context.

## Why this is typically "SAQ-explainable" for CASA

The vast majority of matches are innocuous: minified third-party libraries that contain the literal string "password" inside a function name, framework code with `TODO` markers, source maps that include developer comments. None of these constitute actual information disclosure.

The CASA-relevant question is: does any served comment contain a real secret (API key, password, internal URL, customer ID)? If yes → Actionable. If no → SAQ-explainable.

## SAQ answer template

> The comments flagged by ZAP at `<URLs>` are from `<SOURCE: third-party libraries / minified production bundles / framework code>`. Our build process (`<TOOL: webpack / vite / rollup / esbuild>`) strips developer comments from production bundles via `<CONFIG>`. We have manually reviewed the flagged comments and confirmed they contain no credentials, internal URLs, or other sensitive information.

Adapt the `<URLs>`, `<SOURCE>`, `<TOOL>`, and `<CONFIG>` placeholders using the specific evidence in your `triage.md`.

## When to escalate to Actionable

Reclassify and fix if:

- A comment contains an actual API key, password, or token
- A comment exposes an internal hostname, IP, or admin URL
- A comment contains customer-identifying information
- A `TODO` or `FIXME` comment describes a known security weakness ("TODO: validate this input")
