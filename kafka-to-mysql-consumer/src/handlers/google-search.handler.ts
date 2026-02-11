import type { Pool } from "mysql2/promise";
import { insertGoogleSearchResult, type GoogleSearchRow } from "shared-db";

export async function handleGoogleSearch(
  pool: Pool, value: any, runId: string, partition: number, offset: number | null,
): Promise<void> {
  const row: GoogleSearchRow = {
    run_id: runId,
    category: value.category,
    keyword: value.keyword,
    requested_at: value.requestedAt,
    total_results: value.totalResults ?? null,
    search_time: value.searchTime ?? null,
    title: value.item?.title ?? "",
    link: value.item?.link ?? "",
    snippet: value.item?.snippet ?? null,
    display_link: value.item?.displayLink ?? null,
    kafka_offset: offset,
    kafka_partition: partition,
  };
  await insertGoogleSearchResult(pool, row);
}
