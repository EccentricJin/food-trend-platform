import {
  searchNaver,
  NEWS_API_BASE_URL,
  sleep,
  type NaverShopItem,
} from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertNaverIngredientSearchResultsBatch,
  sendNewsArticlesBatch,
  type NaverIngredientSearchRow,
  type NewsArticleInput,
} from "shared-db";

interface Ingredient {
  name: string;
  shopKeywords: string[];
  newsKeywords: string[];
}

const ingredients: Ingredient[] = [
  {
    name: "피스타치오",
    shopKeywords: ["피스타치오 분태", "피스타치오 페이스트", "피스타치오 1kg"],
    newsKeywords: ["피스타치오 가격", "피스타치오 시세"],
  },
  {
    name: "카다이프",
    shopKeywords: ["카다이프면", "카다이프 반죽", "카타이피"],
    newsKeywords: ["카다이프 가격", "카다이프 재료"],
  },
  {
    name: "다크초콜릿",
    shopKeywords: ["다크초콜릿 커버춰", "발로나 다크초콜릿", "까레보 다크초콜릿"],
    newsKeywords: ["초콜릿 원재료 가격", "카카오 가격 동향"],
  },
  {
    name: "타히니",
    shopKeywords: ["타히니 페이스트", "참깨 페이스트 타히니"],
    newsKeywords: ["타히니 가격"],
  },
  {
    name: "버터",
    shopKeywords: ["무염버터 450g", "앵커버터", "이즈니버터", "버터 베이킹용"],
    newsKeywords: ["버터 가격 동향 2026", "버터 시세"],
  },
  {
    name: "설탕",
    shopKeywords: ["백설탕 1kg", "설탕 베이킹"],
    newsKeywords: ["설탕 가격 동향"],
  },
  {
    name: "밀가루",
    shopKeywords: ["박력분 1kg", "강력분 베이킹용"],
    newsKeywords: ["밀가루 가격 동향"],
  },
  {
    name: "달걀",
    shopKeywords: ["계란 30구", "달걀 대란"],
    newsKeywords: ["달걀 가격 동향 2026", "계란 시세"],
  },
  {
    name: "바닐라",
    shopKeywords: ["바닐라 익스트랙", "바닐라빈 페이스트"],
    newsKeywords: ["바닐라 가격"],
  },
  {
    name: "두바이쿠키완제품",
    shopKeywords: ["두바이 초콜릿 쿠키", "두바이 쫀득 쿠키 완제품"],
    newsKeywords: ["두바이 쿠키 가격 비교"],
  },
  {
    name: "생크림",
    shopKeywords: ["동물성 생크림 1L", "생크림 베이킹용"],
    newsKeywords: ["생크림 가격 동향"],
  },
  {
    name: "우유",
    shopKeywords: ["우유 1L", "서울우유 1L"],
    newsKeywords: ["우유 가격 동향 2026", "원유 가격"],
  },
  {
    name: "카카오",
    shopKeywords: ["카카오파우더 베이킹", "카카오닙스", "카카오버터"],
    newsKeywords: ["카카오 가격 동향 2026", "카카오 원두 시세"],
  },
];

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").trim();
}

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "naver-food-trend-collector",
    collector: "collect-ingredients",
  });

  let totalRecords = 0;
  let totalNewsSynced = 0;

  for (const ingredient of ingredients) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`🧈 재료: ${ingredient.name}`);
    console.log("─".repeat(50));

    // 쇼핑 검색 (가격 데이터)
    for (const keyword of ingredient.shopKeywords) {
      try {
        const data = await searchNaver<NaverShopItem>("shop", keyword, 50);
        const items = data.items || [];
        if (items.length === 0) {
          console.log(`  ⏭️  [shop] "${keyword}" - 결과 없음`);
          continue;
        }

        const prices = items.map((i) => parseInt(i.lprice)).filter((p) => p > 0);
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
        const avgPrice =
          prices.length > 0
            ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
            : 0;

        // MySQL 저장
        try {
          const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
          const dbRows: NaverIngredientSearchRow[] = items.map((item: any) => ({
            run_id: runId,
            msg_type: "ingredient_price",
            category: "두바이쿠키재료",
            ingredient: ingredient.name,
            keyword,
            search_type: "shop",
            requested_at: requestedAt,
            price_stats_min: minPrice,
            price_stats_max: maxPrice,
            price_stats_avg: avgPrice,
            price_stats_count: prices.length,
            item_title: item.title ?? null,
            item_link: item.link ?? null,
            item_data: JSON.stringify(item),
          }));
          await insertNaverIngredientSearchResultsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        totalRecords += items.length;
        console.log(
          `  ✅ [shop] "${keyword}" - ${items.length}건 (최저 ${minPrice.toLocaleString()}원 / 평균 ${avgPrice.toLocaleString()}원 / 최고 ${maxPrice.toLocaleString()}원)`,
        );
        await sleep(100);
      } catch (e) {
        console.log(`  ❌ [shop] "${keyword}" - ${(e as Error).message}`);
      }
    }

    // 뉴스 검색 (가격 동향)
    for (const keyword of ingredient.newsKeywords) {
      try {
        const data = await searchNaver("news", keyword, 30);
        const items = data.items || [];
        if (items.length === 0) {
          console.log(`  ⏭️  [news] "${keyword}" - 결과 없음`);
          continue;
        }

        // MySQL 저장
        try {
          const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
          const dbRows: NaverIngredientSearchRow[] = items.map((item: any) => ({
            run_id: runId,
            msg_type: "ingredient_news",
            category: "두바이쿠키재료",
            ingredient: ingredient.name,
            keyword,
            search_type: "news",
            requested_at: requestedAt,
            price_stats_min: null,
            price_stats_max: null,
            price_stats_avg: null,
            price_stats_count: null,
            item_title: item.title ?? null,
            item_link: item.link ?? null,
            item_data: JSON.stringify(item),
          }));
          await insertNaverIngredientSearchResultsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        // News API 전송
        if (NEWS_API_BASE_URL) {
          try {
            const articles: NewsArticleInput[] = items.map((item: any) => ({
              title: stripHtml(item.title ?? ""),
              url: item.originallink ?? item.link ?? "",
              source: "naver-news",
              publisher: null,
              summary: stripHtml(item.description ?? ""),
              publishedAt: item.pubDate ?? null,
            }));
            const result = await sendNewsArticlesBatch(NEWS_API_BASE_URL, articles);
            totalNewsSynced += result.total;
            console.log(`  📰 News API: ${result.created}건 생성 / ${result.updated}건 업데이트`);
          } catch (newsErr) {
            console.log(`  [News API] 전송 실패: ${(newsErr as Error).message}`);
          }
        }

        totalRecords += items.length;
        console.log(`  ✅ [news] "${keyword}" - ${items.length}건`);
        await sleep(100);
      } catch (e) {
        console.log(`  ❌ [news] "${keyword}" - ${(e as Error).message}`);
      }
    }

    // 블로그 검색 (레시피/가격 후기)
    try {
      const blogKeyword = `${ingredient.name} 가격`;
      const data = await searchNaver("blog", blogKeyword, 30);
      const items = data.items || [];
      if (items.length > 0) {
        // MySQL 저장
        try {
          const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
          const dbRows: NaverIngredientSearchRow[] = items.map((item: any) => ({
            run_id: runId,
            msg_type: "ingredient_blog",
            category: "두바이쿠키재료",
            ingredient: ingredient.name,
            keyword: blogKeyword,
            search_type: "blog",
            requested_at: requestedAt,
            price_stats_min: null,
            price_stats_max: null,
            price_stats_avg: null,
            price_stats_count: null,
            item_title: item.title ?? null,
            item_link: item.link ?? null,
            item_data: JSON.stringify(item),
          }));
          await insertNaverIngredientSearchResultsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        totalRecords += items.length;
        console.log(`  ✅ [blog] "${blogKeyword}" - ${items.length}건`);
      }
      await sleep(100);
    } catch (e) {
      console.log(`  ❌ [blog] - ${(e as Error).message}`);
    }
  }

  await completeCollectionRun(pool, runId, totalRecords);
  await closePool();

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 재료 가격 수집 완료");
  console.log("=".repeat(60));
  console.log(`  총 레코드: ${totalRecords}건`);
  console.log(`  News API 전송: ${totalNewsSynced}건`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
