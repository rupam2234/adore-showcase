import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config — used for `drizzle-kit generate` / `migrate` when
 * evolving the schema. The showcase itself needs no migration step: `npm run
 * seed` creates the tables directly, so a reviewer can go from clone to running
 * app in two commands.
 */
export default {
  schema: './utils/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config;