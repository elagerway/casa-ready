import yaml from 'js-yaml';

const ZAP_IMAGE = 'zaproxy/zap-stable';
const ZAP_CONTEXT_PATH = '/zap/context.xml';
// OpenAPI doc lives at /zap/ root, NOT inside /zap/wrk/ — that path is
// already bind-mounted from outputDir, and Docker Desktop's virtiofs on
// macOS rejects nested file-inside-dir mounts ("outside of rootfs" error).
// Same bug class as v0.4.1's seed-file fix. v0.4.2 surfaced by the Magpipe
// dogfood with 4 oauth-callback targets — all 4 failed at runtime.
const ZAP_OPENAPI_PATH = '/zap/openapi.yaml';

/**
 * Build docker argv for an OAuth callback active scan.
 *
 * Maps to ZAP's zap-api-scan.py wrapper, which expects an OpenAPI/SOAP/
 * GraphQL spec as input. We synthesize a single-endpoint OpenAPI 3.0 doc
 * from the target's callbackParams (rendered by renderOpenApiYaml and
 * written to disk by the orchestrator before the scan starts).
 *
 * The example values in the spec become ZAP's starting point for active
 * fuzzing. They do NOT need to be valid Google credentials — ZAP mutates
 * them looking for SQL injection, XSS, open-redirect via redirect_uri,
 * info leaks in error responses, and similar callback-handler classics.
 */
export function buildArgs({
  targetUrl,
  configsDir,
  outputDir,
  contextPath,
  callbackParams,
  openApiPath,
  containerName = null,
}) {
  if (!callbackParams || Object.keys(callbackParams).length === 0) {
    throw new Error(
      'callbackParams is required for oauth-callback scan flavor (and must be non-empty)'
    );
  }
  if (!openApiPath) {
    throw new Error(
      'openApiPath is required for oauth-callback scan flavor (orchestrator must write the synthetic OpenAPI doc and pass its path)'
    );
  }

  const args = ['run', '--rm'];
  if (containerName) {
    args.push('--name', containerName);
  }
  args.push(
    '-v',
    `${configsDir}:/zap/configs:ro`,
    '-v',
    `${outputDir}:/zap/wrk:rw`,
    '-v',
    `${contextPath}:${ZAP_CONTEXT_PATH}:ro`,
    '-v',
    `${openApiPath}:${ZAP_OPENAPI_PATH}:ro`,
    ZAP_IMAGE,
    'zap-api-scan.py',
    '-t',
    ZAP_OPENAPI_PATH,
    '-f',
    'openapi',
    '-n',
    ZAP_CONTEXT_PATH,
    '-J',
    'results.json',
    '-x',
    'results.xml',
    '-r',
    'results.html'
  );

  // Suppress unused-var warning — targetUrl is informational here (the actual
  // URL ZAP scans comes from the OpenAPI doc), kept on the signature for
  // dispatcher symmetry with baseline.js / casa.js.
  void targetUrl;

  return args;
}

/**
 * Render a synthetic OpenAPI 3.0 YAML doc with one path and one query param
 * per callbackParams entry. Each example value is the corresponding param
 * value from the user's config — ZAP uses these as starting input for
 * mutation-based active scanning.
 */
export function renderOpenApiYaml({ url, params }) {
  const parsed = new URL(url);
  const serverUrl = `${parsed.protocol}//${parsed.host}`;
  const path = parsed.pathname;

  // zap-api-scan.py normalizes the active-scan target to the host root
  // (target = target[0:target.index('/', 8)+1]) before calling
  // zap.ascan.scan(target, recurse=True, contextid=...). If the host root
  // URL isn't in the context's message tree, ZAP rejects with
  // URL_NOT_IN_CONTEXT. We include a dummy root path "/" alongside the real
  // callback path so both URLs land in the message tree on import. The
  // active scan then walks recursively from the root and hits the callback
  // with its parameters as the actual fuzz target.
  // v0.4.3 fix surfaced by the Magpipe oauth-callback dogfood.
  const paths = {
    '/': {
      get: {
        summary: 'host root (dummy entry for zap-api-scan target normalization)',
        responses: { 200: { description: 'ok' } },
      },
    },
  };
  // Don't double-add if the user's callback URL IS the host root.
  if (path !== '/') {
    paths[path] = {
      get: {
        summary: 'OAuth callback handler',
        parameters: Object.entries(params).map(([name, example]) => ({
          name,
          in: 'query',
          required: true,
          schema: { type: 'string' },
          example,
        })),
        responses: {
          200: { description: 'callback handled' },
        },
      },
    };
  }

  const doc = {
    openapi: '3.0.0',
    info: { title: 'casa-ready oauth-callback scan', version: '1' },
    servers: [{ url: serverUrl }],
    paths,
  };

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}
