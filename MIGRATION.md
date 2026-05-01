# Migrating CASA Ready

## v0.3.x → v0.4.0

Fully backward-compatible. All v0.3.x configs work unchanged. New optional target fields:

| Field | Purpose |
|---|---|
| `seedUrls: [...]` | Explicit URLs to seed ZAP's spider with (full URLs or paths). |
| `seedDir: ./supabase/functions` | Supabase shortcut. Globs subdirs of the path; each subdir name becomes a seed URL. |
| `scan: oauth-callback` | Per-target scan flavor for OAuth callback handlers. Requires `callbackParams` and `auth.type: none`. |
| `auth: { type: none }` | For genuinely public endpoints (callback handlers, marketing pages). Skips login. |
| `callbackParams: {...}` | Required when `scan: oauth-callback`. Query params used as fuzz starting input. |

Magpipe-style minimal upgrade — add one line to your existing `api` target:

```yaml
- name: api
  url: https://x.supabase.co/functions/v1
  auth: { type: supabase-jwt, ... }
  seedDir: ./supabase/functions   # ← add this
```

ZAP now discovers all your Edge Functions instead of hitting only the directory-listing-less root.

---

## v0.2.x → v0.3.0

V0.3.0 replaces the JavaScript config (`casa-ready.config.js`) with declarative YAML (`casa-ready.yml`). The schema shape is unchanged — same `app`, `envs.<name>.targets[]`, same auth types — just expressed in YAML.

### Why

External adoption: a JS file that can read env vars and run arbitrary expressions triggers security review at most companies. YAML is statically inspectable, supports comments, and matches the rest of the CASA / OWASP toolchain (GitHub Actions, ZAP, Snyk, Dependabot).

### Migration paths

**Easiest: regenerate from scratch.**

```bash
rm casa-ready.config.js
casa-ready init
```

The interactive prompts walk you through the same fields and produce a valid `casa-ready.yml` with the right `# yaml-language-server: $schema=…` directive at the top.

**Manual: side-by-side translation.**

Before (`casa-ready.config.js`):

```javascript
export default {
  app: 'your-app',
  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.your-app.example',
          auth: {
            type: 'form',
            loginUrl: 'https://staging.your-app.example/login',
            loginRequestBody: 'email={%username%}&password={%password%}',
            usernameField: 'email',
            passwordField: 'password',
            loggedInIndicator: 'Sign out|/dashboard',
          },
        },
        {
          name: 'api',
          url: 'https://your-project-ref.supabase.co/functions/v1',
          auth: {
            type: 'supabase-jwt',
            loginUrl: 'https://your-project-ref.supabase.co/auth/v1/token?grant_type=password',
            apiKey: process.env.SUPABASE_ANON_KEY,
            refreshSeconds: 3300,
          },
        },
      ],
    },
  },
};
```

After (`casa-ready.yml`):

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/elagerway/casa-ready/main/schemas/casa-ready.schema.json
app: your-app

envs:
  staging:
    targets:
      - name: spa
        url: https://staging.your-app.example
        auth:
          type: form
          loginUrl: https://staging.your-app.example/login
          loginRequestBody: 'email={%username%}&password={%password%}'
          usernameField: email
          passwordField: password
          loggedInIndicator: 'Sign out|/dashboard'

      - name: api
        url: https://your-project-ref.supabase.co/functions/v1
        auth:
          type: supabase-jwt
          loginUrl: https://your-project-ref.supabase.co/auth/v1/token?grant_type=password
          apiKey: ${SUPABASE_ANON_KEY}
```

Key differences:

- `process.env.SUPABASE_ANON_KEY` becomes `${SUPABASE_ANON_KEY}` — a string interpolation expanded by CASA Ready at scan time. Missing vars throw with the dotted YAML path that referenced them.
- The `# yaml-language-server: $schema=…` line at the top enables IDE autocomplete in VS Code's [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml).
- No quotes needed for most strings; quote when the value contains characters with YAML meaning (`:`, `|`, `>`, leading `*`, etc.).
- **`refreshSeconds` was dropped from the example.** It's still accepted (backward-compat with old YAMLs) but has been a no-op since v0.2.4. The new auth path does the Supabase login from Node and injects a static Bearer token via ZAP's replacer addon — there's nothing to poll or refresh on a schedule.

### What's new besides the format change

- `casa-ready init` — interactive scaffolding command
- JSON Schema published in the npm package (`schemas/casa-ready.schema.json`) for IDE autocomplete and CI validation
- TypeScript types exported (`types/index.d.ts`) for programmatic Node users (`import type { CasaReadyConfig } from 'casa-ready'`)
- Containers spawned by CASA Ready now have human-readable names (`casa-ready-<target>-<runId>`) visible in Docker Desktop's Containers tab
