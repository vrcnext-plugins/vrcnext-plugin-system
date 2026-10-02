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
  const rows = Array.isArray(body['rows']) ? (body['rows'] as SqlValue[][]) : [];
  return { columns, rows };
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
    const result = await this.query(database, sql, params);
    return result.rows.map((row) => {
      const out: Record<string, SqlValue> = {};
      result.columns.forEach((name, index) => { out[name] = row[index] ?? null; });
      return out;
    });
  }

  async value(
    database: SqlDatabase,
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlValue | undefined> {
    const result = await this.query(database, sql, params);
    return result.rows[0]?.[0];
  }

  async databases(): Promise<readonly SqlDatabaseInfo[]> {
    const body = await this.#client.call('sql', 'databases', {});
    const list = isRecord(body) ? body['databases'] : undefined;
    return Array.isArray(list) ? (list as SqlDatabaseInfo[]) : [];
  }
}
