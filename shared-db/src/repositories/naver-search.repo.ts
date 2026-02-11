import type { Pool } from "mysql2/promise";
import type { NaverSearchRow } from "../types.js";

export async function insertNaverSearchResult(
  pool: Pool,
  row: NaverSearchRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO naver_search_results
       (run_id, msg_type, category, keyword, search_type, requested_at,
        total_available, item_title, item_link, item_data,
        kafka_offset, kafka_partition)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.msg_type, row.category, row.keyword, row.search_type, row.requested_at,
      row.total_available, row.item_title, row.item_link, row.item_data,
      row.kafka_offset ?? null, row.kafka_partition ?? null,
    ],
  );
}

export async function insertNaverSearchResultsBatch(
  pool: Pool,
  rows: NaverSearchRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.msg_type, row.category, row.keyword, row.search_type, row.requested_at,
    row.total_available, row.item_title, row.item_link, row.item_data,
    row.kafka_offset ?? null, row.kafka_partition ?? null,
  ]);
  await pool.execute(
    `INSERT INTO naver_search_results
       (run_id, msg_type, category, keyword, search_type, requested_at,
        total_available, item_title, item_link, item_data,
        kafka_offset, kafka_partition)
     VALUES ${placeholders}`,
    values,
  );
}
