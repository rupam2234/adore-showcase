import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';

// Fail fast and loudly. A missing connection string should surface as a clear
// message at boot, not as an opaque driver error on the first query.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not defined. Copy .env.example to .env.local and fill it in.'
  );
}

// Drizzle sits on top of the SAME Neon serverless HTTP driver — same
// transport, same edge compatibility, typed queries on top.
const client = neon(process.env.DATABASE_URL);

export const db = drizzle(client, { schema });

// Re-export tables so callers can `import { db, products } from './db'`.
export * from './schema';

/**
 * Raw Neon client, for the seed script which creates the schema without
 * going through Drizzle's query builder.
 */
export const pool = client;

/**
 * Escape hatch for complex SQL (JSON_AGG, DISTINCT ON, LATERAL joins, …) that
 * the query builder doesn't express cleanly. Fully parameterized, typed on
 * return.
 *
 * Usage: rawQuery<ProductRow>(sql`SELECT ... WHERE id = ${id}`)
 */
export async function rawQuery<T = Record<string, unknown>>(
  query: SQL
): Promise<T[]> {
  try {
    const result = await db.execute(query);
    return (result.rows ?? []) as T[];
  } catch (error) {
    // Drizzle wraps driver failures in DrizzleQueryError, whose own message is
    // only the SQL text — the real cause (Postgres message + SQLSTATE) lives in
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

  // The top-level Drizzle message is just the SQL string — drop it if a more
  // specific cause follows, so the log leads with the real reason.
  const meaningful = parts.filter(p => !/^\s*(insert|select|update|delete) /i.test(p));
  return (meaningful.length > 0 ? meaningful : parts).join(' → ');
}

// Re-export so callers can build SQL fragments without importing drizzle-orm.
export { sql };