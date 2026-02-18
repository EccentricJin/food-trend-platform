import { searchGoogle, sleep } from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertGoogleSearchResultsBatch,
  type GoogleSearchRow,
} from "shared-db";

interface QueryGroup {
  category: string;
  keywords: string[];
}

const queries: QueryGroup[] = [
  {
    category: "두바이쿠키",
    keywords: [
      "두바이 초콜릿 쿠키",
      "두바이 쫀득 쿠키 레시피",
      "두바이 쿠키 재료 가격",
      "dubai chocolate cookie trend",
    ],
  },
  {
    category: "유행디저트",
    keywords: [
      "2026 유행 디저트 트렌드",
      "크럼블쿠키 인기",
      "약과 디저트 유행",
      "소금빵 트렌드",
      "휘낭시에 맛집",
      "크루아상 맛집",
      "타르트 트렌드",
      "마들렌 인기",
      "까눌레 트렌드",
      "스콘 맛집",
      "에그타르트 인기",
      "티라미수 트렌드",
    ],
  },
  {
    category: "유행음식",
    keywords: [
      "2026 음식 트렌드",
      "마라탕 인기",
      "로제떡볶이 트렌드",
      "제로음료 시장",
      "오마카세 트렌드",
    ],
  },
  {
    category: "유행카페",
    keywords: [
      "2026 핫플 카페 추천",
      "성수 카페 트렌드",
      "을지로 카페 핫플",
      "카페 디저트 트렌드",
    ],
  },
  {
    category: "카페운영",
    keywords: [
      "카페 운영 노하우",
      "카페 창업 2026",
      "카페 메뉴 트렌드",
      "카페 인테리어 트렌드",
      "카페 수익 구조",
    ],
  },
  {
    category: "베이커리운영",
    keywords: [
      "빵집 운영 노하우",
      "베이커리 트렌드 2026",
      "빵집 창업",
      "제과 트렌드",
      "베이커리 카페 창업",
    ],
  },
  {
    category: "원재료가격",
    keywords: [
      "밀가루 가격 동향",
      "버터 가격 시세",
      "설탕 가격 동향",
      "달걀 가격 시세",
      "바닐라 원재료 가격",
      "초콜릿 원재료 가격",
      "카카오 가격 동향",
      "생크림 가격",
      "우유 가격 동향",
    ],
  },
];

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "google-youtube-collector",
    collector: "collect-google",
  });

  let totalRecords = 0;

  for (const { category, keywords } of queries) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📂 카테고리: ${category}`);
    console.log("=".repeat(60));

    for (const keyword of keywords) {
      try {
        // 최근 1주일 결과
        const data = await searchGoogle(keyword, 1, 10, "w1");
        const items = data.items || [];

        if (items.length === 0) {
          console.log(`  ⏭️  "${keyword}" - 결과 없음`);
          continue;
        }

        // MySQL 저장
        try {
          const requestedAt = new Date().toISOString();
          const dbRows: GoogleSearchRow[] = items.map((item) => ({
            run_id: runId,
            category,
            keyword,
            requested_at: requestedAt,
            total_results: data.searchInformation.totalResults,
            search_time: data.searchInformation.searchTime,
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            display_link: item.displayLink,
          }));
          await insertGoogleSearchResultsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        totalRecords += items.length;
        console.log(
          `  ✅ "${keyword}" - ${items.length}건 (전체 약 ${parseInt(data.searchInformation.totalResults).toLocaleString()}건)`,
        );
        await sleep(200);
      } catch (e) {
        console.log(`  ❌ "${keyword}" - ${(e as Error).message}`);
      }
    }
  }

  await completeCollectionRun(pool, runId, totalRecords);
  await closePool();

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Google 검색 수집 완료");
  console.log("=".repeat(60));
  console.log(`  총 수집: ${totalRecords}건`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
