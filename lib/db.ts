import postgres from "postgres";

// Server module: Supabase Postgres through its connection pooler. Routes keep the
// small prepare/bind/first/all/run/batch interface they used with D1.
export type Row = Record<string, unknown>;
type Runner = (query: string, params: unknown[]) => Promise<Row[]>;

export interface Statement {
  bind(...params: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<void>;
}

export interface Database {
  prepare(query: string): Statement;
  batch<T = Row>(statements: Statement[]): Promise<{ results: T[] }[]>;
}

type BoundStatement = Statement & { query: string; params: unknown[] };

/** Rewrites positional `?` placeholders as Postgres `$1, $2, …`. Queries must not contain literal `?`. */
export function numberedPlaceholders(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

function statement(runner: Runner, query: string, params: unknown[] = []): BoundStatement {
  const text = numberedPlaceholders(query);
  return {
    query: text, params,
    bind: (...values) => statement(runner, query, values),
    first: async <T>() => ((await runner(text, params))[0] as T | undefined) ?? null,
    all: async <T>() => ({ results: (await runner(text, params)) as T[] }),
    run: async () => { await runner(text, params); },
  };
}

/** Builds the D1-style interface on any query runner; batches run inside one transaction. */
export function createDatabase(runner: Runner, transaction: <T>(work: (runner: Runner) => Promise<T>) => Promise<T>): Database {
  return {
    prepare: (query) => statement(runner, query),
    batch: <T>(statements: Statement[]) => transaction(async (tx) => {
      const results: { results: T[] }[] = [];
      for (const item of statements as BoundStatement[]) results.push({ results: (await tx(item.query, item.params)) as T[] });
      return results;
    }),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/** Supabase's Vercel integration appends options (such as `supa=`) that Postgres rejects as startup parameters. */
export function connectionUrl(value: string): string {
  const url = new URL(value);
  for (const name of [...url.searchParams.keys()]) if (name !== "sslmode") url.searchParams.delete(name);
  return url.toString();
}

let client: postgres.Sql | undefined;
let database: Database | undefined;

export function getDatabase(): Database | null {
  if (database) return database;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  client = postgres(connectionUrl(url), {
    // Transaction-mode pooling (port 6543) does not support prepared statements.
    prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10,
    // Millisecond timestamps and counts are int8; they stay well inside Number's safe range.
    types: { bigint: { to: 20, from: [20], serialize: (value: number) => String(value), parse: (value: string) => Number(value) } },
  });
  const sql = client;
  const runner = (on: postgres.Sql | postgres.TransactionSql): Runner => async (query, params) =>
    [...await on.unsafe(query, params as postgres.ParameterOrJSON<never>[])] as Row[];
  database = createDatabase(runner(sql), (work) => sql.begin((tx) => work(runner(tx))) as never);
  return database;
}
