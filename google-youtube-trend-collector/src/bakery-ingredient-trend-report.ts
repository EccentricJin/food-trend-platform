/**
 * 빵집/카페 원자재 트렌드 통합 리포트
 *
 * 3대 API를 활용하여 빵집/카페 핵심 원자재 10종의 실시간 트렌드를 수집·분석합니다.
 *
 * 1. 네이버 쇼핑 API  → 국내 실제 판매 가격 (최저/평균/최고, 판매처)
 * 2. 구글 검색 API    → 최근 뉴스·기사 트렌드 (가격 동향, 시장 이슈)
 * 3. YouTube Data API → 관련 영상 트렌드 (조회수, 인기 채널)
 *
 * 실행: npx tsx src/bakery-ingredient-trend-report.ts
 */

/**
 * 이 스크립트는 Kafka/MySQL 의존성 없이 독립 실행됩니다.
 * API 키는 환경변수 또는 .env 파일에서 읽습니다.
 */

// .env 파일 수동 로드 (외부 의존성 없음)
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// ── API Keys ──
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID ?? "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? "";

// ── API 타입 & 함수 (인라인, Kafka/DB 의존성 없음) ──

interface NaverShopItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
}

interface NaverSearchResult {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverShopItem[];
}

interface GoogleSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  formattedUrl: string;
}

interface GoogleSearchResult {
  searchInformation: {
    totalResults: string;
    searchTime: number;
    formattedTotalResults: string;
    formattedSearchTime: string;
  };
  items?: GoogleSearchItem[];
}

interface YouTubeSearchItem {
  kind: string;
  id: { kind: string; videoId?: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: Record<string, { url: string; width: number; height: number }>;
    channelTitle: string;
    liveBroadcastContent: string;
    publishTime: string;
  };
}

interface YouTubeSearchResult {
  kind: string;
  pageInfo: { totalResults: number; resultsPerPage: number };
  nextPageToken?: string;
  items: YouTubeSearchItem[];
}

interface YouTubeVideoStatsResult {
  items: Array<{
    id: string;
    statistics: {
      viewCount: string;
      likeCount: string;
      commentCount: string;
    };
  }>;
}

