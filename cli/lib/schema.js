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
    refreshSeconds: z
      .number()
      .int()
      .positive('refreshSeconds must be a positive integer')
      .default(3300),
  })
  .strict();

const AuthSchema = z.discriminatedUnion('type', [
  FormAuthSchema,
  SupabaseJwtAuthSchema,
]);

const TargetSchema = z
  .object({
    name: z.string().min(1, 'target.name is required'),
    url: HttpUrl,
    auth: AuthSchema,
  })
  .strict();

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
export { FormAuthSchema, SupabaseJwtAuthSchema, AuthSchema, TargetSchema, EnvSchema };
