import type { Pool } from "mysql2/promise";
import type { YouTubeIngredientRow } from "../types.js";

export async function insertYouTubeIngredientPrice(
  pool: Pool,
  row: YouTubeIngredientRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO youtube_ingredient_prices
       (run_id, ingredient, keyword, requested_at, period, total_results,
        video_id, video_title, video_description, channel_title, published_at,
        thumbnail_url, video_url, view_count, like_count, comment_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.ingredient, row.keyword, row.requested_at, row.period, row.total_results,
      row.video_id, row.video_title, row.video_description, row.channel_title, row.published_at,
      row.thumbnail_url, row.video_url, row.view_count, row.like_count, row.comment_count,
    ],
  );
}

export async function insertYouTubeIngredientPricesBatch(
  pool: Pool,
  rows: YouTubeIngredientRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.ingredient, row.keyword, row.requested_at, row.period, row.total_results,
    row.video_id, row.video_title, row.video_description, row.channel_title, row.published_at,
    row.thumbnail_url, row.video_url, row.view_count, row.like_count, row.comment_count,
  ]);
  await pool.execute(
    `INSERT INTO youtube_ingredient_prices
       (run_id, ingredient, keyword, requested_at, period, total_results,
        video_id, video_title, video_description, channel_title, published_at,
        thumbnail_url, video_url, view_count, like_count, comment_count)
     VALUES ${placeholders}`,
    values,
  );
}
