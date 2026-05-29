# casa-ready Claude Code Plugin

Claude Code plugin for Google CASA Tier 2 security assessment workflow.

## Install

Prerequisites:
- [Claude Code](https://claude.com/claude-code) installed
- Node.js 20+ and Docker (for the bundled CLI)

```bash
# 1. Install this plugin
claude plugin install https://github.com/elagerway/casa-ready

# 2. Install the bundled CLI (the plugin shells out to it)
npm install -g casa-ready

# 3. Verify
casa-ready --help
```

## Usage

In a repo with a `casa-ready.yml` config:

```bash
casa-ready scan        # produces scan-output/<env>/<ts>/
casa-ready triage      # produces triage.md alongside the scan output
```

Then in Claude Code: ask "triage my CASA findings" — the `casa-ready:triage-findings` skill will read `triage.md`, locate Actionable findings in your code, and propose patches.

## Skills shipped

- **`casa-ready:triage-findings`** — Reads CASA scan findings, opens the user's actual code for Actionable items, drafts concrete patches, and produces SAQ-ready answer text for explainable findings.

## Vendored skills (under `_vendored/`)

- **`superpowers:_vendored/systematic-debugging`** — Required by `triage-findings` Phase 3 to enforce root-cause analysis before drafting patches.
- **`superpowers:_vendored/test-driven-development`** — Required by `triage-findings` Phase 3 for security-relevant fixes.

These are vendored copies (not separate plugins) so users get a single install. Refresh upstream via `scripts/sync-vendored.sh`.

## Roadmap

- **V0.6.0**: `casa-ready:complete-saq` skill — walk through the SAQ portal question-by-question using triage's drafted answers
- **V0.7.0**: `casa-ready:getting-started` skill — workflow conductor that runs the entire pipeline (configure → scan → triage → SAQ → submit)

See the [main README](../README.md) for the full project context.
