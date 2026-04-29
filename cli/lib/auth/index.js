import * as form from './form.js';
import * as supabaseJwt from './supabase-jwt.js';

const RENDERERS = {
  form,
  'supabase-jwt': supabaseJwt,
};

export async function getContext(opts) {
  const { target } = opts;
  const renderer = RENDERERS[target.auth.type];
  if (!renderer) {
    const known = Object.keys(RENDERERS).join(', ');
    throw new Error(
      `Unknown auth.type '${target.auth.type}' for target '${target.name}' — must be one of: ${known}`
    );
  }
  return renderer.getContext(opts);
}
