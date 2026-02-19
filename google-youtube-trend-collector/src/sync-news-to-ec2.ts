/**
 * 빵집/카페 원자재 뉴스 수집 → EC2 News API 전송
 *
 * 수집 소스:
 *   1. 네이버 뉴스 검색 API (openapi.naver.com/v1/search/news)
 *   2. 구글 Custom Search API (뉴스 필터)
 *
 * 전송 대상:
 *   EC2 News 도메인 API (POST /api/internal/news/articles/batch)
 *
 * 실행: npx tsx src/sync-news-to-ec2.ts
 */

import { readFileSync } from "fs";
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
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID ?? "";

const BATCH_SIZE = 20; // EC2 배치 전송 사이즈

// ════════════════════════════════════════════════════════════════
// 1. 원자재 뉴스 검색 키워드
// ════════════════════════════════════════════════════════════════

interface SearchKeyword {
  ingredient: string;
  keywords: string[];
}

const SEARCH_KEYWORDS: SearchKeyword[] = [
  {
    ingredient: "밀가루",
    keywords: ["밀가루 가격", "밀 가격 전망", "소맥분 가격", "밀가루 인상"],
  },
  {
    ingredient: "설탕",
    keywords: ["설탕 가격", "원당 가격", "설탕 시세 전망"],
  },
  {
    ingredient: "버터",
    keywords: ["버터 가격", "버터 품귀", "버터 수급"],
  },
  {
    ingredient: "계란",
    keywords: ["계란 가격", "달걀 시세", "계란 가격 전망", "조류독감 달걀"],
  },
  {
    ingredient: "우유",
    keywords: ["우유 가격", "원유 기준가", "우유 인상"],
  },
  {
    ingredient: "생크림",
    keywords: ["생크림 가격", "유지방 가격"],
  },
  {
    ingredient: "초콜릿",
    keywords: ["코코아 가격", "초콜릿 원가", "카카오 가격 전망"],
  },
  {
    ingredient: "커피",
    keywords: ["커피 원두 가격", "아라비카 시세", "커피 가격 전망", "커피 원가"],
  },
  {
    ingredient: "바닐라",
    keywords: ["바닐라 가격", "바닐라빈 시세"],
  },
  {
    ingredient: "아몬드",
    keywords: ["아몬드 가격", "견과류 시세", "아몬드 전망"],
  },
];

// ════════════════════════════════════════════════════════════════
// 2. 뉴스 수집 타입
// ════════════════════════════════════════════════════════════════

interface CollectedNews {
  title: string;
  url: string;
  source: string;
  publisher: string | null;
  summary: string | null;
  publishedAt: string | null;
}

// EC2 API 요청 타입
interface NewsArticleRequest {
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 2) + "..";
}

/** 네이버 날짜(RFC 822) → ISO-8601 */
function parseNaverDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace(/\.\d{3}Z$/, "");
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 4. 네이버 뉴스 검색 API
// ════════════════════════════════════════════════════════════════

interface NaverNewsItem {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string;
}

interface NaverNewsResult {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: NaverNewsItem[];
}

async function searchNaverNews(
  query: string,
  display = 100,
  sort: "sim" | "date" = "date",
): Promise<NaverNewsResult> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID/SECRET 환경변수 필요");
  }

  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", sort);

  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    throw new Error(`Naver News API 오류 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<NaverNewsResult>;
}

async function collectNaverNews(keywords: string[]): Promise<CollectedNews[]> {
  const results: CollectedNews[] = [];

  for (const keyword of keywords) {
    try {
      const data = await searchNaverNews(keyword, 100, "date");
      const items = data.items || [];

      for (const item of items) {
        // 원본 링크 우선, 없으면 네이버 링크
        const articleUrl = item.originallink || item.link;
        if (!articleUrl) continue;

        results.push({
          title: cleanHtml(item.title),
          url: articleUrl,
          source: "naver_news",
          publisher: extractPublisher(item.originallink),
          summary: cleanHtml(item.description) || null,
          publishedAt: parseNaverDate(item.pubDate),
        });
      }

      await sleep(200);
    } catch (e) {
      console.log(`    [Naver] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  return results;
}

