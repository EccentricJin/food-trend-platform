import type { Pool } from "mysql2/promise";
import type { GoogleSearchRow } from "../types.js";

export async function insertGoogleSearchResult(
  pool: Pool,
  row: GoogleSearchRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO google_search_results
       (run_id, category, keyword, requested_at, total_results, search_time,
        title, link, snippet, display_link, kafka_offset, kafka_partition)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.category, row.keyword, row.requested_at,
      row.total_results, row.search_time,
      row.title, row.link, row.snippet, row.display_link,
      row.kafka_offset ?? null, row.kafka_partition ?? null,
    ],
  );
}

export async function insertGoogleSearchResultsBatch(
  pool: Pool,
  rows: GoogleSearchRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.category, row.keyword, row.requested_at,
    row.total_results, row.search_time,
    row.title, row.link, row.snippet, row.display_link,
    row.kafka_offset ?? null, row.kafka_partition ?? null,
  ]);
  await pool.execute(
    `INSERT INTO google_search_results
       (run_id, category, keyword, requested_at, total_results, search_time,
        title, link, snippet, display_link, kafka_offset, kafka_partition)
     VALUES ${placeholders}`,
    values,
  );
}
