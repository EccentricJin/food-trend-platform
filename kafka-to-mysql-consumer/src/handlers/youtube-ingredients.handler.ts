import type { Pool } from "mysql2/promise";
import { insertYouTubeIngredientPrice, type YouTubeIngredientRow } from "shared-db";

export async function handleYouTubeIngredients(
  pool: Pool, value: any, runId: string, partition: number, offset: number | null,
): Promise<void> {
  const row: YouTubeIngredientRow = {
    run_id: runId,
    ingredient: value.ingredient,
    keyword: value.keyword,
    requested_at: value.requestedAt,
    period: value.period ?? null,
    total_results: value.totalResults ?? null,
    video_id: value.video?.videoId ?? "",
    video_title: value.video?.title ?? "",
    video_description: value.video?.description ?? null,
    channel_title: value.video?.channelTitle ?? null,
    published_at: value.video?.publishedAt ?? null,
    thumbnail_url: value.video?.thumbnail ?? null,
    video_url: value.video?.url ?? null,
    view_count: value.statistics?.viewCount ?? null,
    like_count: value.statistics?.likeCount ?? null,
    comment_count: value.statistics?.commentCount ?? null,
    kafka_offset: offset,
    kafka_partition: partition,
  };
  await insertYouTubeIngredientPrice(pool, row);
}
