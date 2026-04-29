/**
 * casa-ready.config.js
 *
 * Copy this file to `casa-ready.config.js` (no `.example`) and edit the values
 * for your app. Add `casa-ready.config.js` to your .gitignore if it contains
 * URLs you don't want public.
 *
 * Credentials are NEVER stored here — set CASA_READY_USER and CASA_READY_PASS
 * environment variables instead.
 *
 * Note: form-based auth (`type: 'form'`) only works with HTML form POST
 * logins. JSON-body login endpoints (e.g. Supabase Auth's POST
 * /auth/v1/token) are not supported in V1 — see project task list.
 */
export default {
  app: 'your-app',

  envs: {
    staging: 'https://staging.your-app.com',
    prod: 'https://your-app.com',
  },

  auth: {
    type: 'form',
    loginUrl: 'https://staging.your-app.com/login',
    // ZAP's form-auth body. {%username%} / {%password%} are ZAP's substitution
    // tokens (NOT mustache; ZAP itself replaces these at scan time).
    loginRequestBody: 'email={%username%}&password={%password%}',
    // For human reference — ZAP infers the actual field names from the
    // key names in loginRequestBody above. These are not currently injected
    // into the ZAP context.
    usernameField: 'email',
    passwordField: 'password',
    // Regex matched against the response body of every request. When matched,
    // ZAP knows the session is still authenticated. Avoid `<` and `&` in the
    // pattern (they get XML-escaped, ZAP sees the entity, not the literal).
    loggedInIndicator: 'Sign out|/dashboard',
  },
};