async function searchNaverShopping(
  query: string,
  display = 100,
  sort: "sim" | "date" | "asc" | "dsc" = "sim",
): Promise<NaverSearchResult> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET 환경변수를 설정해주세요.");
  }
  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", sort);
  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });
  if (!response.ok) {
    throw new Error(`Naver API 오류 (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<NaverSearchResult>;
}

async function searchGoogle(
  query: string,
  start = 1,
  num = 10,
  dateRestrict?: string,
): Promise<GoogleSearchResult> {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    throw new Error("GOOGLE_API_KEY와 GOOGLE_CSE_ID 환경변수를 설정해주세요.");
  }
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("start", String(start));
  url.searchParams.set("num", String(num));
  url.searchParams.set("gl", "kr");
  url.searchParams.set("lr", "lang_ko");
  if (dateRestrict) url.searchParams.set("dateRestrict", dateRestrict);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google API 오류 (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<GoogleSearchResult>;
}

async function searchYouTube(
  query: string,
  maxResults = 25,
  order: "date" | "viewCount" | "relevance" = "date",
  publishedAfter?: string,
): Promise<YouTubeSearchResult> {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY 환경변수를 설정해주세요.");
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", YOUTUBE_API_KEY);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("order", order);
  url.searchParams.set("regionCode", "KR");
  url.searchParams.set("relevanceLanguage", "ko");
  if (publishedAfter) url.searchParams.set("publishedAfter", publishedAfter);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube Search API 오류 (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<YouTubeSearchResult>;
}

async function getYouTubeVideoStats(
  videoIds: string[],
): Promise<YouTubeVideoStatsResult> {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY 환경변수를 설정해주세요.");
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", YOUTUBE_API_KEY);
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoIds.join(","));
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`YouTube Videos API 오류 (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<YouTubeVideoStatsResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ════════════════════════════════════════════════════════════════
// 1. 원자재 정의 (10종)
// ════════════════════════════════════════════════════════════════

interface IngredientDef {
  name: string;
  nameEn: string;
  icon: string;
  unit: string;
  naverKeywords: string[];    // 네이버 쇼핑 검색 키워드
  googleKeywords: string[];   // 구글 뉴스/기사 검색 키워드
  youtubeKeywords: string[];  // 유튜브 영상 검색 키워드
}

const INGREDIENTS: IngredientDef[] = [
  {
    name: "밀가루 (박력분)",
    nameEn: "Wheat Flour",
    icon: "🌾",
    unit: "1kg",
    naverKeywords: ["박력분 1kg", "베이킹 밀가루", "박력 밀가루"],
    googleKeywords: ["밀가루 가격 동향 2026", "박력분 도매가"],
    youtubeKeywords: ["밀가루 가격", "베이킹 밀가루 추천"],
  },
  {
    name: "설탕 (백설탕)",
    nameEn: "Sugar",
    icon: "🍬",
    unit: "1kg",
    naverKeywords: ["백설탕 1kg", "비정제 설탕", "베이킹 설탕"],
    googleKeywords: ["설탕 가격 전망 2026", "원당 국제 시세"],
    youtubeKeywords: ["설탕 가격", "설탕 종류 비교"],
  },
  {
    name: "무염버터",
    nameEn: "Butter (Unsalted)",
    icon: "🧈",
    unit: "450g~1kg",
    naverKeywords: ["무염버터", "베이킹 버터", "발효버터"],
    googleKeywords: ["버터 가격 동향 2026", "무염버터 도매가"],
    youtubeKeywords: ["버터 가격 비교", "베이킹 버터 추천"],
  },
  {
    name: "계란 (특란)",
    nameEn: "Eggs (Extra-Large)",
    icon: "🥚",
    unit: "30구",
    naverKeywords: ["달걀 30구", "계란 30구", "신선 달걀"],
    googleKeywords: ["계란 가격 시세 2026", "달걀 가격 추이"],
    youtubeKeywords: ["계란 가격", "달걀 시세 전망"],
  },
  {
    name: "우유 (신선)",
    nameEn: "Milk (Fresh)",
    icon: "🥛",
    unit: "1L",
    naverKeywords: ["서울우유 1L", "신선 우유 1L", "베이킹 우유"],
    googleKeywords: ["우유 가격 동향 2026", "원유 기준가"],
    youtubeKeywords: ["우유 가격 전망", "우유 원가"],
  },
  {
    name: "생크림",
    nameEn: "Fresh Cream",
    icon: "🍦",
    unit: "1L",
    naverKeywords: ["생크림 1L", "동물성 생크림", "휘핑크림"],
    googleKeywords: ["생크림 가격 동향 2026", "생크림 도매가"],
    youtubeKeywords: ["생크림 추천", "생크림 가격 비교"],
  },
  {
    name: "커버춰 초콜릿",
    nameEn: "Couverture Chocolate",
    icon: "🍫",
    unit: "1kg",
    naverKeywords: ["커버춰 초콜릿 다크", "베이킹 다크초콜릿", "발로나 다크초콜릿"],
    googleKeywords: ["코코아 가격 전망 2026", "초콜릿 원자재 가격"],
    youtubeKeywords: ["커버춰 초콜릿 추천", "초콜릿 가격"],
  },
  {
    name: "커피 원두 (아라비카)",
    nameEn: "Coffee Beans (Arabica)",
    icon: "☕",
    unit: "1kg",
    naverKeywords: ["아라비카 원두 1kg", "로스팅 원두", "에스프레소 원두"],
    googleKeywords: ["커피 원두 가격 2026", "아라비카 선물 시세"],
    youtubeKeywords: ["커피 원두 가격", "원두 추천 2026"],
  },
  {
    name: "바닐라",
    nameEn: "Vanilla Extract",
    icon: "🌿",
    unit: "1병",
    naverKeywords: ["바닐라 익스트랙트", "바닐라 에센스 베이킹", "바닐라빈 페이스트"],
    googleKeywords: ["바닐라 가격 동향 2026", "바닐라빈 시세"],
    youtubeKeywords: ["바닐라 익스트랙트 추천", "바닐라빈 가격"],
  },
  {
    name: "아몬드",
    nameEn: "Almonds",
    icon: "🌰",
    unit: "1kg",
    naverKeywords: ["아몬드 1kg", "아몬드 분태", "아몬드 슬라이스"],
    googleKeywords: ["아몬드 가격 전망 2026", "캘리포니아 아몬드 시세"],
    youtubeKeywords: ["아몬드 가격", "아몬드 베이킹"],
  },
];

// ════════════════════════════════════════════════════════════════
// 2. 수집 결과 타입
// ════════════════════════════════════════════════════════════════

interface NaverPriceResult {
  keyword: string;
  totalResults: number;
  items: Array<{
    title: string;
    lprice: number;
    hprice: number;
    mallName: string;
    link: string;
  }>;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
}

interface GoogleArticleResult {
  keyword: string;
  totalResults: string;
  articles: Array<{
    title: string;
    snippet: string;
    link: string;
    source: string;
  }>;
}

interface YouTubeVideoResult {
  keyword: string;
  totalResults: number;
  videos: Array<{
    videoId: string;
    title: string;
    channelTitle: string;
    publishedAt: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    url: string;
  }>;
}

interface IngredientTrendData {
  ingredient: IngredientDef;
  naver: NaverPriceResult[];
  google: GoogleArticleResult[];
  youtube: YouTubeVideoResult[];
  collectedAt: string;
}

// ════════════════════════════════════════════════════════════════
// 3. 유틸리티
// ════════════════════════════════════════════════════════════════

function cleanHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function pad(s: string, len: number): string {
  // 한글 등 wide char 처리
  let width = 0;
  for (const ch of s) {
    width += ch.charCodeAt(0) > 0xff ? 2 : 1;
  }
  const padding = Math.max(0, len - width);
  return s + " ".repeat(padding);
}

function truncate(s: string, maxLen: number): string {
  let width = 0;
  let result = "";
  for (const ch of s) {
    const w = ch.charCodeAt(0) > 0xff ? 2 : 1;
    if (width + w > maxLen - 2) {
      result += "..";
      break;
    }
    result += ch;
    width += w;
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
// 4. API 수집 함수
// ════════════════════════════════════════════════════════════════

async function collectNaverPrices(
  keywords: string[],
): Promise<NaverPriceResult[]> {
  const results: NaverPriceResult[] = [];

  for (const keyword of keywords) {
    try {
      const data = await searchNaverShopping(keyword, 100, "sim");
      const items = (data.items || []).map((item: NaverShopItem) => ({
        title: cleanHtml(item.title),
        lprice: parseInt(item.lprice || "0"),
        hprice: parseInt(item.hprice || "0"),
        mallName: item.mallName,
        link: item.link,
      }));

      const prices = items
        .map((i) => i.lprice)
        .filter((p) => p > 0);

      results.push({
        keyword,
        totalResults: data.total,
        items,
        minPrice: prices.length > 0 ? Math.min(...prices) : 0,
        maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
        avgPrice:
          prices.length > 0
            ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
            : 0,
        medianPrice: median(prices),
      });

      await sleep(200);
    } catch (e) {
      console.log(`  [Naver] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  return results;
}

async function collectGoogleArticles(
  keywords: string[],
): Promise<GoogleArticleResult[]> {
  const results: GoogleArticleResult[] = [];

  for (const keyword of keywords) {
    try {
      const data = await searchGoogle(keyword, 1, 10, "w1");
      const articles = (data.items || []).map((item: GoogleSearchItem) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
        source: item.displayLink,
      }));

      results.push({
        keyword,
        totalResults: data.searchInformation?.totalResults ?? "0",
        articles,
      });

      await sleep(200);
    } catch (e) {
      console.log(`  [Google] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  return results;
}

async function collectYouTubeVideos(
  keywords: string[],
): Promise<YouTubeVideoResult[]> {
  const results: YouTubeVideoResult[] = [];

  // 1개월 전 날짜
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const publishedAfter = oneMonthAgo.toISOString();

  for (const keyword of keywords) {
    try {
      let data = await searchYouTube(keyword, 10, "relevance", publishedAfter);
      let items = data.items || [];

      // 최근 1달에 결과가 없으면 전체 기간으로 재시도
      if (items.length === 0) {
        data = await searchYouTube(keyword, 10, "relevance");
        items = data.items || [];
      }

      if (items.length === 0) {
        results.push({
          keyword,
          totalResults: 0,
          videos: [],
        });
        continue;
      }

      // 통계 가져오기
      const videoIds = items
        .map((i: YouTubeSearchItem) => i.id.videoId)
        .filter((id): id is string => !!id);

      let statsMap: Record<
        string,
        { viewCount: string; likeCount: string; commentCount: string }
      > = {};
      if (videoIds.length > 0) {
        try {
          const statsResult = await getYouTubeVideoStats(videoIds);
          for (const v of statsResult.items) {
            statsMap[v.id] = v.statistics;
          }
        } catch {
          // 통계 조회 실패 무시
        }
      }

      const videos = items
        .filter((i: YouTubeSearchItem) => i.id.videoId)
        .map((item: YouTubeSearchItem) => {
          const videoId = item.id.videoId!;
          const stats = statsMap[videoId];
          return {
            videoId,
            title: item.snippet.title,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            viewCount: stats ? parseInt(stats.viewCount || "0") : 0,
            likeCount: stats ? parseInt(stats.likeCount || "0") : 0,
            commentCount: stats ? parseInt(stats.commentCount || "0") : 0,
            url: `https://www.youtube.com/watch?v=${videoId}`,
          };
        })
        .sort((a, b) => b.viewCount - a.viewCount);

      results.push({
        keyword,
        totalResults: data.pageInfo.totalResults,
        videos,
      });

      await sleep(300);
    } catch (e) {
      console.log(`  [YouTube] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════
// 5. 출력 포맷팅
// ════════════════════════════════════════════════════════════════

function printHeader(): void {
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

  console.log();
  console.log("=".repeat(80));
  console.log(
    "  빵집/카페 원자재 트렌드 통합 리포트",
  );
  console.log(
    "  네이버 쇼핑 + 구글 검색 + YouTube 데이터",
  );
  console.log("=".repeat(80));
  console.log(`  수집 일시: ${dateStr} ${timeStr}`);
  console.log(`  추적 원자재: ${INGREDIENTS.length}종`);
  console.log(
    `  데이터 소스: 네이버 쇼핑 API / Google Custom Search API / YouTube Data API v3`,
  );
  console.log("=".repeat(80));
}

function printIngredientReport(data: IngredientTrendData): void {
  const { ingredient: ing, naver, google, youtube } = data;

  console.log();
  console.log(`${"─".repeat(80)}`);
  console.log(
    `  ${ing.icon} ${ing.name} (${ing.nameEn}) [단위: ${ing.unit}]`,
  );
  console.log(`${"─".repeat(80)}`);

  // ── 네이버 쇼핑 가격 ──
  console.log();
  console.log("  [네이버 쇼핑] 실시간 판매 가격");
  console.log("  " + "─".repeat(70));

  if (naver.length === 0 || naver.every((n) => n.items.length === 0)) {
    console.log("  검색 결과 없음");
  } else {
    // 전체 키워드 통합 가격 통계
    const allPrices = naver
      .flatMap((n) => n.items.map((i) => i.lprice))
      .filter((p) => p > 0);

    if (allPrices.length > 0) {
      const overallMin = Math.min(...allPrices);
      const overallMax = Math.max(...allPrices);
      const overallAvg = Math.round(
        allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
      );
      const overallMed = median(allPrices);

      console.log(
        `  통합 가격: 최저 ${formatNumber(overallMin)}원 | ` +
          `평균 ${formatNumber(overallAvg)}원 | ` +
          `중간값 ${formatNumber(overallMed)}원 | ` +
          `최고 ${formatNumber(overallMax)}원`,
      );
      console.log(
        `  검색 상품 수: ${formatNumber(allPrices.length)}건`,
      );
    }

    console.log();
    for (const n of naver) {
      if (n.items.length === 0) continue;
      console.log(
        `  "${n.keyword}" (${formatNumber(n.totalResults)}건)`,
      );
      console.log(
        `    최저 ${formatNumber(n.minPrice)}원 | ` +
          `평균 ${formatNumber(n.avgPrice)}원 | ` +
          `최고 ${formatNumber(n.maxPrice)}원`,
      );

      // 최저가 TOP 3
      const top3 = n.items
        .filter((i) => i.lprice > 0)
        .sort((a, b) => a.lprice - b.lprice)
        .slice(0, 3);

      for (const item of top3) {
        console.log(
          `    ${formatNumber(item.lprice)}원 - ${truncate(item.title, 50)} [${item.mallName || "기타"}]`,
        );
      }
    }
  }

  // ── 구글 검색 (뉴스/기사) ──
  console.log();
  console.log("  [구글 검색] 최근 1주일 뉴스/기사 트렌드");
  console.log("  " + "─".repeat(70));

  if (google.length === 0 || google.every((g) => g.articles.length === 0)) {
    console.log("  검색 결과 없음");
  } else {
    for (const g of google) {
      if (g.articles.length === 0) continue;
      console.log(
        `  "${g.keyword}" (약 ${formatNumber(parseInt(g.totalResults))}건)`,
      );

      // 상위 5개 기사
      const top5 = g.articles.slice(0, 5);
      for (const article of top5) {
        console.log(
          `    - ${truncate(article.title, 60)} [${article.source}]`,
        );
      }
    }
  }

  // ── YouTube 영상 트렌드 ──
  console.log();
  console.log("  [YouTube] 최근 영상 트렌드");
  console.log("  " + "─".repeat(70));

  if (youtube.length === 0 || youtube.every((y) => y.videos.length === 0)) {
    console.log("  검색 결과 없음");
  } else {
    // 전체 통합 인기 영상 TOP 5
    const allVideos = youtube.flatMap((y) => y.videos);
    // 중복 제거
    const uniqueVideos = new Map<string, (typeof allVideos)[0]>();
    for (const v of allVideos) {
      if (!uniqueVideos.has(v.videoId)) {
        uniqueVideos.set(v.videoId, v);
      }
    }
    const sortedVideos = [...uniqueVideos.values()]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 5);

    const totalViews = allVideos.reduce((sum, v) => sum + v.viewCount, 0);
    console.log(
      `  총 수집 영상: ${allVideos.length}건 | 합산 조회수: ${formatNumber(totalViews)}회`,
    );
    console.log();

    console.log("  조회수 TOP 5:");
    for (let i = 0; i < sortedVideos.length; i++) {
      const v = sortedVideos[i];
      const daysAgo = Math.floor(
        (Date.now() - new Date(v.publishedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      console.log(
        `    ${i + 1}. ${truncate(v.title, 50)}`,
      );
      console.log(
        `       ${v.channelTitle} | 조회 ${formatNumber(v.viewCount)} | ` +
          `좋아요 ${formatNumber(v.likeCount)} | ` +
          `${daysAgo}일 전`,
      );
    }
  }
}

function printSummaryTable(allData: IngredientTrendData[]): void {
  console.log();
  console.log("=".repeat(80));
  console.log(
    "  전체 원자재 요약 테이블",
  );
  console.log("=".repeat(80));

  // ── 네이버 쇼핑 가격 요약 ──
  console.log();
  console.log("  [네이버 쇼핑] 가격 요약");
  console.log(
    "  " +
      pad("원자재", 24) +
      pad("최저가", 12) +
      pad("평균가", 12) +
      pad("중간값", 12) +
      pad("최고가", 12) +
      "상품수",
  );
  console.log("  " + "─".repeat(74));

  for (const d of allData) {
    const allPrices = d.naver
      .flatMap((n) => n.items.map((i) => i.lprice))
      .filter((p) => p > 0);

    if (allPrices.length === 0) {
      console.log(
        `  ${pad(d.ingredient.icon + " " + d.ingredient.name, 24)}  -`,
      );
      continue;
    }

    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const avg = Math.round(
      allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
    );
    const med = median(allPrices);

    console.log(
      `  ${pad(d.ingredient.icon + " " + d.ingredient.name, 24)}` +
        `${pad(formatNumber(min) + "원", 12)}` +
        `${pad(formatNumber(avg) + "원", 12)}` +
        `${pad(formatNumber(med) + "원", 12)}` +
        `${pad(formatNumber(max) + "원", 12)}` +
        `${allPrices.length}건`,
    );
  }

  // ── YouTube 인기도 요약 ──
  console.log();
  console.log("  [YouTube] 트렌드 인기도 요약");
  console.log(
    "  " +
      pad("원자재", 24) +
      pad("영상 수", 10) +
      pad("합산 조회수", 16) +
      pad("최다 조회", 16) +
      "인기 채널",
  );
  console.log("  " + "─".repeat(74));

  for (const d of allData) {
    const allVideos = d.youtube.flatMap((y) => y.videos);

    if (allVideos.length === 0) {
      console.log(
        `  ${pad(d.ingredient.icon + " " + d.ingredient.name, 24)}  -`,
      );
      continue;
    }

    const totalViews = allVideos.reduce((sum, v) => sum + v.viewCount, 0);
    const topVideo = allVideos.sort(
      (a, b) => b.viewCount - a.viewCount,
    )[0];

    console.log(
      `  ${pad(d.ingredient.icon + " " + d.ingredient.name, 24)}` +
        `${pad(allVideos.length + "건", 10)}` +
        `${pad(formatNumber(totalViews) + "회", 16)}` +
        `${pad(formatNumber(topVideo.viewCount) + "회", 16)}` +
        `${topVideo.channelTitle}`,
    );
  }

  // ── 구글 뉴스 이슈 요약 ──
  console.log();
  console.log("  [구글 검색] 주요 뉴스 키워드 요약");
  console.log("  " + "─".repeat(74));

  for (const d of allData) {
    const allArticles = d.google.flatMap((g) => g.articles);
    if (allArticles.length === 0) continue;

    const topArticle = allArticles[0];
    console.log(
      `  ${d.ingredient.icon} ${pad(d.ingredient.name, 20)} ` +
        `${truncate(topArticle.title, 50)}`,
    );
  }
}

// ════════════════════════════════════════════════════════════════
// 6. JSON 출력 (알림 서비스용)
// ════════════════════════════════════════════════════════════════

function printAlertJson(allData: IngredientTrendData[]): void {
  console.log();
  console.log("--- TREND_JSON_START ---");

  const json = {
    reportType: "bakery-ingredient-trend",
    generatedAt: new Date().toISOString(),
    ingredientCount: allData.length,
    sources: ["naver-shopping", "google-custom-search", "youtube-data-api"],
    ingredients: allData.map((d) => {
      const allNaverPrices = d.naver
        .flatMap((n) => n.items.map((i) => i.lprice))
        .filter((p) => p > 0);

      const allVideos = d.youtube.flatMap((y) => y.videos);
      const topVideo = allVideos.sort(
        (a, b) => b.viewCount - a.viewCount,
      )[0];

      const allArticles = d.google.flatMap((g) => g.articles);

      return {
        name: d.ingredient.name,
        nameEn: d.ingredient.nameEn,
        unit: d.ingredient.unit,
        naverPrice: {
          min: allNaverPrices.length > 0 ? Math.min(...allNaverPrices) : null,
          max: allNaverPrices.length > 0 ? Math.max(...allNaverPrices) : null,
          avg:
            allNaverPrices.length > 0
              ? Math.round(
                  allNaverPrices.reduce((a, b) => a + b, 0) /
                    allNaverPrices.length,
                )
              : null,
          median: allNaverPrices.length > 0 ? median(allNaverPrices) : null,
          productCount: allNaverPrices.length,
        },
        youtube: {
          videoCount: allVideos.length,
          totalViews: allVideos.reduce((sum, v) => sum + v.viewCount, 0),
          topVideo: topVideo
            ? {
                title: topVideo.title,
                channel: topVideo.channelTitle,
                viewCount: topVideo.viewCount,
                url: topVideo.url,
              }
            : null,
        },
        news: {
          articleCount: allArticles.length,
          topHeadline: allArticles[0]?.title ?? null,
          topSource: allArticles[0]?.source ?? null,
        },
      };
    }),
  };

  console.log(JSON.stringify(json, null, 2));
  console.log("--- TREND_JSON_END ---");
}

// ════════════════════════════════════════════════════════════════
// 7. 사장님 인사이트
// ════════════════════════════════════════════════════════════════

function printInsights(allData: IngredientTrendData[]): void {
  console.log();
  console.log("=".repeat(80));
  console.log("  사장님을 위한 인사이트");
  console.log("=".repeat(80));

  // 가격 경쟁력 분석: 최저가와 평균가 차이가 큰 원자재
  console.log();
  console.log("  [가격 절약 기회]");
  console.log("  최저가 vs 평균가 차이가 큰 원자재 → 비교구매 시 절약 가능");
  console.log("  " + "─".repeat(70));

  const priceGaps: Array<{
    name: string;
    icon: string;
    min: number;
    avg: number;
    gap: number;
    gapPct: number;
  }> = [];

  for (const d of allData) {
    const allPrices = d.naver
      .flatMap((n) => n.items.map((i) => i.lprice))
      .filter((p) => p > 0);

    if (allPrices.length < 5) continue;

    const min = Math.min(...allPrices);
    const avg = Math.round(
      allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
    );
    const gap = avg - min;
    const gapPct = (gap / avg) * 100;

    priceGaps.push({
      name: d.ingredient.name,
      icon: d.ingredient.icon,
      min,
      avg,
      gap,
      gapPct,
    });
  }

  priceGaps.sort((a, b) => b.gapPct - a.gapPct);

  for (const pg of priceGaps.slice(0, 5)) {
    console.log(
      `  ${pg.icon} ${pad(pg.name, 20)} ` +
        `평균 ${formatNumber(pg.avg)}원 → 최저 ${formatNumber(pg.min)}원 ` +
        `(${formatNumber(pg.gap)}원 절약, -${pg.gapPct.toFixed(1)}%)`,
    );
  }

  // YouTube 트렌드 인기도
  console.log();
  console.log("  [YouTube 인기도 순위]");
  console.log("  조회수 기반 원자재별 관심도 (마케팅/메뉴 기획 참고)");
  console.log("  " + "─".repeat(70));

  const ytRanking = allData
    .map((d) => {
      const allVideos = d.youtube.flatMap((y) => y.videos);
      return {
        name: d.ingredient.name,
        icon: d.ingredient.icon,
        totalViews: allVideos.reduce((sum, v) => sum + v.viewCount, 0),
        videoCount: allVideos.length,
      };
    })
    .filter((r) => r.totalViews > 0)
    .sort((a, b) => b.totalViews - a.totalViews);

  for (let i = 0; i < ytRanking.length; i++) {
    const r = ytRanking[i];
    const bar = "█".repeat(
      Math.max(1, Math.round((r.totalViews / (ytRanking[0]?.totalViews || 1)) * 20)),
    );
    console.log(
      `  ${i + 1}위 ${r.icon} ${pad(r.name, 20)} ${bar} ${formatNumber(r.totalViews)}회`,
    );
  }

  console.log();
  console.log("=".repeat(80));
  console.log(
    "  이 리포트는 네이버 쇼핑 API, Google Custom Search API,",
  );
  console.log(
    "  YouTube Data API v3의 실시간 데이터를 기반으로 생성되었습니다.",
  );
  console.log("=".repeat(80));
}

// ════════════════════════════════════════════════════════════════
// 8. 메인 실행
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  printHeader();

  const allData: IngredientTrendData[] = [];

  for (let idx = 0; idx < INGREDIENTS.length; idx++) {
    const ing = INGREDIENTS[idx];
    console.log();
    console.log(
      `[${ idx + 1}/${INGREDIENTS.length}] ${ing.icon} ${ing.name} 수집 중...`,
    );

    // 3개 API 병렬 수집
    const [naver, google, youtube] = await Promise.all([
      collectNaverPrices(ing.naverKeywords),
      collectGoogleArticles(ing.googleKeywords),
      collectYouTubeVideos(ing.youtubeKeywords),
    ]);

    const trendData: IngredientTrendData = {
      ingredient: ing,
      naver,
      google,
      youtube,
      collectedAt: new Date().toISOString(),
    };

    allData.push(trendData);

    // 개별 원자재 리포트 출력
    printIngredientReport(trendData);

    // API 쿼터 보호: 원자재 사이에 짧은 대기
    if (idx < INGREDIENTS.length - 1) {
      await sleep(500);
    }
  }

  // 전체 요약
  printSummaryTable(allData);

  // 사장님 인사이트
  printInsights(allData);

  // JSON 출력 (알림 서비스용)
  printAlertJson(allData);
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
