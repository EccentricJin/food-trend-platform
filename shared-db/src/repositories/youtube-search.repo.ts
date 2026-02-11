import type { Pool } from "mysql2/promise";
import type { YouTubeSearchRow } from "../types.js";

export async function insertYouTubeSearchResult(
  pool: Pool,
  row: YouTubeSearchRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO youtube_search_results
       (run_id, category, keyword, requested_at, total_results,
        video_id, video_title, video_description, channel_title, published_at,
        thumbnail_url, video_url, view_count, like_count, comment_count,
        kafka_offset, kafka_partition)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.category, row.keyword, row.requested_at, row.total_results,
      row.video_id, row.video_title, row.video_description, row.channel_title, row.published_at,
      row.thumbnail_url, row.video_url, row.view_count, row.like_count, row.comment_count,
      row.kafka_offset ?? null, row.kafka_partition ?? null,
    ],
  );
}

export async function insertYouTubeSearchResultsBatch(
  pool: Pool,
  rows: YouTubeSearchRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.category, row.keyword, row.requested_at, row.total_results,
    row.video_id, row.video_title, row.video_description, row.channel_title, row.published_at,
    row.thumbnail_url, row.video_url, row.view_count, row.like_count, row.comment_count,
    row.kafka_offset ?? null, row.kafka_partition ?? null,
  ]);
  await pool.execute(
    `INSERT INTO youtube_search_results
       (run_id, category, keyword, requested_at, total_results,
        video_id, video_title, video_description, channel_title, published_at,
        thumbnail_url, video_url, view_count, like_count, comment_count,
        kafka_offset, kafka_partition)
     VALUES ${placeholders}`,
    values,
  );
}
