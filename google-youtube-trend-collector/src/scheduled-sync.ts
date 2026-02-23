/**
 * 스케줄 실행용 EC2 자동 업로드 스크립트
 *
 * 하루 2회 실행 (오전 09:00 / 오후 18:00 KST)
 *   - 오전: 가격 수집 + 뉴스 수집 + 트렌드(네이버만)
 *   - 오후: 가격 수집(일봉 갱신) + 뉴스 업데이트 + 트렌드(YouTube 포함)
 *
 * API 일일 한도 배분:
 *   네이버 검색 API: 25,000회/일 → 오전 12,000 + 오후 13,000
 *   YouTube Data API: 10,000유닛/일 → 오후에만 사용
 *   Google Custom Search: 100회/일 → 사용 안 함 (403 에러)
 *
 * Windows 작업 스케줄러로 등록:
 *   schtasks /create /tn "BreadAlert_AM" /tr "..." /sc daily /st 09:00
 *   schtasks /create /tn "BreadAlert_PM" /tr "..." /sc daily /st 18:00
 *
 * 실행: npx tsx src/scheduled-sync.ts [am|pm]
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
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
const LOG_FILE = resolve(__dirname, "..", "sync-log.txt");

// AM / PM 구분
const scheduleArg = process.argv[2]?.toLowerCase() ?? "";
const isAM = scheduleArg === "am";
const isPM = scheduleArg === "pm";
const scheduleName = isAM ? "오전" : isPM ? "오후" : "수동";

// ════════════════════════════════════════════════════════════════
// 유틸리티
// ════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&#\d+;/g, "");
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function log(msg: string): void {
  const ts = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n", "utf-8");
  } catch {}
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile25(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.25));
  return Math.round(sorted.slice(0, cutoff).reduce((a, b) => a + b, 0) / cutoff);
}

// ════════════════════════════════════════════════════════════════
// 네이버 API 공통
// ════════════════════════════════════════════════════════════════

let naverApiCalls = 0;

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

  naverApiCalls++;
  if (!res.ok) throw new Error(`Naver ${type} (${res.status})`);
  return res.json();
}

// ════════════════════════════════════════════════════════════════
// Phase 1: 가격 수집 → /api/prices/daily
// ════════════════════════════════════════════════════════════════

interface Ingredient {
  name: string;
  code: string;
  keywords: string[];
  priceType: "median" | "min_p25";
}

const PRICE_INGREDIENTS: Ingredient[] = [
  { name: "밀가루", code: "FLOUR", keywords: ["박력분 1kg"], priceType: "median" },
  { name: "설탕", code: "SUGAR", keywords: ["백설탕 1kg"], priceType: "median" },
  { name: "무염버터", code: "BUTTER", keywords: ["무염버터 450g"], priceType: "median" },
  { name: "계란", code: "EGG", keywords: ["달걀 30구", "계란 30구"], priceType: "min_p25" },
  { name: "우유", code: "MILK", keywords: ["서울우유 1L"], priceType: "median" },
  { name: "생크림", code: "CREAM", keywords: ["동물성 생크림 1L"], priceType: "median" },
  { name: "초콜릿", code: "CHOCOLATE", keywords: ["커버춰 초콜릿 1kg"], priceType: "median" },
  { name: "커피원두", code: "COFFEE_BEAN", keywords: ["아라비카 원두 1kg"], priceType: "median" },
  { name: "바닐라", code: "VANILLA", keywords: ["바닐라 익스트랙트"], priceType: "median" },
  { name: "아몬드", code: "ALMOND", keywords: ["아몬드 1kg"], priceType: "median" },
  { name: "이스트", code: "YEAST", keywords: ["드라이이스트 500g"], priceType: "median" },
  { name: "꿀", code: "HONEY", keywords: ["천연 꿀 500g"], priceType: "median" },
  { name: "소금", code: "SALT", keywords: ["천일염 1kg"], priceType: "median" },
  { name: "시나몬", code: "CINNAMON", keywords: ["시나몬 파우더 100g"], priceType: "median" },
  { name: "호두", code: "WALNUT", keywords: ["호두 1kg"], priceType: "median" },
  { name: "말차", code: "MATCHA", keywords: ["말차 파우더 100g"], priceType: "median" },
  { name: "카라멜", code: "CARAMEL", keywords: ["카라멜 소스 1kg"], priceType: "median" },
  { name: "크림치즈", code: "CHEESE", keywords: ["크림치즈 1kg"], priceType: "median" },
];

async function syncPrices(): Promise<{ sent: number; failed: number }> {
  log("── Phase 1: 가격 수집 → /api/prices/daily ──");
  let sent = 0, failed = 0;

  for (const ing of PRICE_INGREDIENTS) {
    let allPrices: number[] = [];

    for (const kw of ing.keywords) {
      try {
        const data = await naverSearch("shop", kw, 100, "sim");
        const prices = (data.items || []).map((i: any) => parseInt(i.lprice || "0")).filter((p: number) => p > 0);
        allPrices.push(...prices);
        await sleep(150);
      } catch (e) {
        log(`  [가격] ${kw} 오류: ${(e as Error).message}`);
      }
    }

    if (allPrices.length === 0) {
      log(`  ❌ ${ing.name} 수집 실패`);
      failed++;
      continue;
    }

    const price = ing.priceType === "min_p25" ? percentile25(allPrices) : median(allPrices);

    try {
      const res = await fetch(`${EC2_BASE_URL}/api/prices/daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientCode: ing.code,
          price,
          source: `naver_shopping_${scheduleName}`,
        }),
      });

      if (res.ok) {
        sent++;
        log(`  ✅ ${ing.code} = ${formatNumber(price)}원`);
      } else {
        failed++;
        log(`  ❌ ${ing.code} HTTP ${res.status}`);
      }
    } catch (e) {
      failed++;
      log(`  ❌ ${ing.code} 전송오류`);
    }

    await sleep(50);
  }

  log(`  가격 결과: ${sent}건 성공 / ${failed}건 실패`);
  return { sent, failed };
}

// ════════════════════════════════════════════════════════════════
// Phase 2: 뉴스 수집 → /api/internal/news/articles/batch
// ════════════════════════════════════════════════════════════════

const NEWS_KEYWORDS = [
  "밀가루 가격", "설탕 가격", "버터 가격", "계란 가격",
  "우유 가격", "커피 원두 가격", "초콜릿 원가", "생크림 가격",
  "카페 창업", "빵집 창업", "베이커리 트렌드", "디저트 트렌드",
  "소금빵", "무인카페", "카페 프랜차이즈",
];

interface NewsArticle {
  title: string;
  url: string;
  source: string | null;
  publisher: string | null;
  summary: string | null;
  publishedAt: string | null;
}

const PUBLISHER_MAP: Record<string, string> = {
  "chosun.com": "조선일보", "donga.com": "동아일보", "joongang.co.kr": "중앙일보",
  "hankyung.com": "한국경제", "mk.co.kr": "매일경제", "sedaily.com": "서울경제",
  "edaily.co.kr": "이데일리", "mt.co.kr": "머니투데이", "fnnews.com": "파이낸셜뉴스",
  "newsis.com": "뉴시스", "yna.co.kr": "연합뉴스", "hani.co.kr": "한겨레",
  "sbs.co.kr": "SBS", "kbs.co.kr": "KBS", "mbc.co.kr": "MBC",
  "jtbc.co.kr": "JTBC", "ytn.co.kr": "YTN",
};

function extractPublisher(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^(www|m|news)\./, "");
    return PUBLISHER_MAP[h] ?? h;
  } catch { return null; }
}

function parseNaverDate(d: string): string | null {
  try {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt.toISOString().replace(/\.\d{3}Z$/, "");
  } catch { return null; }
}

async function syncNews(): Promise<{ collected: number; created: number; updated: number }> {
  log("── Phase 2: 뉴스 수집 → /api/internal/news/articles/batch ──");
  const allArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  for (const keyword of NEWS_KEYWORDS) {
    try {
      const data = await naverSearch("news", keyword, 100, "date");
      for (const item of data.items || []) {
        const url = item.originallink || item.link;
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        allArticles.push({
          title: cleanHtml(item.title),
          url,
          source: "naver_news",
          publisher: extractPublisher(item.originallink || ""),
          summary: cleanHtml(item.description || "").slice(0, 500) || null,
          publishedAt: parseNaverDate(item.pubDate),
        });
      }
      await sleep(200);
    } catch (e) {
      log(`  [뉴스] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  log(`  수집: ${allArticles.length}건 (중복제거 완료)`);

  let created = 0, updated = 0;
  for (let i = 0; i < allArticles.length; i += 20) {
    const batch = allArticles.slice(i, i + 20);
    try {
      const res = await fetch(`${EC2_BASE_URL}/api/internal/news/articles/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batch }),
      });
      if (res.ok) {
        const result = await res.json() as { created: number; updated: number };
        created += result.created;
        updated += result.updated;
      }
      await sleep(100);
    } catch {}
  }

  log(`  뉴스 결과: 생성 ${created} / 갱신 ${updated}`);
  return { collected: allArticles.length, created, updated };
}

// ════════════════════════════════════════════════════════════════
// Phase 3: 트렌드 수집 → /api/internal/trends/batch
// ════════════════════════════════════════════════════════════════

interface TrendKw {
  keyword: string;
  category: string;
  ingredientCode?: string;
}

const TREND_KEYWORDS: TrendKw[] = [
  { keyword: "스페셜티 커피", category: "카페", ingredientCode: "COFFEE_BEAN" },
  { keyword: "디카페인 커피", category: "카페", ingredientCode: "COFFEE_BEAN" },
  { keyword: "카페 창업", category: "카페" },
  { keyword: "소금빵", category: "빵집", ingredientCode: "SALT" },
  { keyword: "크루아상", category: "빵집", ingredientCode: "BUTTER" },
  { keyword: "베이글", category: "빵집", ingredientCode: "FLOUR" },
  { keyword: "마카롱", category: "디저트", ingredientCode: "ALMOND" },
  { keyword: "약과", category: "디저트", ingredientCode: "HONEY" },
  { keyword: "티라미수", category: "디저트", ingredientCode: "CHEESE" },
  { keyword: "바스크 치즈케이크", category: "디저트", ingredientCode: "CHEESE" },
  { keyword: "무인카페", category: "업계" },
  { keyword: "배달 디저트", category: "업계" },
  { keyword: "발렌타인 초콜릿", category: "시즌", ingredientCode: "CHOCOLATE" },
  { keyword: "화이트데이 선물", category: "시즌", ingredientCode: "CHOCOLATE" },
  { keyword: "봄 딸기 케이크", category: "시즌", ingredientCode: "CREAM" },
];

interface TrendItem {
  bucketDate: string;
  keyword: string;
  source: string;
  ingredientCode?: string;
  buzzScore: number;
  mentionCount: number;
  positiveRatio?: number;
  negativeRatio?: number;
  topKeywords?: string;
  summary?: string;
  category?: string;
}

async function syncTrends(): Promise<{ keywords: number; created: number; updated: number }> {
  log("── Phase 3: 트렌드 수집 → /api/internal/trends/batch ──");
  const today = todayStr();
  const useYouTube = isPM && !!YOUTUBE_API_KEY;

  const trendItems: TrendItem[] = [];

  for (const kw of TREND_KEYWORDS) {
    let news = 0, blog = 0, cafe = 0, shop = 0, yt = 0;

    try { news = (await naverSearch("news", kw.keyword, 1, "date")).total || 0; } catch {}
    await sleep(120);
    try { blog = (await naverSearch("blog", kw.keyword, 1, "date")).total || 0; } catch {}
    await sleep(120);
    try { cafe = (await naverSearch("cafearticle", kw.keyword, 1, "date")).total || 0; } catch {}
    await sleep(120);
    try { shop = (await naverSearch("shop", kw.keyword, 1, "sim")).total || 0; } catch {}
    await sleep(120);

    if (useYouTube) {
      try {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
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
          yt = ((await ytRes.json()) as any).pageInfo?.totalResults || 0;
        }
      } catch {}
    }

    // 버즈 스코어
    let score = 0;
    if (news >= 1000) score += 40; else if (news >= 100) score += 20; else if (news >= 10) score += 5;
    if (blog >= 100000) score += 25; else if (blog >= 10000) score += 15; else if (blog >= 1000) score += 5;
    if (cafe >= 50000) score += 15; else if (cafe >= 10000) score += 10; else if (cafe >= 1000) score += 3;
    if (shop >= 10000) score += 10; else if (shop >= 1000) score += 5; else if (shop >= 100) score += 2;
    if (yt >= 100) score += 10; else if (yt >= 20) score += 5; else if (yt >= 5) score += 2;
    score = Math.min(100, score);

    const totalMentions = news + blog + cafe + shop + yt;

    log(`  ${kw.keyword.padEnd(14)} 뉴스:${formatNumber(news).padStart(7)} 블로그:${formatNumber(blog).padStart(9)} 버즈:${score}`);

    // COMBINED 소스로 집계 데이터 전송
    trendItems.push({
      bucketDate: today,
      keyword: kw.keyword,
      source: "COMBINED",
      ingredientCode: kw.ingredientCode,
      buzzScore: score,
      mentionCount: totalMentions,
      topKeywords: [
        news > 0 ? `뉴스:${formatNumber(news)}` : null,
        blog > 0 ? `블로그:${formatNumber(blog)}` : null,
        cafe > 0 ? `카페:${formatNumber(cafe)}` : null,
        shop > 0 ? `쇼핑:${formatNumber(shop)}` : null,
        yt > 0 ? `YouTube:${formatNumber(yt)}` : null,
      ].filter(Boolean).join(","),
      summary: `[${kw.category}] "${kw.keyword}" ${scheduleName} 트렌드. 버즈스코어 ${score}/100. 총 ${formatNumber(totalMentions)}건.`,
      category: kw.category,
    });

    // 개별 소스별 데이터도 전송
    if (news > 0) {
      trendItems.push({ bucketDate: today, keyword: kw.keyword, source: "NAVER_NEWS", ingredientCode: kw.ingredientCode, buzzScore: Math.min(40, news >= 1000 ? 40 : news >= 100 ? 20 : 5), mentionCount: news, category: kw.category });
    }
    if (blog > 0) {
      trendItems.push({ bucketDate: today, keyword: kw.keyword, source: "NAVER_BLOG", ingredientCode: kw.ingredientCode, buzzScore: Math.min(25, blog >= 100000 ? 25 : blog >= 10000 ? 15 : 5), mentionCount: blog, category: kw.category });
    }
    if (yt > 0) {
      trendItems.push({ bucketDate: today, keyword: kw.keyword, source: "YOUTUBE", ingredientCode: kw.ingredientCode, buzzScore: Math.min(10, yt >= 100 ? 10 : yt >= 20 ? 5 : 2), mentionCount: yt, category: kw.category });
    }

    await sleep(150);
  }

  // EC2 전송 → /api/internal/trends/batch
  let created = 0, updated = 0;
  for (let i = 0; i < trendItems.length; i += 50) {
    try {
      const res = await fetch(`${EC2_BASE_URL}/api/internal/trends/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: trendItems.slice(i, i + 50) }),
      });
      if (res.ok) {
        const r = await res.json() as { created: number; updated: number };
        created += r.created;
        updated += r.updated;
      }
    } catch {}
  }

  log(`  트렌드 결과: ${trendItems.length}건 전송 (생성 ${created} / 갱신 ${updated})`);
  return { keywords: TREND_KEYWORDS.length, created, updated };
}

// ════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const startTime = Date.now();

  log("");
  log("█".repeat(60));
  log(`  BreadAlert ${scheduleName} 스케줄 실행`);
  log("█".repeat(60));
  log(`  시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  log(`  EC2: ${EC2_BASE_URL}`);
  log(`  모드: ${isAM ? "오전 (가격+뉴스+트렌드/네이버)" : isPM ? "오후 (가격+뉴스+트렌드/YouTube포함)" : "수동 (전체)"}`);

  // EC2 확인
  try {
    const res = await fetch(`${EC2_BASE_URL}/api/internal/news/articles/latest?size=1`);
    log(`  EC2: ${res.ok ? "✅ 연결됨" : "⚠️ 응답 " + res.status}`);
  } catch (e) {
    log(`  EC2: ❌ 연결 실패 — ${(e as Error).message}`);
    log("  실행 중단");
    return;
  }

  // Phase 1: 가격
  const p1 = await syncPrices();

  // Phase 2: 뉴스
  const p2 = await syncNews();

  // Phase 3: 트렌드
  const p3 = await syncTrends();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

  log("");
  log("█".repeat(60));
  log(`  ${scheduleName} 스케줄 완료 (${elapsed}초)`);
  log("█".repeat(60));
  log(`  가격: ${p1.sent}건 → /api/prices/daily`);
  log(`  뉴스: ${p2.collected}건 (생성 ${p2.created} / 갱신 ${p2.updated})`);
  log(`  트렌드: ${p3.keywords}개 키워드 (생성 ${p3.created} / 갱신 ${p3.updated})`);
  log(`  네이버 API 호출: ~${naverApiCalls}회`);
  log("█".repeat(60));
  log("");
}

main().catch((e) => {
  log(`치명적 오류: ${(e as Error).message}`);
  process.exit(1);
});
