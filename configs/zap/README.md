# OWASP ZAP CWE Policy Files

This directory will hold the CASA-mapped OWASP ZAP scan policy files.

## What goes here

The App Defense Alliance publishes a CWE-mapped ZAP configuration as part of the official Tier 2 tooling. Source: <https://appdefensealliance.dev/casa/tier-2/tooling-matrix>.

**To populate:** download the official ADA ZAP config (referenced in your CASA notification email) and commit it here, plus any CASA Ready overlays we add for specific app archetypes (SPA, API-only, mobile-backend, etc.).

## Why we vendor these

The official location of the configs has moved at least once (legacy `appdefensealliance-dev/ASA` → current `appdefensealliance/ASA-WG`). Vendoring keeps us reproducible.