function extractPublisher(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/^m\./, "")
      .replace(/^news\./, "");

    const publisherMap: Record<string, string> = {
      "chosun.com": "조선일보",
      "donga.com": "동아일보",
      "joongang.co.kr": "중앙일보",
      "hankyung.com": "한국경제",
      "mk.co.kr": "매일경제",
      "sedaily.com": "서울경제",
      "edaily.co.kr": "이데일리",
      "mt.co.kr": "머니투데이",
      "fnnews.com": "파이낸셜뉴스",
      "newsis.com": "뉴시스",
      "yna.co.kr": "연합뉴스",
      "yonhapnews.co.kr": "연합뉴스",
      "hani.co.kr": "한겨레",
      "khan.co.kr": "경향신문",
      "kmib.co.kr": "국민일보",
      "sbs.co.kr": "SBS",
      "kbs.co.kr": "KBS",
      "mbc.co.kr": "MBC",
      "jtbc.co.kr": "JTBC",
      "ytn.co.kr": "YTN",
      "biz.chosun.com": "조선비즈",
      "nocutnews.co.kr": "노컷뉴스",
      "hankookilbo.com": "한국일보",
      "asiae.co.kr": "아시아경제",
      "newspim.com": "뉴스핌",
      "etnews.com": "전자신문",
      "zdnet.co.kr": "ZDNet Korea",
      "bloter.net": "블로터",
    };

    return publisherMap[hostname] ?? hostname;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 5. 구글 뉴스 검색 API
// ════════════════════════════════════════════════════════════════

interface GoogleSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

interface GoogleSearchResult {
  searchInformation: { totalResults: string };
  items?: GoogleSearchItem[];
}

async function searchGoogleNews(
  query: string,
  num = 10,
): Promise<GoogleSearchResult> {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    throw new Error("GOOGLE_API_KEY/CSE_ID 환경변수 필요");
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(num));
  url.searchParams.set("gl", "kr");
  url.searchParams.set("lr", "lang_ko");
  url.searchParams.set("dateRestrict", "w1"); // 최근 1주
  url.searchParams.set("sort", "date");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google API 오류 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<GoogleSearchResult>;
}

async function collectGoogleNews(keywords: string[]): Promise<CollectedNews[]> {
  const results: CollectedNews[] = [];

  for (const keyword of keywords) {
    try {
      const data = await searchGoogleNews(keyword, 10);
      const items = data.items || [];

      for (const item of items) {
        results.push({
          title: cleanHtml(item.title),
          url: item.link,
          source: "google_search",
          publisher: item.displayLink || null,
          summary: cleanHtml(item.snippet) || null,
          publishedAt: null, // 구글 검색 결과에는 정확한 날짜가 없음
        });
      }

      await sleep(300);
    } catch (e) {
      console.log(`    [Google] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  return results;
}

// ════════════════════════════════════════════════════════════════
// 6. EC2 News API 전송
// ════════════════════════════════════════════════════════════════

async function sendBatchToEc2(
  articles: NewsArticleRequest[],
): Promise<BatchResponse> {
  const url = `${EC2_BASE_URL}/api/internal/news/articles/batch`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: articles }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EC2 API 오류 (${res.status}): ${text}`);
  }

  return res.json() as Promise<BatchResponse>;
}

async function syncToEc2(articles: CollectedNews[]): Promise<{
  totalSent: number;
  totalCreated: number;
  totalUpdated: number;
  errors: number;
}> {
  let totalSent = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let errors = 0;

  // 배치 단위로 전송
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(articles.length / BATCH_SIZE);

    try {
      const payload: NewsArticleRequest[] = batch.map((a) => ({
        title: a.title,
        url: a.url,
        source: a.source,
        publisher: a.publisher,
        summary: a.summary ? a.summary.slice(0, 500) : null,
        publishedAt: a.publishedAt,
      }));

      const result = await sendBatchToEc2(payload);
      totalSent += result.total;
      totalCreated += result.created;
      totalUpdated += result.updated;

      console.log(
        `    배치 [${batchNum}/${totalBatches}] ` +
          `${result.total}건 전송 → 생성 ${result.created} | 갱신 ${result.updated}`,
      );

      await sleep(100);
    } catch (e) {
      errors++;
      console.log(
        `    배치 [${batchNum}/${totalBatches}] 오류: ${(e as Error).message}`,
      );
    }
  }

  return { totalSent, totalCreated, totalUpdated, errors };
}

// ════════════════════════════════════════════════════════════════
// 7. URL 중복 제거
// ════════════════════════════════════════════════════════════════

function deduplicateByUrl(articles: CollectedNews[]): CollectedNews[] {
  const seen = new Map<string, CollectedNews>();

  for (const a of articles) {
    // URL 정규화: 쿼리 파라미터 제거하지 않음 (다른 기사일 수 있으므로)
    const normalizedUrl = a.url.trim();
    if (!seen.has(normalizedUrl)) {
      seen.set(normalizedUrl, a);
    }
  }

  return [...seen.values()];
}

