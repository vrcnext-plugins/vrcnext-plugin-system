/**
 * Read-only SQL against VRCNext's own databases.
 *
 * VRCNext keeps far more than it shows. `getTimelineForUser` answers with ten records and the
 * page caches a window of what it has fetched, so anything that counts — how many times you have
 * met someone, when you first did, how many records exist at all — cannot be answered from the
 * page. This reaches the database behind it.
 *
 * A plugin never names a file. It names an **alias**, and the bridge owns which file that is and
 * opens it `SQLITE_OPEN_READ_ONLY` with `query_only` set: a statement that asks to write is
 * refused by SQLite itself, not by a check here. One statement per call, parameters bound rather
 * than interpolated, and the result is capped — see the bridge's `sql` service for the limits.
 *
 * This is the escape hatch, not the front door. Everything VRCNext already holds in the page is
 * on `ctx.vrchat` and costs nothing; reach for SQL only for what the page genuinely does not
 * have, and say so with a `reuse:` marker.
 */

/** A value SQLite can return. A blob is reported by size rather than carried into the page. */
export type SqlValue = string | number | boolean | null | { readonly blobBytes: number };

/** One row, by column name. */
export type SqlRow = Readonly<Record<string, SqlValue>>;

/** A database the bridge is willing to open, named by alias. */
export type SqlDatabase = 'vrcnext' | 'avatars';

/** A result as the bridge returns it: column names, then rows in column order. */
export interface SqlResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly SqlValue[])[];
}

/** What a database is, as the bridge describes it. */
export interface SqlDatabaseInfo {
  readonly alias: string;
  readonly writable: boolean;
  readonly about: string;
}

/**
 * Read VRCNext's databases.
 *
 * Every method rejects when the `sql` permission is refused, when the alias is unknown, when the
 * statement is not a single statement, or when the result exceeds the bridge's caps.
 */
export interface SqlApi {
  /** One statement, its `?1`-style placeholders bound to `params` in order. */
  query(database: SqlDatabase, sql: string, params?: readonly SqlValue[]): Promise<SqlResult>;

  /** The same, as rows keyed by column name. */
  rows(database: SqlDatabase, sql: string, params?: readonly SqlValue[]): Promise<readonly SqlRow[]>;

  /**
   * The first column of the first row, or `undefined` when nothing matched — the shape a
   * `SELECT count(*)` wants.
   */
  value(database: SqlDatabase, sql: string, params?: readonly SqlValue[]): Promise<SqlValue | undefined>;

  /** Which databases this bridge will open, and what each one holds. */
  databases(): Promise<readonly SqlDatabaseInfo[]>;
}
