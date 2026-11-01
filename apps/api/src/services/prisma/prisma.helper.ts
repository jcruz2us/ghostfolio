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
 * Emulates `createMany({ skipDuplicates: true })`, which Prisma does not
 * support on SQLite. Tries a single batch insert first and, if it hits a
 * unique constraint (P2002), inserts row by row and skips the duplicates.
 */
export async function createManySkippingDuplicates(
  args: any,
  query: (args: any) => Promise<any>
): Promise<{ count: number }> {
  const { skipDuplicates, ...rest } = args;

  try {
    return await query(rest);
  } catch (error) {
    if (error?.code !== 'P2002') {
      throw error;
    }
  }

  const rows = Array.isArray(rest.data) ? rest.data : [rest.data];
  let count = 0;

  for (const row of rows) {
    try {
      await query({ ...rest, data: [row] });
      count++;
    } catch (error) {
      if (error?.code !== 'P2002') {
        throw error;
      }
    }
  }

  return { count };
}

/**
 * Query handler applied to every model operation on SQLite: strips
 * PostgreSQL-only filters and emulates `createMany({ skipDuplicates })`.
 */
export async function sqliteAllOperations({
  args,
  operation,
  query
}: {
  args: any;
  operation: string;
  query: (args: any) => Promise<any>;
}) {
  if (args) {
    stripModeInsensitive(args);
  }

  if (operation === 'createMany' && args?.skipDuplicates) {
    return createManySkippingDuplicates(args, query);
  }

  return query(args);
}

/**
 * Official Prisma Client Extension ($extends) for SQLite compatibility.
 */
export const sqliteCompatibilityExtension = Prisma.defineExtension({
  name: 'sqlite-compatibility',
  query: {
    $allModels: {
      $allOperations: sqliteAllOperations
    }
  }
});
