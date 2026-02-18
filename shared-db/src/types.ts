// ── Collection Runs ──────────────────────────────────────────
export interface CollectionRunInput {
  source: string;
  collector: string;
}

// ── Google Search ────────────────────────────────────────────
export interface GoogleSearchRow {
  run_id: string | null;
  category: string;
  keyword: string;
  requested_at: string;
  total_results: string | null;
  search_time: number | null;
  title: string;
  link: string;
  snippet: string | null;
  display_link: string | null;
}

// ── YouTube Search ───────────────────────────────────────────
export interface YouTubeSearchRow {
  run_id: string | null;
  category: string;
  keyword: string;
  requested_at: string;
  total_results: number | null;
  video_id: string;
  video_title: string;
  video_description: string | null;
  channel_title: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
}

// ── YouTube Ingredient Prices ────────────────────────────────
export interface YouTubeIngredientRow {
  run_id: string | null;
  ingredient: string;
  keyword: string;
  requested_at: string;
  period: string | null;
  total_results: number | null;
  video_id: string;
  video_title: string;
  video_description: string | null;
  channel_title: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
}

// ── Naver Ingredient Prices (Shopping) ───────────────────────
export interface NaverIngredientPriceRow {
  run_id: string | null;
  ingredient: string;
  unit: string | null;
  keyword: string;
  requested_at: string;
  total_results: number | null;
  product_title: string;
  product_link: string | null;
  product_image: string | null;
  lprice: number | null;
  hprice: number | null;
  mall_name: string | null;
  brand: string | null;
  maker: string | null;
  product_type: string | null;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  category4: string | null;
}

// ── Naver Search Results (Trend) ─────────────────────────────
export interface NaverSearchRow {
  run_id: string | null;
  msg_type: string;
  category: string;
  keyword: string;
  search_type: string;
  requested_at: string;
  total_available: number | null;
  item_title: string | null;
  item_link: string | null;
  item_data: string; // JSON string
}

// ── Naver Ingredient Search Results ──────────────────────────
export interface NaverIngredientSearchRow {
  run_id: string | null;
  msg_type: string;
  category: string;
  ingredient: string;
  keyword: string;
  search_type: string;
  requested_at: string;
  price_stats_min: number | null;
  price_stats_max: number | null;
  price_stats_avg: number | null;
  price_stats_count: number | null;
  item_title: string | null;
  item_link: string | null;
  item_data: string; // JSON string
}

// ── Google RSS News ──────────────────────────────────────────
export interface GoogleRssNewsRow {
  run_id: string | null;
  keyword: string;
  title: string;
  link: string;
  publisher: string | null;
  published_at: string | null;
  summary: string | null;
  source: string;
  news_api_synced?: boolean;
  news_api_id?: string | null;
}
