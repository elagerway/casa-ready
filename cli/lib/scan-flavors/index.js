import * as baseline from './baseline.js';
import * as casa from './casa.js';
import * as oauthCallback from './oauth-callback.js';

const FLAVORS = {
  baseline,
  casa,
  'oauth-callback': oauthCallback,
};

export function buildArgsFor(flavor, opts) {
  const adapter = FLAVORS[flavor];
  if (!adapter) {
    const known = Object.keys(FLAVORS).join(', ');
    throw new Error(`Unknown scan flavor: ${flavor}. Known flavors: ${known}`);
  }
  return adapter.buildArgs(opts);
}
