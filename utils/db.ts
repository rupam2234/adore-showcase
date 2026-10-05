import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';

/**
 * Whether a real database is configured.
 *
 * Checked rather than assumed, because the showcase must run on a fresh clone
 * with zero setup. Production always sets DATABASE_URL and takes the Postgres
 * path; without it, `utils/products.ts` serves the read model from the in-memory
 * demo catalogue instead (see utils/demo-data.ts). The SQL is identical in both
 * cases -- only the transport differs.
 */
export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

/**
 * Fail fast, but only where a query is actually about to run. A module-level
 * `throw` here would break `next build` page-data collection even for routes
 * that never touch the database, so the connection is created lazily instead.
 */
function getClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not defined. Copy .env.example to .env.local, or run ' +
        'without it to use the built-in demo catalogue.'
    );
  }
  return neon(url);
}

// Drizzle sits on top of the SAME Neon serverless HTTP driver -- same
// transport, same edge compatibility, typed queries on top.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) _db = drizzle(getClient(), { schema });
  return _db;
}

// Backwards-compatible eager handle. A Proxy defers the throw to first use, so
// importing this module is always safe.
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop) {
      const real = getDb() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      return typeof value === 'function' ? value.bind(real) : value;
    },
  }
);

/**
 * Raw Neon client, for the seed script which creates the schema without
 * going through Drizzle's query builder.
 */
export function getPool() {
  return getClient();
}

// Re-export tables so callers can `import { db, products } from './db'`.
export * from './schema';

/**
 * Escape hatch for complex SQL (JSON_AGG, DISTINCT ON, LATERAL joins, ...) that
 * the query builder doesn't express cleanly. Fully parameterized, typed on
 * return.
 *
 * Usage: rawQuery<ProductRow>(sql`SELECT ... WHERE id = ${id}`)
 */
export async function rawQuery<T = Record<string, unknown>>(
  query: SQL
): Promise<T[]> {
  try {
    const result = await getDb().execute(query);
    return (result.rows ?? []) as T[];
  } catch (error) {
    // Drizzle wraps driver failures in DrizzleQueryError, whose own message is
    // only the SQL text -- the real cause (Postgres message + SQLSTATE) lives in
    // `.cause`. Re-throw with that detail so failures aren't opaque at the
    // call site / in the Next.js error overlay.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: string }).code;
      throw new Error(`${cause.message}${code ? ` [${code}]` : ''}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Extract the actionable Postgres message from a Drizzle/driver error.
 *
 * Drizzle wraps driver failures in DrizzleQueryError, whose own `message` is
 * only the SQL text. The real cause lives in `.cause`, and neon/drizzle can
 * nest more than one level, so walk the chain. Callers use this so a failed
 * write reports *why* instead of a generic "something went wrong".
 */
export function describeDbError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let i = 0; i < 5 && current instanceof Error; i++) {
    parts.push(current.message);
    current = current.cause;
  }

  // SQLSTATE is on the cause as `.code` (e.g. '23505' unique violation).
  const code = (error as (Error & { code?: string }) | null)?.code;
  if (typeof code === 'string' && !parts[0]?.includes(code)) {
    parts.push(`[${code}]`);
  }

  // The top-level Drizzle message is just the SQL string -- drop it if a more
  // specific cause follows, so the log leads with the real reason.
  const meaningful = parts.filter(p => !/^\s*(insert|select|update|delete) /i.test(p));
  return (meaningful.length > 0 ? meaningful : parts).join(' → ');
}

// Re-export so callers can build SQL fragments without importing drizzle-orm.
export { sql };
