/**
 * casa-ready.config.js
 *
 * Copy this file to `casa-ready.config.js` (no `.example`) and edit the values
 * for your app. Add `casa-ready.config.js` to your .gitignore if it contains
 * URLs you don't want public.
 *
 * Credentials are NEVER stored here — set CASA_READY_USER and CASA_READY_PASS
 * environment variables instead. For the Supabase anon key, you can either
 * inline it (it's a public key) or read it from process.env (recommended for
 * apps that already have it as a Vite env var).
 *
 * V1.1: this config supports multiple targets per env. Each target has its own
 * URL and auth — typical Supabase-backed apps will have a 'spa' target with
 * form auth and an 'api' target with supabase-jwt auth.
 */
export default {
  app: 'your-app',

  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.your-app.com',
          auth: {
            type: 'form',
            loginUrl: 'https://staging.your-app.com/login',
            // ZAP's form-auth body. {%username%} / {%password%} are ZAP's
            // substitution tokens (NOT mustache; ZAP itself replaces these
            // at scan time).
            loginRequestBody: 'email={%username%}&password={%password%}',
            // For human reference — ZAP infers the actual field names from
            // the key names in loginRequestBody above. These are not currently
            // injected into the ZAP context.
            usernameField: 'email',
            passwordField: 'password',
            // Regex matched against every response body. When matched, ZAP
            // knows the session is still authenticated. Avoid `<` and `&` in
            // the pattern (they get XML-escaped, ZAP sees the entity).
            loggedInIndicator: 'Sign out|/dashboard',
          },
        },
        {
          name: 'api',
          url: 'https://your-project-ref.supabase.co/functions/v1',
          auth: {
            type: 'supabase-jwt',
            // Supabase Auth JSON-body endpoint. Must contain `/auth/v1/`.
            loginUrl: 'https://your-project-ref.supabase.co/auth/v1/token?grant_type=password',
            // Supabase project anon key (public). Read from env if your stack
            // already exports it (e.g. Vite apps have VITE_SUPABASE_ANON_KEY).
            apiKey: process.env.SUPABASE_ANON_KEY,
            // ZAP re-authenticates every N seconds. Default 3300s (55 min) is
            // safely under Supabase's 1-hour JWT expiry.
            refreshSeconds: 3300,
          },
        },
      ],
    },

    prod: {
      targets: [
        // Same shape as staging.targets, with prod URLs.
        // V1.1 limitation: target order matters (run sequentially). Keep
        // the SPA first if you want the human triage summary to lead with
        // the most user-visible findings.
      ],
    },
  },
};
