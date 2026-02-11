import type { Pool } from "mysql2/promise";
import { randomUUID } from "crypto";
import type { CollectionRunInput } from "../types.js";

export async function startCollectionRun(
  pool: Pool,
  input: CollectionRunInput,
): Promise<string> {
  const runId = randomUUID();
  await pool.execute(
    `INSERT INTO collection_runs (run_id, source, collector, status, started_at)
     VALUES (?, ?, ?, 'running', NOW(3))`,
    [runId, input.source, input.collector],
  );
  return runId;
}

export async function completeCollectionRun(
  pool: Pool,
  runId: string,
  totalRecords: number,
): Promise<void> {
  await pool.execute(
    `UPDATE collection_runs SET status = 'completed', total_records = ?, finished_at = NOW(3) WHERE run_id = ?`,
    [totalRecords, runId],
  );
}

export async function failCollectionRun(
  pool: Pool,
  runId: string,
  error: string,
): Promise<void> {
  await pool.execute(
    `UPDATE collection_runs SET status = 'failed', error_message = ?, finished_at = NOW(3) WHERE run_id = ?`,
    [error, runId],
  );
}
