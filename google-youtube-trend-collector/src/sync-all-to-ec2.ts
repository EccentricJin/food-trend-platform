/**
 * 통합 EC2 전송 — 모든 수집 데이터를 EC2로 전송
 *
 * Phase 1: 가격 데이터 → POST /api/prices/daily (일봉 형식)
 *   - 기존 price-history.json 이력 데이터
 *   - 오늘 최신 네이버 쇼핑 가격 실시간 수집
 *
 * Phase 2: 뉴스 데이터 → POST /api/internal/news/articles/batch
 *   - 네이버 뉴스 API 최신 기사 수집
 *
 * Phase 3: 트렌드 데이터 → POST /api/internal/news/articles/batch
 *   - 네이버 쇼핑/뉴스/블로그/카페 + YouTube 트렌드
 *
 * 일봉 저장 규칙:
 *   최초: open = high = low = close = price
 *   갱신: close = 최신, high = max, low = min
 *
 * 실행: npx tsx src/sync-all-to-ec2.ts
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
} catch {}

// ── 설정 ──
const EC2_BASE_URL = process.env.EC2_NEWS_API_URL ?? "http://13.124.248.151";
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? "";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const HISTORY_FILE = resolve(__dirname, "..", "price-history.json");

// ════════════════════════════════════════════════════════════════
// 1. ingredientCode 매핑 (EC2 API 스펙)
// ════════════════════════════════════════════════════════════════

interface IngredientMapping {
  name: string;
  code: string;
  naverKeywords: string[];
  priceType: "median" | "min_p25";
}

const INGREDIENTS: IngredientMapping[] = [
  { name: "밀가루 (박력분)",      code: "FLOUR",              naverKeywords: ["박력분 1kg"],             priceType: "median" },
  { name: "설탕 (백설탕)",        code: "SUGAR",              naverKeywords: ["백설탕 1kg"],             priceType: "median" },
  { name: "무염버터",             code: "BUTTER",             naverKeywords: ["무염버터 450g"],          priceType: "median" },
  { name: "계란 (특란)",          code: "EGG",                naverKeywords: ["달걀 30구", "계란 30구"], priceType: "min_p25" },
  { name: "우유 (신선)",          code: "MILK",               naverKeywords: ["서울우유 1L"],            priceType: "median" },
  { name: "생크림",               code: "CREAM",              naverKeywords: ["동물성 생크림 1L"],       priceType: "median" },
  { name: "커버춰 초콜릿",        code: "CHOCOLATE",          naverKeywords: ["커버춰 초콜릿 1kg"],      priceType: "median" },
  { name: "커피 원두 (아라비카)",  code: "COFFEE_BEAN",        naverKeywords: ["아라비카 원두 1kg"],      priceType: "median" },
  { name: "바닐라 익스트랙트",     code: "VANILLA",            naverKeywords: ["바닐라 익스트랙트"],       priceType: "median" },
  { name: "아몬드",               code: "ALMOND",             naverKeywords: ["아몬드 1kg"],             priceType: "median" },
];

function getIngredientCode(name: string): string {
  const found = INGREDIENTS.find((i) => i.name === name);
  return found?.code ?? name.toUpperCase().replace(/[^A-Z]/g, "_");
}

// ════════════════════════════════════════════════════════════════
// 2. 유틸리티
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

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile25(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.25));
  const subset = sorted.slice(0, cutoff);
  return Math.round(subset.reduce((a, b) => a + b, 0) / subset.length);
}

// ════════════════════════════════════════════════════════════════
// 3. 네이버 API 공통
// ════════════════════════════════════════════════════════════════

async function naverSearch(
  type: "shop" | "news" | "blog" | "cafearticle",
  query: string,
  display = 100,
  sort = "sim",
): Promise<any> {
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

// ════════════════════════════════════════════════════════════════
// 4. Phase 1 — 가격 데이터 → /api/prices/daily
// ════════════════════════════════════════════════════════════════

interface PriceDailyRequest {
  ingredientCode: string;
  price: number;
  source: string;
}

async function sendPriceToEc2(req: PriceDailyRequest): Promise<boolean> {
  try {
    const res = await fetch(`${EC2_BASE_URL}/api/prices/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (res.ok) {
      return true;
    }
    console.log(`      ❌ HTTP ${res.status}: ${await res.text()}`);
    return false;
  } catch (e) {
    console.log(`      ❌ 전송오류: ${(e as Error).message}`);
    return false;
  }
}

/** 네이버 쇼핑에서 가격 수집 후 대표가격 산출 */
async function collectPrice(ing: IngredientMapping): Promise<{
  representativePrice: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  p25Price: number;
  productCount: number;
} | null> {
  let allPrices: number[] = [];

  for (const keyword of ing.naverKeywords) {
    try {
      const data = await naverSearch("shop", keyword, 100, "sim");
      const prices = (data.items || [])
        .map((i: any) => parseInt(i.lprice || "0"))
        .filter((p: number) => p > 0);
      allPrices.push(...prices);
      await sleep(200);
    } catch (e) {
      console.log(`      [Naver] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  if (allPrices.length === 0) return null;

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const avgPrice = Math.round(allPrices.reduce((a, b) => a + b, 0) / allPrices.length);
  const medianPrice = median(allPrices);
  const p25Price = percentile25(allPrices);

  return {
    representativePrice: ing.priceType === "min_p25" ? p25Price : medianPrice,
    minPrice,
    maxPrice,
    avgPrice,
    medianPrice,
    p25Price,
    productCount: allPrices.length,
  };
}

async function phase1_prices(): Promise<{
  sent: number;
  failed: number;
  historyCount: number;
}> {
  console.log("\n" + "═".repeat(70));
  console.log("  Phase 1: 가격 데이터 → POST /api/prices/daily");
  console.log("═".repeat(70));

  let sent = 0;
  let failed = 0;

  // ── A. 기존 이력 데이터 전송 ──
  console.log("\n  [1-A] 기존 price-history.json 이력 전송");
  if (existsSync(HISTORY_FILE)) {
    try {
      const history = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      const snapshots = history.snapshots || [];
      console.log(`    이력 ${snapshots.length}건 발견`);

      for (const snap of snapshots) {
        const code = getIngredientCode(snap.ingredientName);
        const price = snap.representativePrice;

        const ok = await sendPriceToEc2({
          ingredientCode: code,
          price,
          source: "naver_shopping_history",
        });

        if (ok) {
          sent++;
          console.log(`    ✅ ${snap.ingredientName} → ${code} = ${formatNumber(price)}원 (${snap.date})`);
        } else {
          failed++;
        }
        await sleep(50);
      }
    } catch (e) {
      console.log(`    ❌ 이력 파일 오류: ${(e as Error).message}`);
    }
  } else {
    console.log("    (이력 파일 없음 → 스킵)");
  }

  // ── B. 오늘 최신 가격 수집 & 전송 ──
  console.log(`\n  [1-B] 오늘(${todayStr()}) 최신 가격 수집 & 전송`);
  console.log("  " + "─".repeat(66));

  const todaySnapshots: any[] = [];

  for (let i = 0; i < INGREDIENTS.length; i++) {
    const ing = INGREDIENTS[i];
    console.log(`    [${i + 1}/${INGREDIENTS.length}] ${ing.name}`);

    const result = await collectPrice(ing);
    if (!result) {
      console.log(`      ❌ 수집 실패`);
      failed++;
      continue;
    }

    console.log(
      `      대표가: ${formatNumber(result.representativePrice)}원 ` +
      `(최저 ${formatNumber(result.minPrice)} / 중간 ${formatNumber(result.medianPrice)} / ` +
      `최고 ${formatNumber(result.maxPrice)}) [${result.productCount}건]`,
    );

    const ok = await sendPriceToEc2({
      ingredientCode: ing.code,
      price: result.representativePrice,
      source: "naver_shopping",
    });

    if (ok) {
      sent++;
      console.log(`      ✅ EC2 전송: ${ing.code} = ${formatNumber(result.representativePrice)}원`);
    } else {
      failed++;
    }

    // price-history에도 저장
    todaySnapshots.push({
      date: todayStr(),
      collectedAt: new Date().toISOString(),
      ingredientName: ing.name,
      unit: ing.naverKeywords[0]?.match(/\d+\w+$/)?.[0] || "",
      ...result,
    });

    await sleep(150);
  }

  // 이력 파일 업데이트
  let history: any = { version: 1, lastUpdated: "", snapshots: [] };
  if (existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    } catch {}
  }

  for (const snap of todaySnapshots) {
    const idx = history.snapshots.findIndex(
      (s: any) => s.date === snap.date && s.ingredientName === snap.ingredientName,
    );
    if (idx >= 0) {
      history.snapshots[idx] = snap;
    } else {
      history.snapshots.push(snap);
    }
  }

  // 90일 이전 정리
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  history.snapshots = history.snapshots.filter((s: any) => s.date >= cutoffStr);
  history.lastUpdated = new Date().toISOString();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");

  console.log(`\n  Phase 1 결과: 전송 ${sent}건 / 실패 ${failed}건`);
  console.log(`  이력 저장: ${history.snapshots.length}건`);

  return { sent, failed, historyCount: history.snapshots.length };
}

// ════════════════════════════════════════════════════════════════
// 5. Phase 2 — 뉴스 데이터 → /api/internal/news/articles/batch
// ════════════════════════════════════════════════════════════════

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

async function sendNewsBatch(articles: NewsArticle[]): Promise<BatchResponse> {
  const res = await fetch(`${EC2_BASE_URL}/api/internal/news/articles/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: articles }),
  });

  if (!res.ok) {
    throw new Error(`News API 오류 (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<BatchResponse>;
}

const PUBLISHER_MAP: Record<string, string> = {
  "chosun.com": "조선일보", "donga.com": "동아일보", "joongang.co.kr": "중앙일보",
  "hankyung.com": "한국경제", "mk.co.kr": "매일경제", "sedaily.com": "서울경제",
  "edaily.co.kr": "이데일리", "mt.co.kr": "머니투데이", "fnnews.com": "파이낸셜뉴스",
  "newsis.com": "뉴시스", "yna.co.kr": "연합뉴스", "yonhapnews.co.kr": "연합뉴스",
  "hani.co.kr": "한겨레", "khan.co.kr": "경향신문", "sbs.co.kr": "SBS",
  "kbs.co.kr": "KBS", "mbc.co.kr": "MBC", "jtbc.co.kr": "JTBC", "ytn.co.kr": "YTN",
};

function extractPublisher(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
      .replace(/^www\./, "").replace(/^m\./, "").replace(/^news\./, "");
    return PUBLISHER_MAP[hostname] ?? hostname;
  } catch {
    return null;
  }
}

function parseNaverDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace(/\.\d{3}Z$/, "");
  } catch {
    return null;
  }
}

const NEWS_KEYWORDS = [
  // 원자재
  "밀가루 가격", "밀 가격 전망", "설탕 가격", "원당 가격",
  "버터 가격", "버터 수급", "계란 가격", "달걀 시세", "조류독감 달걀",
  "우유 가격", "원유 기준가", "생크림 가격",
  "코코아 가격", "초콜릿 원가", "카카오 가격",
  "커피 원두 가격", "아라비카 시세", "커피 가격 전망",
  "바닐라 가격", "아몬드 가격",
  // 업계
  "카페 창업", "빵집 창업", "베이커리 트렌드", "디저트 트렌드",
  "카페 프랜차이즈", "소금빵 인기", "무인카페",
];

async function phase2_news(): Promise<{
  collected: number;
  created: number;
  updated: number;
  errors: number;
}> {
  console.log("\n" + "═".repeat(70));
  console.log("  Phase 2: 뉴스 데이터 → POST /api/internal/news/articles/batch");
  console.log("═".repeat(70));

  const allArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  console.log(`  검색 키워드: ${NEWS_KEYWORDS.length}개\n`);

  for (let i = 0; i < NEWS_KEYWORDS.length; i++) {
    const keyword = NEWS_KEYWORDS[i];
    try {
      const data = await naverSearch("news", keyword, 100, "date");
      const items = data.items || [];

      let added = 0;
      for (const item of items) {
        const articleUrl = item.originallink || item.link;
        if (!articleUrl || seenUrls.has(articleUrl)) continue;
        seenUrls.add(articleUrl);

        allArticles.push({
          title: cleanHtml(item.title),
          url: articleUrl,
          source: "naver_news",
          publisher: extractPublisher(item.originallink || ""),
          summary: cleanHtml(item.description || "").slice(0, 500) || null,
          publishedAt: parseNaverDate(item.pubDate),
        });
        added++;
      }

      console.log(`    [${i + 1}/${NEWS_KEYWORDS.length}] "${keyword}" → ${items.length}건 (신규 ${added}건)`);
      await sleep(200);
    } catch (e) {
      console.log(`    [${i + 1}/${NEWS_KEYWORDS.length}] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  console.log(`\n  수집 합계: ${allArticles.length}건 (중복 제거 완료)`);

  // 배치 전송
  let totalCreated = 0;
  let totalUpdated = 0;
  let errors = 0;
  const batchSize = 20;

  console.log("  EC2 전송 중...");

  for (let i = 0; i < allArticles.length; i += batchSize) {
    const batch = allArticles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allArticles.length / batchSize);

    try {
      const result = await sendNewsBatch(batch);
      totalCreated += result.created;
      totalUpdated += result.updated;

      if (batchNum % 10 === 0 || batchNum === totalBatches) {
        console.log(
          `    배치 [${batchNum}/${totalBatches}] 누적: 생성 ${totalCreated} / 갱신 ${totalUpdated}`,
        );
      }
      await sleep(100);
    } catch (e) {
      errors++;
      console.log(`    배치 [${batchNum}/${totalBatches}] 오류: ${(e as Error).message}`);
    }
  }

  console.log(`\n  Phase 2 결과: ${allArticles.length}건 전송 → 생성 ${totalCreated} / 갱신 ${totalUpdated} / 오류 ${errors}`);

  return { collected: allArticles.length, created: totalCreated, updated: totalUpdated, errors };
}

