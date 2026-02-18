import { NEWS_API_BASE_URL, sleep } from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertGoogleRssNewsBatch, markGoogleRssNewsAsSynced,
  sendNewsArticlesBatch,
  type GoogleRssNewsRow,
  type NewsArticleInput,
} from "shared-db";

const RSS_KEYWORDS = [
  // 디저트/트렌드
  "디저트 트렌드 2026",
  "카페 트렌드 2026",
  "빵집 트렌드 2026",
  "베이커리 트렌드",
  "쿠키 유행",
  "크루아상 트렌드",
  "타르트 트렌드",
  "까눌레 인기",
  "두바이 쿠키",
  // 원재료 가격
  "밀가루 가격",
  "버터 가격",
  "설탕 가격",
  "달걀 가격",
  "카카오 가격",
  "바닐라 가격",
  "생크림 가격",
  "원재료 가격 동향",
  // 카페/빵집 운영
  "카페 창업",
  "빵집 창업",
  "카페 메뉴 트렌드",
];

interface RssItem {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string;
  summary: string;
}

function buildGoogleNewsRssUrl(keyword: string): string {
  const encoded = encodeURIComponent(keyword);
  return `https://news.google.com/rss/search?q=${encoded}&hl=ko&gl=KR&ceid=KR:ko`;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i");
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

async function fetchAndParseRss(keyword: string): Promise<RssItem[]> {
  const url = buildGoogleNewsRssUrl(keyword);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`RSS fetch 실패 (${response.status})`);
  }

  const xml = await response.text();
  const items: RssItem[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const description = extractTag(itemXml, "description");
    const source = extractTag(itemXml, "source");

    if (title && link) {
      items.push({
        title: decodeHtmlEntities(title),
        link,
        publisher: source ? decodeHtmlEntities(source) : "",
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString().slice(0, 19).replace("T", " "),
        summary: description ? decodeHtmlEntities(stripHtml(description)).substring(0, 500) : "",
      });
    }
  }

  return items;
}

async function main() {
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "google-rss-news-collector",
    collector: "collect-google-rss",
  });

  let totalRecords = 0;
  let totalNewsSynced = 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log("📰 Google RSS 뉴스 수집 시작");
  console.log(`수집 시각: ${new Date().toLocaleString("ko-KR")}`);
  console.log("=".repeat(60));

  try {
    for (const keyword of RSS_KEYWORDS) {
      try {
        const items = await fetchAndParseRss(keyword);

        if (items.length === 0) {
          console.log(`  ⏭️  "${keyword}" - 결과 없음`);
          continue;
        }

        // MySQL 저장
        const dbRows: GoogleRssNewsRow[] = items.map((item) => ({
          run_id: runId,
          keyword,
          title: item.title,
          link: item.link,
          publisher: item.publisher,
          published_at: item.publishedAt,
          summary: item.summary,
          source: "google_rss_kr",
        }));

        try {
          await insertGoogleRssNewsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        // News API 전송
        if (NEWS_API_BASE_URL) {
          try {
            const newsItems: NewsArticleInput[] = items.map((item) => ({
              title: item.title,
              url: item.link,
              source: "google_rss_kr",
              publisher: item.publisher,
              summary: item.summary,
              publishedAt: item.publishedAt,
            }));

            const apiResponse = await sendNewsArticlesBatch(NEWS_API_BASE_URL, newsItems);
            totalNewsSynced += apiResponse.total;

            // Mark synced rows
            for (let i = 0; i < apiResponse.results.length && i < items.length; i++) {
              try {
                await markGoogleRssNewsAsSynced(pool, items[i].link, apiResponse.results[i].newsId);
              } catch {
                // non-critical
              }
            }

            console.log(
              `  ✅ "${keyword}" - ${items.length}건 수집, News API ${apiResponse.created}건 생성 / ${apiResponse.updated}건 갱신`,
            );
          } catch (apiErr) {
            console.log(`  ⚠️  "${keyword}" - News API 전송 실패: ${(apiErr as Error).message}`);
            console.log(`  ✅ "${keyword}" - ${items.length}건 MySQL 저장 완료 (API 미전송)`);
          }
        } else {
          console.log(`  ✅ "${keyword}" - ${items.length}건 MySQL 저장 (NEWS_API_BASE_URL 미설정)`);
        }

        totalRecords += items.length;
        await sleep(500);
      } catch (e) {
        console.log(`  ❌ "${keyword}" - ${(e as Error).message}`);
      }
    }

    await completeCollectionRun(pool, runId, totalRecords);
  } catch (e) {
    await failCollectionRun(pool, runId, (e as Error).message);
    throw e;
  } finally {
    await closePool();
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Google RSS 뉴스 수집 완료");
  console.log("=".repeat(60));
  console.log(`  총 수집: ${totalRecords}건`);
  console.log(`  News API 전송: ${totalNewsSynced}건`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
