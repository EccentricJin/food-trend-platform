import type { Pool } from "mysql2/promise";
import {
  insertNaverSearchResult, insertNaverIngredientSearchResult,
  type NaverSearchRow, type NaverIngredientSearchRow,
} from "shared-db";

export async function handleNaverSearch(
  pool: Pool, value: any, runId: string, partition: number, offset: number | null,
): Promise<void> {
  const msgType = value.type as string;

  if (msgType === "search_news" || msgType === "search_blog" || msgType === "search_shop") {
    const row: NaverSearchRow = {
      run_id: runId,
      msg_type: msgType,
      category: value.category,
      keyword: value.keyword,
      search_type: value.searchType,
      requested_at: value.requestedAt,
      total_available: value.totalAvailable ?? null,
      item_title: value.item?.title ?? null,
      item_link: value.item?.link ?? null,
      item_data: JSON.stringify(value.item ?? {}),
      kafka_offset: offset,
      kafka_partition: partition,
    };
    await insertNaverSearchResult(pool, row);
  } else if (
    msgType === "ingredient_price" ||
    msgType === "ingredient_news" ||
    msgType === "ingredient_blog"
  ) {
    const row: NaverIngredientSearchRow = {
      run_id: runId,
      msg_type: msgType,
      category: value.category,
      ingredient: value.ingredient,
      keyword: value.keyword,
      search_type: value.searchType,
      requested_at: value.requestedAt,
      price_stats_min: value.priceStats?.min ?? null,
      price_stats_max: value.priceStats?.max ?? null,
      price_stats_avg: value.priceStats?.avg ?? null,
      price_stats_count: value.priceStats?.count ?? null,
      item_title: value.item?.title ?? null,
      item_link: value.item?.link ?? null,
      item_data: JSON.stringify(value.item ?? {}),
      kafka_offset: offset,
      kafka_partition: partition,
    };
    await insertNaverIngredientSearchResult(pool, row);
  }
}
