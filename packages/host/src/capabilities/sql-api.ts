/**
 * `ctx.sql`, backed by the bridge's `sql` service.
 *
 * The service does the work that matters — it owns the alias-to-file map, opens read-only, binds
 * parameters and caps the result. This is the page's side of it: one call per query, with the
 * reply shaped into the three forms a plugin actually wants (raw, keyed rows, single value).
 *
 * The bridge client is used directly rather than through `ctx.native`, because `native` reaches
 * only `PLUGIN_BRIDGE_SERVICES` and gating a query as `native` would ask the user the wrong
 * question. The `sql` permission is checked by the wrapper in `context.ts` instead.
 */

import type {
  SqlApi,
  SqlDatabase,
  SqlDatabaseInfo,
  SqlResult,
  SqlRow,
  SqlValue,
} from '@vrcnext/plugin-api';

import type { BridgeClient } from './native.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A reply is trusted for its shape only; anything else answers as an empty result. */
function asResult(body: unknown): SqlResult {
  if (!isRecord(body)) return { columns: [], rows: [] };
  const columns = Array.isArray(body['columns']) ? (body['columns'] as string[]) : [];
  const raw = Array.isArray(body['rows']) ? body['rows'] : [];
  // The service sends each row as an object keyed by column name, so anything else is dropped
  // rather than indexed into and silently read as a row of `undefined`.
  return { columns, rows: raw.filter((row) => isRecord(row) && !Array.isArray(row)) as SqlRow[] };
}

export class HostSqlApi implements SqlApi {
  readonly #client: BridgeClient;

  constructor(client: BridgeClient) {
    this.#client = client;
  }

  async query(
    database: SqlDatabase,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult> {
    const body = await this.#client.call('sql', 'query', { database, sql, params });
    return asResult(body);
  }

  async rows(
    database: SqlDatabase,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<readonly SqlRow[]> {
    return (await this.query(database, sql, params)).rows;
  }

  async value(
    database: SqlDatabase,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlValue | undefined> {
    const result = await this.query(database, sql, params);
    // The first column by position, which is what `SELECT count(*)` means by "the answer".
    // `columns` carries that order; the row itself is an object and has none.
    const first = result.columns[0];
    return first === undefined ? undefined : result.rows[0]?.[first];
  }

  async databases(): Promise<readonly SqlDatabaseInfo[]> {
    const body = await this.#client.call('sql', 'databases', {});
    const list = isRecord(body) ? body['databases'] : undefined;
    return Array.isArray(list) ? (list as SqlDatabaseInfo[]) : [];
  }
}
