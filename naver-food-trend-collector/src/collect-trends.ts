import { searchNaver, NEWS_API_BASE_URL, sleep } from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertNaverSearchResultsBatch,
  sendNewsArticlesBatch,
  type NaverSearchRow,
  type NewsArticleInput,
} from "shared-db";

interface QueryGroup {
  category: string;
  keywords: string[];
}

const queries: QueryGroup[] = [
  {
    category: "두바이쿠키",
    keywords: ["두바이 초콜릿 쿠키", "두바이 쫀득 쿠키", "두바이 쿠키 맛집"],
  },
  {
    category: "유행디저트",
    keywords: [
      "2026 유행 디저트",
      "크럼블쿠키",
      "약과 디저트",
      "소금빵",
      "휘낭시에",
      "크루아상 맛집",
      "마카롱 신메뉴",
    ],
  },
  {
    category: "유행음식",
    keywords: [
      "2026 유행 음식",
      "마라탕 맛집",
      "로제떡볶이",
      "제로음료 트렌드",
      "수비드 스테이크",
      "오마카세 맛집",
      "주먹밥 맛집",
    ],
  },
  {
    category: "유행카페",
    keywords: [
      "2026 핫플 카페",
      "성수 카페 추천",
      "을지로 카페",
      "카페 디저트 맛집",
      "대형카페 추천",
      "뷰맛집 카페",
      "브런치 카페",
    ],
  },
  {
    category: "카페운영",
    keywords: [
      "카페 창업 2026",
      "카페 운영 팁",
      "카페 메뉴 트렌드",
      "카페 원가 관리",
    ],
  },
  {
    category: "베이커리운영",
    keywords: [
      "베이커리 창업 2026",
      "베이커리 트렌드",
      "빵집 인기 메뉴",
      "베이커리 원가",
    ],
  },
  {
    category: "원재료가격",
    keywords: [
      "밀가루 가격 동향 2026",
      "버터 가격 동향 2026",
      "설탕 가격 동향 2026",
      "카카오 가격 동향 2026",
      "달걀 가격 동향 2026",
    ],
  },
];

const SHOP_KEYWORDS = new Set([
  "두바이 초콜릿 쿠키",
  "두바이 쫀득 쿠키",
  "크럼블쿠키",
  "약과 디저트",
  "소금빵",
  "휘낭시에",
  "마카롱 신메뉴",
  "크루아상 맛집",
  "로제떡볶이",
  "주먹밥 맛집",
]);

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
}

type SearchType = "news" | "blog" | "shop";

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "naver-food-trend-collector",
    collector: "collect-trends",
  });

  const searchTypes: SearchType[] = ["news", "blog", "shop"];
  let totalRecords = 0;
  let totalItems = 0;

  for (const { category, keywords } of queries) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📂 카테고리: ${category}`);
    console.log("=".repeat(60));

    for (const keyword of keywords) {
      for (const type of searchTypes) {
        if (type === "shop" && !SHOP_KEYWORDS.has(keyword)) continue;

        try {
          const data = await searchNaver(type, keyword, type === "shop" ? 50 : 100);
          const items = data.items || [];

          if (items.length === 0) {
            console.log(`  ⏭️  [${type}] "${keyword}" - 결과 없음`);
            continue;
          }

          // MySQL 저장
          try {
            const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
            const dbRows: NaverSearchRow[] = items.map((item: any) => ({
              run_id: runId,
              msg_type: `search_${type}`,
              category,
              keyword,
              search_type: type,
              requested_at: requestedAt,
              total_available: data.total,
              item_title: item.title ?? null,
              item_link: item.link ?? null,
              item_data: JSON.stringify(item),
            }));
            await insertNaverSearchResultsBatch(pool, dbRows);
            totalRecords += dbRows.length;
          } catch (dbErr) {
            console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
          }

          // News API 전송 (news 타입만)
          if (type === "news" && NEWS_API_BASE_URL) {
            try {
              const articles: NewsArticleInput[] = items.map((item: any) => ({
                title: stripHtml(item.title ?? ""),
                url: item.originallink ?? item.link ?? "",
                source: "naver-news",
                publisher: item.mallName ?? null,
                summary: stripHtml(item.description ?? ""),
                publishedAt: item.pubDate ?? null,
              }));
              const result = await sendNewsArticlesBatch(NEWS_API_BASE_URL, articles);
              console.log(`  📰 News API: ${result.created}건 생성 / ${result.updated}건 업데이트`);
            } catch (newsErr) {
              console.log(`  [News API] 전송 실패: ${(newsErr as Error).message}`);
            }
          }

          totalItems += items.length;
          console.log(
            `  ✅ [${type}] "${keyword}" - ${items.length}건 수집 (전체 ${data.total}건)`,
          );
          await sleep(100);
        } catch (e) {
          console.log(`  ❌ [${type}] "${keyword}" - 오류: ${(e as Error).message}`);
        }
      }
    }
  }

  await completeCollectionRun(pool, runId, totalRecords);
  await closePool();

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 수집 완료 요약");
  console.log("=".repeat(60));
  console.log(`  총 저장 레코드: ${totalRecords}건`);
  console.log(`  총 수집 아이템: ${totalItems}건`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
