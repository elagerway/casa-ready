# CASA Ready

> An open-source toolkit to help developers pass Google's CASA Tier 2 security assessment without paying $15K–$40K to consulting firms.

**Status:** pre-V1, in active development. Built in the open while passing CASA for [Magpipe](https://magpipe.ai).

## Why this exists

If your app uses restricted Google API scopes (full Gmail, Drive, Calendar), Google requires an annual [CASA Tier 2 assessment](https://appdefensealliance.dev/casa). The official self-scan path was deprecated in 2025 — your only options now are the [TAC Security](https://tacsecurity.com) lab ($540–$1,800) or a big firm ($15K–$40K).

The bottleneck isn't the money. It's:

1. **No public guide.** TAC drops you in a portal with no instructions.
2. **A 50+ question Self-Assessment Questionnaire** that takes most of the time.
3. **OWASP ZAP / Fluid Attacks setup** the App Defense Alliance's own docs make harder than it needs to be.
4. **Annual recert** that resets the pain.

CASA Ready closes those gaps so an indie dev can get to a Letter of Validation in days, not months.

## Planned V1

| Component | What it does |
|---|---|
| `casa-ready scan <url>` | Runs OWASP ZAP in Docker against your deployed app with the CASA-mapped CWE policy preloaded; emits the `.txt` artifacts the portal accepts |
| `casa-ready saq` | SAQ Copilot — drafts answers to the 50+ Self-Assessment Questionnaire items from your repo + cloud config, with the "cloud provider handles that" / NA patterns built in |
| `casa-ready precheck` | Top-20 CWE pre-fix snippets (security headers, HSTS, CSP, secure cookies, CORS lockdown) for common stacks — get scan-clean before you ever pay TAC |
| `docs/playbook.md` | The missing TAC dashboard manual, step-by-step |

## Out of scope (deliberately)

- Multi-framework support (SOC 2, ISO 27001) — see [Probo](https://github.com/getprobo/probo) or [Comp AI](https://github.com/trycompai/comp)
- Cloud infra scanning (AWS/Azure config checks) — see [Shasta](https://github.com/transilienceai/shasta)
- Hosted/managed service — this is a free toolkit, not a SaaS replacement for TAC

## Project layout

```
casa-ready/
├── README.md           ← you are here
├── LICENSE             ← MIT
├── package.json
├── bin/                ← CLI entrypoint
├── cli/                ← command implementations
│   └── commands/
├── configs/
│   └── zap/            ← OWASP ZAP CWE policy files (ADA-mapped)
└── docs/
    ├── research-findings.md   ← living research log
    └── playbook.md            ← TAC submission walkthrough (coming)
```

## Status & roadmap

V1 must ship before **2026-07-23** — Magpipe's CASA deadline. Built in lockstep with that submission so every feature is grounded in a real pain point we hit.

### Roadmap

| Version | Scope | Triggered by |
|---|---|---|
| **V1** (in design) | `casa-ready scan <url>` — anonymous OWASP ZAP scan against the primary origin (e.g., `magpipe.ai`) with the CASA-mapped CWE policy | The 2026-07-23 deadline |
| **V1.1** | Adds Supabase / API endpoints as a second scan target with API-tuned config | V1 ships clean + we have an endpoint manifest |
| **V2** | Authenticated scan: ZAP context with session replay + OAuth flows | V1.1 ships + TAC findings reveal coverage gaps anonymous scans can't catch |
| later | `casa-ready saq` — SAQ Copilot drafting from repo + cloud config | After V1 produces real scan output to feed it |
| later | `casa-ready precheck` — Top-20 CWE pre-fix snippets for common stacks | After we see which CWEs Magpipe (and contributors' apps) actually trip |

## License

MIT. Use it, fork it, sell services around it.
