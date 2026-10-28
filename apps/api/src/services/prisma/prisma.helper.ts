import { Prisma } from '@prisma/client';

/**
 * Recursively strips PostgreSQL-specific `mode: 'insensitive'` and `mode: 'default'`
 * filter parameters from Prisma query payloads (e.g. `where` clauses).
 *
 * In PostgreSQL, Prisma generates `ILIKE` for queries specifying `mode: 'insensitive'`.
 * In SQLite, string comparisons using `LIKE` are case-insensitive for ASCII characters
 * by default, and Prisma's SQLite query engine rejects `mode: 'insensitive'` as an
 * invalid argument.
 *
 * Stripping this argument at the database adapter/extension level allows service queries
 * throughout the application to remain database-agnostic and 100% compatible with both
 * PostgreSQL and SQLite without code modifications.
 *
 * @param obj The query arguments or filter object to sanitize in-place.
 * @returns The mutated object with all `mode` filter properties removed.
 */
export function stripModeInsensitive<T = any>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      stripModeInsensitive(item);
    }
    return obj;
  }

  if (
    'mode' in obj &&
    ((obj as any).mode === 'insensitive' || (obj as any).mode === 'default')
  ) {
    delete (obj as any).mode;
  }

  for (const key of Object.keys(obj)) {
    stripModeInsensitive((obj as any)[key]);
  }

  return obj;
}

/**
 * Official Prisma Client Extension ($extends) for SQLite compatibility.
 * Intercepts all model operations and transparently sanitizes query arguments.
 */
export const sqliteCompatibilityExtension = Prisma.defineExtension({
  name: 'sqlite-compatibility',
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        if (args) {
          stripModeInsensitive(args);
        }
        return query(args);
      }
    }
  }
});