// ════════════════════════════════════════════════════════════════
// 6. Phase 3 — 트렌드 데이터 → /api/internal/news/articles/batch
// ════════════════════════════════════════════════════════════════

interface TrendKeyword {
  keyword: string;
  category: string;
  categoryEn: string;
  icon: string;
}

const TREND_KEYWORDS: TrendKeyword[] = [
  // 카페
  { keyword: "스페셜티 커피", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "디카페인 커피", category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "플랫화이트",   category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "카페 창업",    category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "아인슈페너",   category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  { keyword: "오트밀크",     category: "카페 트렌드", categoryEn: "cafe_trend", icon: "🥛" },
  { keyword: "드립커피",     category: "카페 트렌드", categoryEn: "cafe_trend", icon: "☕" },
  // 빵집
  { keyword: "소금빵",       category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🍞" },
  { keyword: "크루아상",     category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🥐" },
  { keyword: "베이글",       category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🥯" },
  { keyword: "베이커리 카페", category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🏪" },
  { keyword: "빵지순례",     category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🗺️" },
  { keyword: "동네빵집",     category: "빵집 트렌드", categoryEn: "bakery_trend", icon: "🏘️" },
  // 디저트
  { keyword: "마카롱",          category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍪" },
  { keyword: "크로플",          category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🧇" },
  { keyword: "약과",            category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍯" },
  { keyword: "티라미수",        category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍰" },
  { keyword: "바스크 치즈케이크", category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🧀" },
  { keyword: "수제 쿠키",       category: "디저트 트렌드", categoryEn: "dessert_trend", icon: "🍪" },
  // 시즌
  { keyword: "발렌타인 초콜릿", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "💝" },
  { keyword: "화이트데이 선물", category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🎁" },
  { keyword: "봄 딸기 케이크",  category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🍓" },
  { keyword: "벚꽃 시즌 카페",  category: "시즌 이벤트", categoryEn: "seasonal_event", icon: "🌸" },
];

interface TrendData {
  keyword: string;
  category: string;
  categoryEn: string;
  icon: string;
  news: number;
  blog: number;
  cafe: number;
  shop: number;
  youtube: number;
  buzzScore: number;
}

async function collectTrendData(kw: TrendKeyword): Promise<TrendData> {
  const data: TrendData = {
    keyword: kw.keyword,
    category: kw.category,
    categoryEn: kw.categoryEn,
    icon: kw.icon,
    news: 0, blog: 0, cafe: 0, shop: 0, youtube: 0, buzzScore: 0,
  };

  // 네이버 4종
  try {
    const newsData = await naverSearch("news", kw.keyword, 1, "date");
    data.news = newsData.total || 0;
  } catch {}
  await sleep(120);

  try {
    const blogData = await naverSearch("blog", kw.keyword, 1, "date");
    data.blog = blogData.total || 0;
  } catch {}
  await sleep(120);

  try {
    const cafeData = await naverSearch("cafearticle", kw.keyword, 1, "date");
    data.cafe = cafeData.total || 0;
  } catch {}
  await sleep(120);

  try {
    const shopData = await naverSearch("shop", kw.keyword, 1, "sim");
    data.shop = shopData.total || 0;
  } catch {}
  await sleep(120);

  // YouTube
  if (YOUTUBE_API_KEY) {
    try {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      url.searchParams.set("key", YOUTUBE_API_KEY);
      url.searchParams.set("q", kw.keyword);
      url.searchParams.set("part", "snippet");
      url.searchParams.set("type", "video");
      url.searchParams.set("regionCode", "KR");
      url.searchParams.set("maxResults", "1");
      url.searchParams.set("publishedAfter", weekAgo.toISOString());

      const ytRes = await fetch(url.toString());
      if (ytRes.ok) {
        const ytData = await ytRes.json() as { pageInfo: { totalResults: number } };
        data.youtube = ytData.pageInfo?.totalResults || 0;
      }
    } catch {}
  }

  // 버즈 스코어
  let score = 0;
  if (data.news >= 1000) score += 40;
  else if (data.news >= 500) score += 30;
  else if (data.news >= 100) score += 20;
  else if (data.news >= 30) score += 10;
  else if (data.news >= 10) score += 5;

  if (data.blog >= 100000) score += 25;
  else if (data.blog >= 50000) score += 20;
  else if (data.blog >= 10000) score += 15;
  else if (data.blog >= 5000) score += 10;
  else if (data.blog >= 1000) score += 5;

  if (data.cafe >= 50000) score += 15;
  else if (data.cafe >= 10000) score += 10;
  else if (data.cafe >= 5000) score += 7;
  else if (data.cafe >= 1000) score += 3;

  if (data.shop >= 10000) score += 10;
  else if (data.shop >= 5000) score += 7;
  else if (data.shop >= 1000) score += 5;
  else if (data.shop >= 100) score += 2;

  if (data.youtube >= 100) score += 10;
  else if (data.youtube >= 50) score += 7;
  else if (data.youtube >= 20) score += 5;
  else if (data.youtube >= 5) score += 2;

  data.buzzScore = Math.min(100, score);

  return data;
}

function buildTrendArticle(data: TrendData, date: string): NewsArticle {
  const slug = data.keyword.replace(/\s+/g, "-");
  return {
    title: truncate(
      `[트렌드] ${data.icon} ${data.keyword} 버즈 ${data.buzzScore}점 ` +
      `(뉴스${formatNumber(data.news)} 블로그${formatNumber(data.blog)} 카페${formatNumber(data.cafe)} ` +
      `쇼핑${formatNumber(data.shop)} YT${formatNumber(data.youtube)}) — ${data.category} ${date}`,
      200,
    ),
    url: `https://trend.breadalert.com/daily/${date}/${encodeURIComponent(slug)}`,
    source: "trend_analysis",
    publisher: "BreadAlert 트렌드",
    summary:
      `[${data.category}] "${data.keyword}" 트렌드. ` +
      `뉴스 ${formatNumber(data.news)}건, 블로그 ${formatNumber(data.blog)}건, ` +
      `카페 ${formatNumber(data.cafe)}건, 쇼핑 ${formatNumber(data.shop)}건, ` +
      `YouTube ${formatNumber(data.youtube)}건. 버즈스코어 ${data.buzzScore}/100점.`,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  };
}

async function phase3_trends(): Promise<{
  keywords: number;
  created: number;
  updated: number;
  errors: number;
  trendData: TrendData[];
}> {
  console.log("\n" + "═".repeat(70));
  console.log("  Phase 3: 트렌드 데이터 → POST /api/internal/news/articles/batch");
  console.log("═".repeat(70));
  console.log(`  키워드: ${TREND_KEYWORDS.length}개\n`);

  const allTrends: TrendData[] = [];

  // 카테고리별
  const catGroups = new Map<string, TrendKeyword[]>();
  for (const kw of TREND_KEYWORDS) {
    const arr = catGroups.get(kw.category) ?? [];
    arr.push(kw);
    catGroups.set(kw.category, arr);
  }

  let catIdx = 0;
  for (const [cat, keywords] of catGroups) {
    catIdx++;
    console.log(`  [${catIdx}/${catGroups.size}] 📊 ${cat}`);

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const trend = await collectTrendData(kw);
      allTrends.push(trend);

      console.log(
        `    ${kw.icon} ${kw.keyword.padEnd(14)} ` +
        `뉴스:${formatNumber(trend.news).padStart(8)} ` +
        `블로그:${formatNumber(trend.blog).padStart(10)} ` +
        `카페:${formatNumber(trend.cafe).padStart(8)} ` +
        `쇼핑:${formatNumber(trend.shop).padStart(8)} ` +
        `YT:${formatNumber(trend.youtube).padStart(6)} ` +
        `→ ${trend.buzzScore}점`,
      );
    }
  }

  // 기사로 변환 & 전송
  const today = todayStr();
  const articles: NewsArticle[] = [];

  // 키워드별 기사
  for (const t of allTrends) {
    articles.push(buildTrendArticle(t, today));
  }

  // 카테고리별 요약 기사
  for (const [cat, keywords] of catGroups) {
    const catTrends = allTrends.filter((t) => t.category === cat);
    const sorted = [...catTrends].sort((a, b) => b.buzzScore - a.buzzScore);
    const top3 = sorted.slice(0, 3);
    const catAvg = Math.round(catTrends.reduce((s, t) => s + t.buzzScore, 0) / catTrends.length);

    articles.push({
      title: truncate(
        `[카테고리] ${cat} TOP — ${top3.map((t) => `${t.icon}${t.keyword}(${t.buzzScore})`).join(", ")} (${today})`,
        200,
      ),
      url: `https://trend.breadalert.com/report/${today}/${keywords[0].categoryEn}`,
      source: "trend_category_report",
      publisher: "BreadAlert 트렌드",
      summary:
        `${cat} 종합 리포트. ${catTrends.length}개 키워드 분석. 평균 ${catAvg}점. ` +
        sorted.map((t, i) => `${i + 1}위: ${t.keyword}(${t.buzzScore}점)`).join(", ") + ".",
      publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    });
  }

  // 전체 종합 기사
  const allSorted = [...allTrends].sort((a, b) => b.buzzScore - a.buzzScore);
  const overallAvg = Math.round(allTrends.reduce((s, t) => s + t.buzzScore, 0) / allTrends.length);
  articles.push({
    title: truncate(
      `[일일종합] 빵집·카페·디저트 TOP5 — ${allSorted.slice(0, 5).map((t) => `${t.keyword}(${t.buzzScore})`).join(", ")} (${today})`,
      200,
    ),
    url: `https://trend.breadalert.com/daily-overview/${today}`,
    source: "trend_daily_overview",
    publisher: "BreadAlert 트렌드",
    summary:
      `${today} 빵집/카페/디저트 트렌드 종합. ${allTrends.length}개 키워드. 평균 ${overallAvg}점. ` +
      allSorted.slice(0, 10).map((t, i) => `${i + 1}.${t.keyword}(${t.buzzScore})`).join(" ") + ".",
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  });

  // 배치 전송
  let totalCreated = 0;
  let totalUpdated = 0;
  let errors = 0;

  console.log(`\n  EC2 전송: ${articles.length}건`);

  for (let i = 0; i < articles.length; i += 20) {
    const batch = articles.slice(i, i + 20);
    try {
      const result = await sendNewsBatch(batch);
      totalCreated += result.created;
      totalUpdated += result.updated;
      await sleep(100);
    } catch (e) {
      errors++;
    }
  }

  console.log(`  Phase 3 결과: 전송 ${articles.length}건 → 생성 ${totalCreated} / 갱신 ${totalUpdated} / 오류 ${errors}`);

  return {
    keywords: allTrends.length,
    created: totalCreated,
    updated: totalUpdated,
    errors,
    trendData: allTrends,
  };
}

// ════════════════════════════════════════════════════════════════
// 7. 메인 실행
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const timeStr = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit", minute: "2-digit",
  });

  console.log();
  console.log("█".repeat(70));
  console.log("  통합 EC2 전송 — 가격 + 뉴스 + 트렌드 데이터");
  console.log("█".repeat(70));
  console.log(`  실행: ${dateStr} ${timeStr}`);
  console.log(`  EC2: ${EC2_BASE_URL}`);
  console.log(`  원자재: ${INGREDIENTS.length}종`);
  console.log(`  뉴스 키워드: ${NEWS_KEYWORDS.length}개`);
  console.log(`  트렌드 키워드: ${TREND_KEYWORDS.length}개`);
  console.log("█".repeat(70));

  // EC2 연결 확인
  console.log("\n[0] EC2 서버 연결 확인...");
  try {
    const res = await fetch(`${EC2_BASE_URL}/api/prices/daily`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientCode: "HEALTH_CHECK", price: 0.01, source: "health_check" }),
    });
    console.log(`  Prices API: ${res.ok ? "✅ OK" : `⚠️ ${res.status}`}`);
  } catch (e) {
    console.log(`  Prices API: ❌ ${(e as Error).message}`);
  }

  try {
    const res = await fetch(`${EC2_BASE_URL}/api/internal/news/articles/latest?size=1`);
    console.log(`  News API: ${res.ok ? "✅ OK" : `⚠️ ${res.status}`}`);
  } catch (e) {
    console.log(`  News API: ❌ ${(e as Error).message}`);
  }

  // Phase 1: 가격
  const p1 = await phase1_prices();

  // Phase 2: 뉴스
  const p2 = await phase2_news();

  // Phase 3: 트렌드
  const p3 = await phase3_trends();

  // ── 최종 종합 ──
  console.log("\n" + "█".repeat(70));
  console.log("  최종 종합 결과");
  console.log("█".repeat(70));
  console.log();

  console.log("  ┌─ Phase 1: 가격 → /api/prices/daily ─────────────────");
  console.log(`  │  전송 경로: POST ${EC2_BASE_URL}/api/prices/daily`);
  console.log(`  │  요청 형식: { ingredientCode, price, source }`);
  console.log(`  │  전송: ${p1.sent}건 성공 / ${p1.failed}건 실패`);
  console.log(`  │  이력: ${p1.historyCount}건`);
  console.log("  │");
  console.log("  │  ingredientCode 목록:");
  for (const ing of INGREDIENTS) {
    console.log(`  │    ${ing.code.padEnd(20)} ← ${ing.name}`);
  }
  console.log("  └─────────────────────────────────────────────────────");

  console.log();
  console.log("  ┌─ Phase 2: 뉴스 → /api/internal/news/articles/batch ─");
  console.log(`  │  전송 경로: POST ${EC2_BASE_URL}/api/internal/news/articles/batch`);
  console.log(`  │  수집: ${p2.collected}건 → 생성 ${p2.created} / 갱신 ${p2.updated} / 오류 ${p2.errors}`);
  console.log("  └─────────────────────────────────────────────────────");

  console.log();
  console.log("  ┌─ Phase 3: 트렌드 → /api/internal/news/articles/batch ");
  console.log(`  │  전송 경로: POST ${EC2_BASE_URL}/api/internal/news/articles/batch`);
  console.log(`  │  키워드: ${p3.keywords}개`);
  console.log(`  │  전송: 생성 ${p3.created} / 갱신 ${p3.updated} / 오류 ${p3.errors}`);

  // TOP 10 트렌드
  const topTrends = [...p3.trendData].sort((a, b) => b.buzzScore - a.buzzScore).slice(0, 10);
  console.log("  │");
  console.log("  │  ★ TOP 10 트렌드:");
  for (let i = 0; i < topTrends.length; i++) {
    const t = topTrends[i];
    const bar = "█".repeat(Math.round(t.buzzScore / 5));
    console.log(`  │    ${String(i + 1).padStart(2)}. ${t.icon} ${t.keyword.padEnd(14)} ${String(t.buzzScore).padStart(3)}점 ${bar}`);
  }
  console.log("  └─────────────────────────────────────────────────────");

  console.log();
  console.log("█".repeat(70));
  console.log(`  전체 API 전송 완료!`);
  console.log(`  가격: ${p1.sent}건 | 뉴스: ${p2.created + p2.updated}건 | 트렌드: ${p3.created + p3.updated}건`);
  console.log("█".repeat(70));
  console.log();
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
