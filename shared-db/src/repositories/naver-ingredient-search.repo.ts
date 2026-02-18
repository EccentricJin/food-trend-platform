import type { Pool } from "mysql2/promise";
import type { NaverIngredientSearchRow } from "../types.js";

export async function insertNaverIngredientSearchResult(
  pool: Pool,
  row: NaverIngredientSearchRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO naver_ingredient_search_results
       (run_id, msg_type, category, ingredient, keyword, search_type, requested_at,
        price_stats_min, price_stats_max, price_stats_avg, price_stats_count,
        item_title, item_link, item_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.msg_type, row.category, row.ingredient, row.keyword, row.search_type, row.requested_at,
      row.price_stats_min, row.price_stats_max, row.price_stats_avg, row.price_stats_count,
      row.item_title, row.item_link, row.item_data,
    ],
  );
}

export async function insertNaverIngredientSearchResultsBatch(
  pool: Pool,
  rows: NaverIngredientSearchRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.msg_type, row.category, row.ingredient, row.keyword, row.search_type, row.requested_at,
    row.price_stats_min, row.price_stats_max, row.price_stats_avg, row.price_stats_count,
    row.item_title, row.item_link, row.item_data,
  ]);
  await pool.execute(
    `INSERT INTO naver_ingredient_search_results
       (run_id, msg_type, category, ingredient, keyword, search_type, requested_at,
        price_stats_min, price_stats_max, price_stats_avg, price_stats_count,
        item_title, item_link, item_data)
     VALUES ${placeholders}`,
    values,
  );
}
