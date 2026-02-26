import type { Pool } from "mysql2/promise";
import type { GoogleRssNewsRow } from "../types.js";

export async function insertGoogleRssNewsBatch(
  pool: Pool,
  rows: GoogleRssNewsRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.keyword, row.title, row.link,
    row.publisher, row.published_at, row.summary, row.source,
  ]);
  await pool.execute(
    `INSERT IGNORE INTO google_rss_news
       (run_id, keyword, title, link, publisher, published_at, summary, source)
     VALUES ${placeholders}`,
    values,
  );
}

export async function markGoogleRssNewsAsSynced(
  pool: Pool,
  link: string,
  newsApiId: number,
): Promise<void> {
  await pool.execute(
    `UPDATE google_rss_news SET news_api_synced = 1, news_api_id = ? WHERE link = ?`,
    [String(newsApiId), link],
  );
}
