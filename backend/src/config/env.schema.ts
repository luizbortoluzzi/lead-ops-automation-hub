import { z } from 'zod';

/**
 * Environment contract for the backend API. Parsed once at startup so the
 * process fails fast (with a readable message) instead of crashing later on a
 * missing/invalid variable. Secrets are never echoed back in error messages.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    BACKEND_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

    // Database — either a full URL (used by tests/CI) or discrete parts.
    DATABASE_URL: z.string().url().optional(),
    DATABASE_HOST: z.string().default('postgres'),
    DATABASE_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
    DATABASE_NAME: z.string().default('leadops'),
    DATABASE_USER: z.string().default('leadops'),
    DATABASE_PASSWORD: z.string().default('change-me'),

    // Machine-to-machine auth between n8n and the backend.
    BACKEND_API_KEY: z.string().min(1, 'BACKEND_API_KEY must not be empty'),

    // SMTP (Mailpit in local dev) used to notify sales about enterprise leads.
    SMTP_HOST: z.string().default('mailpit'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
    SMTP_FROM: z.string().default('leadops@example.local'),
    SALES_NOTIFICATION_EMAIL: z.string().default('sales@example.local'),
  })
  .transform((env) => ({
    ...env,
    resolvedDatabaseUrl:
      env.DATABASE_URL ??
      `postgresql://${env.DATABASE_USER}:${env.DATABASE_PASSWORD}@${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`,
  }));

export type LeadSegment = 'small' | 'medium' | 'enterprise';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  apiKey: string;
  smtp: {
    host: string;
    port: number;
    from: string;
    salesEmail: string;
  };
}

/** Injection token for the validated {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const data = parsed.data;

  return {
    nodeEnv: data.NODE_ENV,
    port: data.BACKEND_PORT,
    databaseUrl: data.resolvedDatabaseUrl,
    apiKey: data.BACKEND_API_KEY,
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      from: data.SMTP_FROM,
      salesEmail: data.SALES_NOTIFICATION_EMAIL,
    },
  };
}
