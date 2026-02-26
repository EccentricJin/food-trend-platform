import mysql, { Pool, PoolOptions } from "mysql2/promise";

let pool: Pool | null = null;

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

export function getDbConfigFromEnv(): DbConfig {
  return {
    host: process.env.MYSQL_HOST ?? process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.MYSQL_PORT ?? process.env.DB_PORT ?? "3306"),
    user: process.env.MYSQL_USER ?? process.env.DB_USER ?? "food_trend_user",
    password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? process.env.DB_NAME ?? "food_trend_db",
    connectionLimit: parseInt(process.env.MYSQL_POOL_SIZE ?? process.env.DB_POOL_SIZE ?? "10"),
  };
}

export function getPool(config?: DbConfig): Pool {
  if (pool) return pool;
  const cfg = config ?? getDbConfigFromEnv();
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit ?? 10,
    queueLimit: 0,
    charset: "utf8mb4",
    timezone: "+09:00",
  } satisfies PoolOptions);
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
