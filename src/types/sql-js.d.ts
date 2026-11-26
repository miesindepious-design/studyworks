/**
 * sql.js ships no TypeScript types.
 *
 * Only the pieces this project uses are declared: the initialiser and the
 * Database handle with the two calls the exporter makes.
 */
declare module 'sql.js/dist/sql-wasm-inline.js' {
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
    export(): Uint8Array;
    close(): void;
  }

  const initSqlJs: (config?: Record<string, unknown>) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
