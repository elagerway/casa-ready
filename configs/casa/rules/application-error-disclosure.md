---
name: Application Error Disclosure
slug: application-error-disclosure
zap_plugin_ids: [90022]
zap_alert_names:
  - "Application Error Disclosure"
cwe: 200
category: saq-explainable
saq_section: "3.1"
saq_section_title: Error Handling
severity_override: null
---

# Application Error Disclosure

## What ZAP detects

ZAP fires this alert any time an HTTP response with status 500 (or other 5xx) contains substrings that resemble error messages — words like "Error", "Exception", stack-trace shapes (`at FunctionName (file.js:42:13)`), database error keywords (`SQLSTATE`, `ORA-`), etc. The alert is text-pattern based, not framework-aware.

## Why this is typically "SAQ-explainable" for CASA

In modern apps, 5xx responses commonly include intentional, structured error JSON (e.g., `{"error": "User not found"}`) — this triggers ZAP's pattern-matcher even though no sensitive information is leaked. CASA reviewers understand this distinction; the SAQ answer just needs to articulate that your error responses are intentional, structured, and don't include stack traces or internal paths.

If your scan shows actual stack traces in production responses, **reclassify this finding as Actionable** and remove the stack traces (most frameworks have a "production mode" flag that suppresses them).

## SAQ answer template

> All `5xx` responses from our API return structured JSON error objects (e.g., `{"error": "<short message>"}`) that do not include stack traces, file paths, database schemas, or other internal implementation details. Stack traces and verbose errors are gated to non-production environments via `<MECHANISM>` (e.g., `NODE_ENV !== 'production'`, debug-mode flag in framework config). The instances flagged by ZAP at `<URLs>` are intentional, structured error responses.

Adapt the `<MECHANISM>` and `<URLs>` placeholders using the specific evidence in your `triage.md`. List 2-3 representative instances rather than all of them.

## When to escalate to Actionable

Reclassify and fix if:

- An instance shows a real stack trace (lines like `at /app/src/services/user.js:42:13`)
- An instance includes a database error with table/column names visible
- An instance includes a file path on the server (`/var/www/html/...`)
- The error message includes a credential, token, or other secret
