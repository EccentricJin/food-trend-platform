/**
 * 카페/빵집/디저트 트렌드 종합 수집 → EC2 전송
 *
 * 수집 카테고리:
 *   A. 검색 트렌드 — 네이버 쇼핑 인기 검색어 + 상품 분석
 *   B. 뉴스 언급량 — 네이버 뉴스 API 키워드별 기사 수
 *   C. 유튜브 트렌드 — YouTube Data API 검색량/인기 영상
 *   D. 소셜 버즈 — 네이버 블로그/카페 언급량
 *
 * 트렌드 키워드 (6개 카테고리):
 *   1. 카페 트렌드 (스페셜티, 디카페인, 플랫화이트 등)
 *   2. 빵집 트렌드 (소금빵, 크루아상, 베이글 등)
 *   3. 디저트 트렌드 (마카롱, 크로플, 약과 등)
 *   4. 원자재 가격 이슈 (밀가루, 버터, 설탕 등)
 *   5. 업계 이슈 (프랜차이즈, 소상공인, 배달 등)
 *   6. 시즌/이벤트 (발렌타인, 화이트데이, 크리스마스 등)
 *
 * 전송: EC2 News API (POST /api/internal/news/articles/batch)
 *
 * 실행: npx tsx src/sync-trends-to-ec2.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env 수동 로드
try {
  const envPath = resolve(__dirname, "..", ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env 없으면 환경변수에서 직접 읽음
}

// ── 설정 ──
const EC2_BASE_URL = process.env.EC2_NEWS_API_URL ?? "http://13.124.248.151";
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID ?? "";

const BATCH_SIZE = 20;
const TREND_HISTORY_FILE = resolve(__dirname, "..", "trend-history.json");

// ════════════════════════════════════════════════════════════════
// 1. 트렌드 키워드 정의 (6개 카테고리)
// ════════════════════════════════════════════════════════════════

interface TrendKeyword {
  keyword: string;
  category: string;
  categoryEn: string;
  icon: string;
}

const TREND_KEYWORDS: TrendKeyword[] = [
  // ── 카페 트렌드 ──
  { keyword: "스페셜티 커피", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "디카페인 커피", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "플랫화이트", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "카페 창업", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "아인슈페너", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "오트밀크", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "🥛" },
  { keyword: "카페 인테리어", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "🏠" },
  { keyword: "드립커피", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },

  // ── 빵집 트렌드 ──
  { keyword: "소금빵", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🍞" },
  { keyword: "크루아상", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🥐" },
  { keyword: "베이글", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🥯" },
  { keyword: "식빵 맛집", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🍞" },
  { keyword: "베이커리 카페", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🏪" },
  { keyword: "천연발효빵", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🌾" },
  { keyword: "빵지순례", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🗺️" },
  { keyword: "동네빵집", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🏘️" },

  // ── 디저트 트렌드 ──
  { keyword: "마카롱", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍪" },
  { keyword: "크로플", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🧇" },
  { keyword: "약과", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍯" },
  { keyword: "생과일 케이크", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🎂" },
  { keyword: "티라미수", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍰" },
  { keyword: "바스크 치즈케이크", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🧀" },
  { keyword: "디저트 카페", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍰" },
  { keyword: "수제 쿠키", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍪" },

  // ── 원자재 가격 이슈 ──
  { keyword: "밀가루 가격", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "🌾" },
  { keyword: "버터 가격", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "🧈" },
  { keyword: "설탕 가격", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "🍬" },
  { keyword: "커피 원두 가격", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "☕" },
  { keyword: "계란 가격 전망", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "🥚" },
  { keyword: "생크림 가격", category: "원자재 이슈", categoryEn: "ingredient_issue", icon: "🍦" },

  // ── 업계 이슈 ──
  { keyword: "카페 프랜차이즈", category: "업계 이슈", categoryEn: "industry_issue", icon: "🏢" },
  { keyword: "소상공인 카페", category: "업계 이슈", categoryEn: "industry_issue", icon: "🏪" },
  { keyword: "배달 디저트", category: "업계 이슈", categoryEn: "industry_issue", icon: "🛵" },
  { keyword: "무인카페", category: "업계 이슈", categoryEn: "industry_issue", icon: "🤖" },
  { keyword: "카페 폐업", category: "업계 이슈", categoryEn: "industry_issue", icon: "📉" },
  { keyword: "디저트 배달", category: "업계 이슈", categoryEn: "industry_issue", icon: "📦" },

  // ── 시즌/이벤트 ──
  { keyword: "발렌타인 초콜릿", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "💝" },
  { keyword: "화이트데이 선물", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🎁" },
  { keyword: "봄 딸기 케이크", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🍓" },
  { keyword: "크리스마스 케이크", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🎄" },
  { keyword: "벚꽃 시즌 카페", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🌸" },
];

// ════════════════════════════════════════════════════════════════
// 2. 타입 정의
// ════════════════════════════════════════════════════════════════

interface TrendDataPoint {
  keyword: string;
  category: string;
  categoryEn: string;
  icon: string;
  date: string;

  // 네이버 쇼핑 인사이트
  naverShopping: {
    totalProducts: number;
    avgPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    topMalls: string[];
  } | null;

  // 네이버 뉴스 언급량
  naverNews: {
    totalArticles: number;
    recentArticles: Array<{ title: string; url: string; pubDate: string }>;
  } | null;

  // 네이버 블로그 언급량
  naverBlog: {
    totalPosts: number;
  } | null;

  // 네이버 카페 언급량
  naverCafe: {
    totalPosts: number;
  } | null;

  // 유튜브 트렌드
  youtube: {
    totalVideos: number;
    recentVideos: Array<{
      title: string;
      channelTitle: string;
      viewCount: number;
      publishedAt: string;
      videoId: string;
    }>;
  } | null;

  // 종합 버즈 스코어
  buzzScore: number;
  buzzLevel: "🔥 핫" | "📈 상승" | "➡️ 보통" | "📉 하락" | "🆕 신규";
}

interface TrendHistory {
  version: number;
  lastUpdated: string;
  dailyBuzz: Array<{
    date: string;
    keyword: string;
    buzzScore: number;
  }>;
}

// EC2 전송용
interface NewsArticle {
  title: string;
  url: string;
  source: string | null;
  publisher: string | null;
  summary: string | null;
  publishedAt: string | null;
}

interface BatchResponse {
  total: number;
  created: number;
  updated: number;
  results: Array<{ newsId: number; created: boolean }>;
}

// ════════════════════════════════════════════════════════════════
// 3. 유틸리티
// ════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, "");
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 2) + "..";
}

// ════════════════════════════════════════════════════════════════
// 4. 네이버 검색 API (쇼핑/뉴스/블로그/카페)
// ════════════════════════════════════════════════════════════════

async function naverSearch(
  type: "shop" | "news" | "blog" | "cafearticle",
  query: string,
  display = 100,
  sort = "sim",
): Promise<any> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER API 키 없음");
  }

  const url = new URL(`https://openapi.naver.com/v1/search/${type}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(display, 100)));
  url.searchParams.set("sort", sort);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    throw new Error(`Naver ${type} API 오류 (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// ── 네이버 쇼핑 ──
async function collectNaverShopping(keyword: string): Promise<TrendDataPoint["naverShopping"]> {
  try {
    const data = await naverSearch("shop", keyword, 100, "sim");
    const items = data.items || [];
    const totalProducts = data.total || 0;

    if (items.length === 0) {
      return { totalProducts: 0, avgPrice: null, minPrice: null, maxPrice: null, topMalls: [] };
    }

    const prices = items
      .map((i: any) => parseInt(i.lprice || "0"))
      .filter((p: number) => p > 0);

    const mallCounts = new Map<string, number>();
    for (const item of items) {
      const mall = item.mallName || "기타";
      mallCounts.set(mall, (mallCounts.get(mall) ?? 0) + 1);
    }
    const topMalls = [...mallCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    return {
      totalProducts,
      avgPrice: prices.length > 0 ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length) : null,
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      topMalls,
    };
  } catch (e) {
    console.log(`      [쇼핑] 오류: ${(e as Error).message}`);
    return null;
  }
}

// ── 네이버 뉴스 ──
async function collectNaverNews(keyword: string): Promise<TrendDataPoint["naverNews"]> {
  try {
    const data = await naverSearch("news", keyword, 10, "date");
    const items = data.items || [];
    const totalArticles = data.total || 0;

    return {
      totalArticles,
      recentArticles: items.slice(0, 5).map((item: any) => ({
        title: cleanHtml(item.title),
        url: item.originallink || item.link,
        pubDate: item.pubDate || "",
      })),
    };
  } catch (e) {
    console.log(`      [뉴스] 오류: ${(e as Error).message}`);
    return null;
  }
}

// ── 네이버 블로그 ──
async function collectNaverBlog(keyword: string): Promise<TrendDataPoint["naverBlog"]> {
  try {
    const data = await naverSearch("blog", keyword, 1, "date");
    return { totalPosts: data.total || 0 };
  } catch (e) {
    console.log(`      [블로그] 오류: ${(e as Error).message}`);
    return null;
  }
}

// ── 네이버 카페 ──
async function collectNaverCafe(keyword: string): Promise<TrendDataPoint["naverCafe"]> {
  try {
    const data = await naverSearch("cafearticle", keyword, 1, "date");
    return { totalPosts: data.total || 0 };
  } catch (e) {
    console.log(`      [카페] 오류: ${(e as Error).message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 5. YouTube Data API
// ════════════════════════════════════════════════════════════════

interface YTSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    description: string;
  };
}

interface YTVideoStats {
  id: string;
  statistics: {
    viewCount: string;
    likeCount?: string;
    commentCount?: string;
  };
}

async function searchYouTube(query: string, maxResults = 10): Promise<TrendDataPoint["youtube"]> {
  if (!YOUTUBE_API_KEY) {
    return null;
  }

  try {
    // 검색
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("key", YOUTUBE_API_KEY);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("regionCode", "KR");
    searchUrl.searchParams.set("relevanceLanguage", "ko");
    searchUrl.searchParams.set("maxResults", String(maxResults));
    searchUrl.searchParams.set("order", "date");
    // 최근 1주일
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    searchUrl.searchParams.set("publishedAfter", weekAgo.toISOString());

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      const errText = await searchRes.text();
      if (errText.includes("quotaExceeded")) {
        return null; // 쿼터 초과 → 조용히 스킵
      }
      throw new Error(`YouTube Search 오류 (${searchRes.status})`);
    }

    const searchData = await searchRes.json() as { items: YTSearchItem[]; pageInfo: { totalResults: number } };
    const items = searchData.items || [];
    const totalVideos = searchData.pageInfo?.totalResults || items.length;

    if (items.length === 0) {
      return { totalVideos: 0, recentVideos: [] };
    }

    // 조회수 가져오기
    const videoIds = items.map((i) => i.id.videoId).join(",");
    const statsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    statsUrl.searchParams.set("key", YOUTUBE_API_KEY);
    statsUrl.searchParams.set("id", videoIds);
    statsUrl.searchParams.set("part", "statistics");

    const statsRes = await fetch(statsUrl.toString());
    const statsMap = new Map<string, number>();

    if (statsRes.ok) {
      const statsData = await statsRes.json() as { items: YTVideoStats[] };
      for (const item of statsData.items || []) {
        statsMap.set(item.id, parseInt(item.statistics.viewCount || "0"));
      }
    }

    return {
      totalVideos,
      recentVideos: items.slice(0, 5).map((item) => ({
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        viewCount: statsMap.get(item.id.videoId) ?? 0,
        publishedAt: item.snippet.publishedAt,
        videoId: item.id.videoId,
      })),
    };
  } catch (e) {
    console.log(`      [YouTube] 오류: ${(e as Error).message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 6. 버즈 스코어 계산
// ════════════════════════════════════════════════════════════════

function calculateBuzzScore(data: TrendDataPoint): number {
  let score = 0;

  // 뉴스 언급량 (가중치 높음)
  if (data.naverNews) {
    const newsCount = data.naverNews.totalArticles;
    if (newsCount >= 1000) score += 40;
    else if (newsCount >= 500) score += 30;
    else if (newsCount >= 100) score += 20;
    else if (newsCount >= 30) score += 10;
    else if (newsCount >= 10) score += 5;
  }

  // 블로그 언급량
  if (data.naverBlog) {
    const blogCount = data.naverBlog.totalPosts;
    if (blogCount >= 100000) score += 25;
    else if (blogCount >= 50000) score += 20;
    else if (blogCount >= 10000) score += 15;
    else if (blogCount >= 5000) score += 10;
    else if (blogCount >= 1000) score += 5;
  }

  // 카페 언급량
  if (data.naverCafe) {
    const cafeCount = data.naverCafe.totalPosts;
    if (cafeCount >= 50000) score += 15;
    else if (cafeCount >= 10000) score += 10;
    else if (cafeCount >= 5000) score += 7;
    else if (cafeCount >= 1000) score += 3;
  }

  // 쇼핑 상품 수
  if (data.naverShopping) {
    const productCount = data.naverShopping.totalProducts;
    if (productCount >= 10000) score += 10;
    else if (productCount >= 5000) score += 7;
    else if (productCount >= 1000) score += 5;
    else if (productCount >= 100) score += 2;
  }

  // YouTube 인기도
  if (data.youtube) {
    const videoCount = data.youtube.totalVideos;
    if (videoCount >= 100) score += 10;
    else if (videoCount >= 50) score += 7;
    else if (videoCount >= 20) score += 5;
    else if (videoCount >= 5) score += 2;

    // 조회수 보너스
    const maxViews = Math.max(...(data.youtube.recentVideos.map((v) => v.viewCount) || [0]));
    if (maxViews >= 1000000) score += 10;
    else if (maxViews >= 100000) score += 5;
    else if (maxViews >= 10000) score += 2;
  }

  return Math.min(100, score); // 최대 100점
}

function getBuzzLevel(
  score: number,
  prevScore: number | null,
): TrendDataPoint["buzzLevel"] {
  if (prevScore === null) return "🆕 신규";
  if (score >= 60) return "🔥 핫";

  const diff = score - prevScore;
  if (diff >= 10) return "📈 상승";
  if (diff <= -10) return "📉 하락";
  return "➡️ 보통";
}

// ════════════════════════════════════════════════════════════════
// 7. 트렌드 이력 관리
// ════════════════════════════════════════════════════════════════

function loadTrendHistory(): TrendHistory {
  if (existsSync(TREND_HISTORY_FILE)) {
    try {
      return JSON.parse(readFileSync(TREND_HISTORY_FILE, "utf-8")) as TrendHistory;
    } catch {}
  }
  return { version: 1, lastUpdated: "", dailyBuzz: [] };
}

function saveTrendHistory(history: TrendHistory): void {
  history.lastUpdated = new Date().toISOString();
  // 30일 이전 데이터 정리
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  history.dailyBuzz = history.dailyBuzz.filter((d) => d.date >= cutoffStr);
  writeFileSync(TREND_HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

function getPrevBuzzScore(history: TrendHistory, keyword: string): number | null {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const ydStr = yesterday.toISOString().split("T")[0];

  // 어제 ±2일 범위
  const candidates = history.dailyBuzz
    .filter((d) => d.keyword === keyword)
    .filter((d) => {
      const diff = Math.abs(new Date(d.date).getTime() - yesterday.getTime());
      return diff <= 2 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => {
      const diffA = Math.abs(new Date(a.date).getTime() - yesterday.getTime());
      const diffB = Math.abs(new Date(b.date).getTime() - yesterday.getTime());
      return diffA - diffB;
    });

  return candidates.length > 0 ? candidates[0].buzzScore : null;
}

// ════════════════════════════════════════════════════════════════
// 8. EC2 전송
// ════════════════════════════════════════════════════════════════

async function sendToEc2(articles: NewsArticle[]): Promise<BatchResponse> {
  const res = await fetch(
    `${EC2_BASE_URL}/api/internal/news/articles/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: articles }),
    },
  );

  if (!res.ok) {
    throw new Error(`EC2 API 오류 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<BatchResponse>;
}

function buildTrendArticle(data: TrendDataPoint): NewsArticle {
  const date = data.date;
  const slug = data.keyword.replace(/\s+/g, "-");

  // 제목 구성
  const title =
    `[트렌드] ${data.icon} ${data.keyword} ` +
    `버즈스코어 ${data.buzzScore}점 ${data.buzzLevel} ` +
    `(${data.category}, ${date})`;

  // 요약 구성
  const parts: string[] = [];
  parts.push(`[${data.category}] "${data.keyword}" 트렌드 종합 분석.`);

  if (data.naverNews) {
    parts.push(`뉴스 언급: ${formatNumber(data.naverNews.totalArticles)}건.`);
  }
  if (data.naverBlog) {
    parts.push(`블로그: ${formatNumber(data.naverBlog.totalPosts)}건.`);
  }
  if (data.naverCafe) {
    parts.push(`카페: ${formatNumber(data.naverCafe.totalPosts)}건.`);
  }
  if (data.naverShopping) {
    parts.push(`쇼핑 상품: ${formatNumber(data.naverShopping.totalProducts)}건.`);
    if (data.naverShopping.avgPrice) {
      parts.push(`평균가: ${formatNumber(data.naverShopping.avgPrice)}원.`);
    }
  }
  if (data.youtube) {
    parts.push(`YouTube: 최근 1주 ${formatNumber(data.youtube.totalVideos)}건.`);
    if (data.youtube.recentVideos.length > 0) {
      const topVideo = data.youtube.recentVideos[0];
      parts.push(`인기영상: "${truncate(topVideo.title, 30)}" (${formatNumber(topVideo.viewCount)}회).`);
    }
  }

  parts.push(`종합 버즈스코어: ${data.buzzScore}/100점 (${data.buzzLevel}).`);

  return {
    title: truncate(title, 200),
    url: `https://trend.breadalert.com/daily/${date}/${encodeURIComponent(slug)}`,
    source: "trend_analysis",
    publisher: "BreadAlert 트렌드",
    summary: parts.join(" ").slice(0, 500),
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  };
}

// 카테고리 종합 리포트 기사
function buildCategoryReportArticle(
  category: string,
  categoryEn: string,
  trends: TrendDataPoint[],
  date: string,
): NewsArticle {
  const sorted = [...trends].sort((a, b) => b.buzzScore - a.buzzScore);
  const top3 = sorted.slice(0, 3);

  const title =
    `[카테고리 리포트] ${category} TOP 트렌드 — ` +
    top3.map((t) => `${t.icon}${t.keyword}(${t.buzzScore}점)`).join(", ") +
    ` (${date})`;

  const parts: string[] = [];
  parts.push(`${category} 트렌드 종합 리포트.`);
  parts.push(`총 ${trends.length}개 키워드 분석.`);

  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const t = sorted[i];
    parts.push(
      `${i + 1}위: ${t.icon} ${t.keyword} (${t.buzzScore}점, ${t.buzzLevel}).`,
    );
  }

  const avgScore = Math.round(
    trends.reduce((sum, t) => sum + t.buzzScore, 0) / trends.length,
  );
  parts.push(`카테고리 평균 버즈스코어: ${avgScore}점.`);

  const hotKeywords = trends.filter((t) => t.buzzLevel === "🔥 핫");
  const risingKeywords = trends.filter((t) => t.buzzLevel === "📈 상승");
  if (hotKeywords.length > 0) {
    parts.push(`핫 키워드: ${hotKeywords.map((t) => t.keyword).join(", ")}.`);
  }
  if (risingKeywords.length > 0) {
    parts.push(`상승 키워드: ${risingKeywords.map((t) => t.keyword).join(", ")}.`);
  }

  return {
    title: truncate(title, 200),
    url: `https://trend.breadalert.com/report/${date}/${categoryEn}`,
    source: "trend_category_report",
    publisher: "BreadAlert 트렌드",
    summary: parts.join(" ").slice(0, 500),
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  };
}

// 전체 종합 리포트
function buildDailyOverviewArticle(
  allTrends: TrendDataPoint[],
  date: string,
): NewsArticle {
  const sorted = [...allTrends].sort((a, b) => b.buzzScore - a.buzzScore);
  const top5 = sorted.slice(0, 5);

  const title =
    `[일일 트렌드 종합] 빵집·카페·디저트 업계 TOP5 — ` +
    top5.map((t) => `${t.keyword}(${t.buzzScore})`).join(", ") +
    ` (${date})`;

  const parts: string[] = [];
  parts.push(`${date} 빵집/카페/디저트 업계 트렌드 종합 리포트.`);
  parts.push(`총 ${allTrends.length}개 키워드 분석.`);

  // 카테고리별 요약
  const categories = new Map<string, TrendDataPoint[]>();
  for (const t of allTrends) {
    const arr = categories.get(t.category) ?? [];
    arr.push(t);
    categories.set(t.category, arr);
  }

  for (const [cat, trends] of categories) {
    const catAvg = Math.round(
      trends.reduce((sum, t) => sum + t.buzzScore, 0) / trends.length,
    );
    const topKw = trends.sort((a, b) => b.buzzScore - a.buzzScore)[0];
    parts.push(
      `[${cat}] 평균 ${catAvg}점. 1위: ${topKw.keyword} (${topKw.buzzScore}점).`,
    );
  }

  // 전체 통계
  const totalBuzz = allTrends.reduce((sum, t) => sum + t.buzzScore, 0);
  const avgBuzz = Math.round(totalBuzz / allTrends.length);
  const hotCount = allTrends.filter((t) => t.buzzLevel === "🔥 핫").length;
  const risingCount = allTrends.filter((t) => t.buzzLevel === "📈 상승").length;

  parts.push(
    `전체 평균 버즈: ${avgBuzz}점. 핫 키워드 ${hotCount}개, 상승 ${risingCount}개.`,
  );

  return {
    title: truncate(title, 200),
    url: `https://trend.breadalert.com/daily-overview/${date}`,
    source: "trend_daily_overview",
    publisher: "BreadAlert 트렌드",
    summary: parts.join(" ").slice(0, 500),
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  };
}

// ════════════════════════════════════════════════════════════════
// 9. 콘솔 리포트 출력
// ════════════════════════════════════════════════════════════════

function printTrendReport(allTrends: TrendDataPoint[]): void {
  // 카테고리별 그룹핑
  const categories = new Map<string, TrendDataPoint[]>();
  for (const t of allTrends) {
    const arr = categories.get(t.category) ?? [];
    arr.push(t);
    categories.set(t.category, arr);
  }

  for (const [cat, trends] of categories) {
    const sorted = [...trends].sort((a, b) => b.buzzScore - a.buzzScore);

    console.log();
    console.log(`  ┌─ ${cat} ${"─".repeat(55 - cat.length)}`);
    console.log(
      `  │ ${"키워드".padEnd(16)}` +
      `${"뉴스".padStart(8)}` +
      `${"블로그".padStart(9)}` +
      `${"카페".padStart(8)}` +
      `${"쇼핑".padStart(8)}` +
      `${"YouTube".padStart(9)}` +
      `${"버즈".padStart(6)}` +
      `  등급`,
    );
    console.log(`  │ ${"─".repeat(66)}`);

    for (const t of sorted) {
      const news = t.naverNews ? formatNumber(t.naverNews.totalArticles) : "-";
      const blog = t.naverBlog ? formatNumber(t.naverBlog.totalPosts) : "-";
      const cafe = t.naverCafe ? formatNumber(t.naverCafe.totalPosts) : "-";
      const shop = t.naverShopping ? formatNumber(t.naverShopping.totalProducts) : "-";
      const yt = t.youtube ? formatNumber(t.youtube.totalVideos) : "-";

      console.log(
        `  │ ${t.icon} ${t.keyword.padEnd(14)}` +
        `${news.padStart(8)}` +
        `${blog.padStart(9)}` +
        `${cafe.padStart(8)}` +
        `${shop.padStart(8)}` +
        `${yt.padStart(9)}` +
        `${String(t.buzzScore).padStart(6)}` +
        `  ${t.buzzLevel}`,
      );
    }

    const catAvg = Math.round(
      sorted.reduce((sum, t) => sum + t.buzzScore, 0) / sorted.length,
    );
    console.log(`  │ ${"─".repeat(66)}`);
    console.log(`  │ 카테고리 평균 버즈스코어: ${catAvg}점`);
    console.log(`  └${"─".repeat(67)}`);
  }

  // 전체 TOP 10
  const allSorted = [...allTrends].sort((a, b) => b.buzzScore - a.buzzScore);
  console.log();
  console.log("  ★ 전체 TOP 10 트렌드 키워드");
  console.log("  " + "─".repeat(67));

  for (let i = 0; i < Math.min(10, allSorted.length); i++) {
    const t = allSorted[i];
    const bar = "█".repeat(Math.round(t.buzzScore / 5));
    console.log(
      `  ${String(i + 1).padStart(2)}. ${t.icon} ${t.keyword.padEnd(16)} ` +
      `${String(t.buzzScore).padStart(3)}점 ${bar} ${t.buzzLevel}`,
    );
  }

  // 핫 키워드 알림
  const hotKeywords = allTrends.filter((t) => t.buzzLevel === "🔥 핫");
  const risingKeywords = allTrends.filter((t) => t.buzzLevel === "📈 상승");

  if (hotKeywords.length > 0 || risingKeywords.length > 0) {
    console.log();
    console.log("  ⚠️ 사장님 알림:");
    for (const t of hotKeywords) {
      console.log(`    🔥 "${t.keyword}" — 현재 매우 인기! (버즈 ${t.buzzScore}점)`);
    }
    for (const t of risingKeywords) {
      console.log(`    📈 "${t.keyword}" — 관심도 상승중 (버즈 ${t.buzzScore}점)`);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 10. 메인 실행
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timeStr = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = todayStr();

  console.log();
  console.log("═".repeat(70));
  console.log("  빵집·카페·디저트 트렌드 종합 수집 → EC2 전송");
  console.log("═".repeat(70));
  console.log(`  실행 시각: ${dateStr} ${timeStr}`);
  console.log(`  EC2 대상: ${EC2_BASE_URL}`);
  console.log(`  키워드: ${TREND_KEYWORDS.length}개 (6개 카테고리)`);
  console.log(`  소스: 네이버 (뉴스/블로그/카페/쇼핑) + YouTube`);
  console.log("═".repeat(70));

  // ── 이력 로드 ──
  const history = loadTrendHistory();
  console.log(`\n  기존 이력: ${history.dailyBuzz.length}건`);

  // ── EC2 연결 확인 ──
  console.log("\n[0] EC2 서버 연결 확인...");
  let ec2Available = false;
  try {
    const healthRes = await fetch(
      `${EC2_BASE_URL}/api/internal/news/articles/latest?size=1`,
    );
    if (healthRes.ok) {
      console.log("  ✅ EC2 연결 성공");
      ec2Available = true;
    }
  } catch (e) {
    console.log(`  ⚠️ EC2 연결 실패: ${(e as Error).message}`);
  }

  // ── 키워드별 트렌드 수집 ──
  const allTrends: TrendDataPoint[] = [];
  let youtubeQuotaExceeded = false;
  let apiCallCount = 0;

  // 카테고리별 진행
  const categoryGroups = new Map<string, TrendKeyword[]>();
  for (const kw of TREND_KEYWORDS) {
    const arr = categoryGroups.get(kw.category) ?? [];
    arr.push(kw);
    categoryGroups.set(kw.category, arr);
  }

  let categoryIdx = 0;
  const totalCategories = categoryGroups.size;

  for (const [category, keywords] of categoryGroups) {
    categoryIdx++;
    console.log(`\n[${ categoryIdx}/${totalCategories}] 📊 ${category} (${keywords.length}개 키워드)`);
    console.log("─".repeat(70));

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      console.log(`  [${i + 1}/${keywords.length}] ${kw.icon} ${kw.keyword}`);

      const data: TrendDataPoint = {
        keyword: kw.keyword,
        category: kw.category,
        categoryEn: kw.categoryEn,
        icon: kw.icon,
        date: today,
        naverShopping: null,
        naverNews: null,
        naverBlog: null,
        naverCafe: null,
        youtube: null,
        buzzScore: 0,
        buzzLevel: "🆕 신규",
      };

      // A. 네이버 쇼핑
      data.naverShopping = await collectNaverShopping(kw.keyword);
      if (data.naverShopping) {
        console.log(
          `      쇼핑: ${formatNumber(data.naverShopping.totalProducts)}건` +
          (data.naverShopping.avgPrice ? ` (평균 ${formatNumber(data.naverShopping.avgPrice)}원)` : ""),
        );
      }
      apiCallCount++;
      await sleep(150);

      // B. 네이버 뉴스
      data.naverNews = await collectNaverNews(kw.keyword);
      if (data.naverNews) {
        console.log(`      뉴스: ${formatNumber(data.naverNews.totalArticles)}건`);
      }
      apiCallCount++;
      await sleep(150);

      // C. 네이버 블로그
      data.naverBlog = await collectNaverBlog(kw.keyword);
      if (data.naverBlog) {
        console.log(`      블로그: ${formatNumber(data.naverBlog.totalPosts)}건`);
      }
      apiCallCount++;
      await sleep(150);

      // D. 네이버 카페
      data.naverCafe = await collectNaverCafe(kw.keyword);
      if (data.naverCafe) {
        console.log(`      카페: ${formatNumber(data.naverCafe.totalPosts)}건`);
      }
      apiCallCount++;
      await sleep(150);

      // E. YouTube (쿼터 초과 시 스킵)
      if (!youtubeQuotaExceeded) {
        data.youtube = await searchYouTube(kw.keyword, 5);
        if (data.youtube === null && YOUTUBE_API_KEY) {
          youtubeQuotaExceeded = true;
          console.log("      YouTube: ⚠️ 쿼터 초과 → 이후 스킵");
        } else if (data.youtube) {
          console.log(
            `      YouTube: ${formatNumber(data.youtube.totalVideos)}건` +
            (data.youtube.recentVideos.length > 0
              ? ` (최고조회 ${formatNumber(data.youtube.recentVideos.sort((a, b) => b.viewCount - a.viewCount)[0]?.viewCount || 0)}회)`
              : ""),
          );
          apiCallCount += 2; // search + stats
        }
      } else {
        console.log("      YouTube: (쿼터 초과 스킵)");
      }

      // 버즈 스코어 계산
      data.buzzScore = calculateBuzzScore(data);
      const prevScore = getPrevBuzzScore(history, kw.keyword);
      data.buzzLevel = getBuzzLevel(data.buzzScore, prevScore);

      console.log(`      → 버즈스코어: ${data.buzzScore}점 ${data.buzzLevel}`);

      allTrends.push(data);

      // 이력에 추가
      const existIdx = history.dailyBuzz.findIndex(
        (d) => d.date === today && d.keyword === kw.keyword,
      );
      if (existIdx >= 0) {
        history.dailyBuzz[existIdx].buzzScore = data.buzzScore;
      } else {
        history.dailyBuzz.push({
          date: today,
          keyword: kw.keyword,
          buzzScore: data.buzzScore,
        });
      }

      await sleep(200);
    }
  }

  // ── 이력 저장 ──
  saveTrendHistory(history);
  console.log(`\n  이력 저장 완료: ${history.dailyBuzz.length}건`);

  // ── 콘솔 리포트 ──
  console.log("\n" + "═".repeat(70));
  console.log("  트렌드 분석 리포트");
  console.log("═".repeat(70));
  printTrendReport(allTrends);

  // ── EC2 전송 ──
  if (ec2Available) {
    console.log("\n" + "═".repeat(70));
    console.log("  EC2 전송");
    console.log("═".repeat(70));

    const articlesToSend: NewsArticle[] = [];

    // 1) 키워드별 트렌드 기사
    for (const t of allTrends) {
      articlesToSend.push(buildTrendArticle(t));
    }

    // 2) 카테고리별 종합 리포트
    for (const [category, keywords] of categoryGroups) {
      const catTrends = allTrends.filter((t) => t.category === category);
      const catEn = keywords[0].categoryEn;
      articlesToSend.push(buildCategoryReportArticle(category, catEn, catTrends, today));
    }

    // 3) 전체 일일 종합 리포트
    articlesToSend.push(buildDailyOverviewArticle(allTrends, today));

    console.log(`  전송 대상: ${articlesToSend.length}건`);
    console.log(`    - 키워드별: ${allTrends.length}건`);
    console.log(`    - 카테고리 리포트: ${categoryGroups.size}건`);
    console.log(`    - 일일 종합: 1건`);

    // 배치 전송
    let totalCreated = 0;
    let totalUpdated = 0;
    let errors = 0;

    for (let i = 0; i < articlesToSend.length; i += BATCH_SIZE) {
      const batch = articlesToSend.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(articlesToSend.length / BATCH_SIZE);

      try {
        const result = await sendToEc2(batch);
        totalCreated += result.created;
        totalUpdated += result.updated;
        console.log(
          `  배치 [${batchNum}/${totalBatches}] ` +
          `${result.total}건 → 생성 ${result.created} | 갱신 ${result.updated}`,
        );
        await sleep(100);
      } catch (e) {
        errors++;
        console.log(
          `  배치 [${batchNum}/${totalBatches}] 오류: ${(e as Error).message}`,
        );
      }
    }

    console.log(`\n  EC2 전송 완료: 생성 ${totalCreated} / 갱신 ${totalUpdated} / 오류 ${errors}`);
  } else {
    console.log("\n  ⚠️ EC2 미연결 → 전송 스킵 (로컬 리포트만 출력)");
  }

  // ── JSON 출력 (알림 서비스용) ──
  console.log("\n--- TREND_REPORT_JSON_START ---");
  const reportJson = {
    reportType: "daily-trend-analysis",
    date: today,
    generatedAt: new Date().toISOString(),
    ec2Target: EC2_BASE_URL,
    apiCallCount,
    youtubeAvailable: !youtubeQuotaExceeded,
    totalKeywords: allTrends.length,
    categories: [...categoryGroups.keys()],
    summary: {
      avgBuzzScore: Math.round(
        allTrends.reduce((sum, t) => sum + t.buzzScore, 0) / allTrends.length,
      ),
      hotKeywords: allTrends
        .filter((t) => t.buzzLevel === "🔥 핫")
        .map((t) => ({ keyword: t.keyword, category: t.category, score: t.buzzScore })),
      risingKeywords: allTrends
        .filter((t) => t.buzzLevel === "📈 상승")
        .map((t) => ({ keyword: t.keyword, category: t.category, score: t.buzzScore })),
      top10: allTrends
        .sort((a, b) => b.buzzScore - a.buzzScore)
        .slice(0, 10)
        .map((t) => ({
          keyword: t.keyword,
          category: t.category,
          buzzScore: t.buzzScore,
          buzzLevel: t.buzzLevel,
          newsCount: t.naverNews?.totalArticles ?? 0,
          blogCount: t.naverBlog?.totalPosts ?? 0,
          cafeCount: t.naverCafe?.totalPosts ?? 0,
          shopCount: t.naverShopping?.totalProducts ?? 0,
          ytCount: t.youtube?.totalVideos ?? 0,
        })),
    },
  };
  console.log(JSON.stringify(reportJson, null, 2));
  console.log("--- TREND_REPORT_JSON_END ---");

  // ── 최종 요약 ──
  console.log("\n" + "═".repeat(70));
  console.log("  완료 요약");
  console.log("═".repeat(70));
  console.log(`  수집 키워드: ${allTrends.length}개 (${categoryGroups.size}개 카테고리)`);
  console.log(`  API 호출: ~${apiCallCount}건`);
  console.log(`  YouTube: ${youtubeQuotaExceeded ? "⚠️ 쿼터 초과" : "✅ 정상"}`);
  console.log(`  🔥 핫 키워드: ${allTrends.filter((t) => t.buzzLevel === "🔥 핫").length}개`);
  console.log(`  📈 상승 키워드: ${allTrends.filter((t) => t.buzzLevel === "📈 상승").length}개`);
  console.log(`  EC2: ${ec2Available ? "✅ 전송완료" : "⚠️ 미연결"}`);
  console.log(`  이력 파일: ${TREND_HISTORY_FILE}`);
  console.log("═".repeat(70));
  console.log();
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
