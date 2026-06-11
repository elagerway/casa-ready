// Pure: turn an oauth-callback target into the JSON descriptor the
// oauth-callback-hook.py reads inside the ZAP container. The hook seeds one
// request per method, with callbackParams as the injection points.

const METHOD_ORDER = ['GET', 'POST'];

/**
 * @param {{url: string, callbackParams: Record<string,string>, method?: string | string[]}} target
 *   — `method` is assumed pre-validated against HttpMethodSchema (GET/POST); any
 *     other value is silently dropped.
 * @returns {{url: string, methods: string[], params: Record<string,string>}}
 */
export function buildDescriptor(target) {
  return {
    url: target.url,
    methods: normalizeMethods(target.method),
    params: target.callbackParams,
  };
}

function normalizeMethods(method) {
  const raw = method == null ? ['GET'] : Array.isArray(method) ? method : [method];
  const present = new Set(raw);
  // Canonical order (GET before POST), deduped.
  return METHOD_ORDER.filter((m) => present.has(m));
}
