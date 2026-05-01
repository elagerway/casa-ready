import { z } from 'zod';

const HttpUrl = z
  .string()
  .min(1, 'must be a non-empty URL')
  .regex(/^https?:\/\//, 'url must start with http:// or https://');

const FormAuthSchema = z
  .object({
    type: z.literal('form'),
    loginUrl: HttpUrl,
    loginRequestBody: z.string().min(1, 'loginRequestBody is required'),
    usernameField: z.string().min(1, 'usernameField is required'),
    passwordField: z.string().min(1, 'passwordField is required'),
    loggedInIndicator: z.string().min(1, 'loggedInIndicator is required'),
  })
  .strict();

const SupabaseJwtAuthSchema = z
  .object({
    type: z.literal('supabase-jwt'),
    loginUrl: HttpUrl,
    apiKey: z.string().min(1, 'apiKey is required'),
    // refreshSeconds is accepted but unused as of v0.2.4 — the auth path
    // (Node-side login + replacer-injected static Bearer) doesn't poll, so
    // there's nothing to refresh on a schedule. Kept as an optional field
    // for backward compat with v0.2.x YAMLs; new init runs don't set it.
    refreshSeconds: z
      .number()
      .int()
      .positive('refreshSeconds must be a positive integer')
      .optional(),
  })
  .strict();

const NoAuthSchema = z
  .object({
    type: z.literal('none'),
  })
  .strict();

const AuthSchema = z.discriminatedUnion('type', [
  FormAuthSchema,
  SupabaseJwtAuthSchema,
  NoAuthSchema,
]);

const ScanFlavorSchema = z.enum(['casa', 'baseline', 'oauth-callback']);

const CallbackParamsSchema = z.record(z.string(), z.string());

const TargetSchema = z
  .object({
    name: z.string().min(1, 'target.name is required'),
    url: HttpUrl,
    auth: AuthSchema,
    // V2 additions — all optional, backward-compatible.
    seedUrls: z.array(z.string().min(1)).optional(),
    seedDir: z.string().min(1).optional(),
    scan: ScanFlavorSchema.optional(),
    callbackParams: CallbackParamsSchema.optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.scan === 'oauth-callback') {
      if (!target.callbackParams || Object.keys(target.callbackParams).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['callbackParams'],
          message:
            "callbackParams is required when scan: 'oauth-callback' — list the query-string keys ZAP should treat as scan inputs (e.g. callbackParams: { state: '*', code: '*' })",
        });
      }
      if (target.auth.type !== 'none') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auth', 'type'],
          message:
            "scan: 'oauth-callback' requires auth.type: 'none' (callback URLs are public — set auth: { type: none })",
        });
      }
    }
  });

const EnvSchema = z
  .object({
    targets: z
      .array(TargetSchema)
      .min(1, 'targets must contain at least 1 target')
      .superRefine((targets, ctx) => {
        const seen = new Set();
        for (const [i, t] of targets.entries()) {
          if (seen.has(t.name)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, 'name'],
              message: `duplicate target name '${t.name}' in env`,
            });
          }
          seen.add(t.name);
        }
      }),
  })
  .strict();

export const ConfigSchema = z
  .object({
    app: z.string().min(1, 'app is required'),
    envs: z
      .record(z.string(), EnvSchema)
      .refine((envs) => Object.keys(envs).length > 0, {
        message: 'envs must contain at least one environment',
      }),
  })
  .strict();

// Re-exports for callers that want narrower types
export {
  FormAuthSchema,
  SupabaseJwtAuthSchema,
  NoAuthSchema,
  AuthSchema,
  ScanFlavorSchema,
  CallbackParamsSchema,
  TargetSchema,
  EnvSchema,
};