// ════════════════════════════════════════════════════════════════
// 8. 메인 실행
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

  console.log();
  console.log("=".repeat(70));
  console.log("  빵집/카페 원자재 뉴스 → EC2 전송");
  console.log("=".repeat(70));
  console.log(`  실행 시각: ${dateStr} ${timeStr}`);
  console.log(`  EC2 대상: ${EC2_BASE_URL}`);
  console.log(`  원자재: ${SEARCH_KEYWORDS.length}종`);
  console.log(`  소스: 네이버 뉴스 API + Google Custom Search API`);
  console.log("=".repeat(70));

  // ── EC2 연결 확인 ──
  console.log("\n[0] EC2 서버 연결 확인...");
  try {
    const healthRes = await fetch(
      `${EC2_BASE_URL}/api/internal/news/articles/latest?size=1`,
    );
    if (healthRes.ok) {
      const latest = (await healthRes.json()) as Array<{ newsId: number }>;
      console.log(`  ✅ EC2 연결 성공 (현재 최신 newsId: ${latest[0]?.newsId ?? "-"})`);
    } else {
      throw new Error(`HTTP ${healthRes.status}`);
    }
  } catch (e) {
    console.log(`  ❌ EC2 연결 실패: ${(e as Error).message}`);
    console.log("  전송을 건너뛰고 수집만 진행합니다.\n");
  }

  let allArticles: CollectedNews[] = [];
  let naverTotal = 0;
  let googleTotal = 0;

  // ── 원자재별 뉴스 수집 ──
  for (let i = 0; i < SEARCH_KEYWORDS.length; i++) {
    const { ingredient, keywords } = SEARCH_KEYWORDS[i];
    console.log(`\n[${i + 1}/${SEARCH_KEYWORDS.length}] 📰 ${ingredient}`);

    // 네이버 뉴스
    const naverNews = await collectNaverNews(keywords);
    naverTotal += naverNews.length;
    console.log(`  네이버: ${naverNews.length}건`);

    // 구글 뉴스
    const googleNews = await collectGoogleNews(keywords);
    googleTotal += googleNews.length;
    console.log(`  구글:   ${googleNews.length}건`);

    allArticles.push(...naverNews, ...googleNews);

    if (i < SEARCH_KEYWORDS.length - 1) {
      await sleep(300);
    }
  }

  // ── 중복 제거 ──
  const beforeDedup = allArticles.length;
  allArticles = deduplicateByUrl(allArticles);
  const afterDedup = allArticles.length;

  console.log("\n" + "─".repeat(70));
  console.log("  수집 결과");
  console.log("─".repeat(70));
  console.log(`  네이버 뉴스: ${naverTotal}건`);
  console.log(`  구글 검색:   ${googleTotal}건`);
  console.log(`  합계:        ${beforeDedup}건`);
  console.log(`  중복 제거:   -${beforeDedup - afterDedup}건`);
  console.log(`  최종 전송:   ${afterDedup}건`);

  if (allArticles.length === 0) {
    console.log("\n  수집된 뉴스가 없습니다. 종료합니다.");
    return;
  }

  // ── 소스별 통계 ──
  const bySource = new Map<string, number>();
  for (const a of allArticles) {
    bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);
  }
  console.log("\n  소스별 분포:");
  for (const [src, cnt] of bySource) {
    console.log(`    ${src}: ${cnt}건`);
  }

  // ── EC2 전송 ──
  console.log("\n" + "─".repeat(70));
  console.log("  EC2 전송 시작");
  console.log("─".repeat(70));

  const syncResult = await syncToEc2(allArticles);

  // ── 최종 결과 ──
  console.log("\n" + "=".repeat(70));
  console.log("  전송 완료");
  console.log("=".repeat(70));
  console.log(`  총 전송: ${syncResult.totalSent}건`);
  console.log(`  신규 생성: ${syncResult.totalCreated}건`);
  console.log(`  기존 갱신: ${syncResult.totalUpdated}건`);
  console.log(`  전송 오류: ${syncResult.errors}건`);
  console.log(`  EC2 대상: ${EC2_BASE_URL}/api/internal/news/articles`);
  console.log("=".repeat(70));

  // ── 전송 확인 ──
  try {
    const verifyRes = await fetch(
      `${EC2_BASE_URL}/api/internal/news/articles/latest?size=3`,
    );
    if (verifyRes.ok) {
      const latest = (await verifyRes.json()) as Array<{
        newsId: number;
        title: string;
        source: string;
      }>;
      console.log("\n  [검증] 최신 뉴스 TOP 3:");
      for (const n of latest) {
        console.log(`    #${n.newsId} [${n.source}] ${truncate(n.title, 50)}`);
      }
    }
  } catch {
    // 검증 실패 무시
  }

  console.log();
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
