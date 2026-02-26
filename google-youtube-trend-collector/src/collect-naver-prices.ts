import {
  searchNaverShopping,
  sleep,
  NaverShopItem,
} from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertNaverIngredientPricesBatch,
  type NaverIngredientPriceRow,
} from "shared-db";

interface IngredientQuery {
  ingredient: string;
  unit: string;
  keywords: string[];
}

const ingredients: IngredientQuery[] = [
  {
    ingredient: "피스타치오",
    unit: "100g~1kg",
    keywords: ["피스타치오 베이킹용", "피스타치오 분태", "피스타치오 크러쉬"],
  },
  {
    ingredient: "카다이프(카타이피)",
    unit: "500g",
    keywords: ["카다이프", "카타이피", "카다이프 면"],
  },
  {
    ingredient: "다크초콜릿(커버춰)",
    unit: "1kg",
    keywords: ["커버춰 초콜릿 다크", "베이킹 다크초콜릿", "발로나 다크초콜릿"],
  },
  {
    ingredient: "타히니(참깨페이스트)",
    unit: "300g~500g",
    keywords: ["타히니", "타히니 페이스트", "참깨 페이스트"],
  },
  {
    ingredient: "무염버터",
    unit: "450g~1kg",
    keywords: ["무염버터", "베이킹 버터", "발효버터"],
  },
  {
    ingredient: "설탕",
    unit: "1kg",
    keywords: ["백설탕 1kg", "비정제 설탕", "베이킹 설탕"],
  },
  {
    ingredient: "박력분(밀가루)",
    unit: "1kg",
    keywords: ["박력분 1kg", "베이킹 밀가루", "박력 밀가루"],
  },
  {
    ingredient: "달걀",
    unit: "30구",
    keywords: ["달걀 30구", "계란 30구", "신선 달걀"],
  },
  {
    ingredient: "바닐라 익스트랙트",
    unit: "1병",
    keywords: ["바닐라 익스트랙트", "바닐라 에센스 베이킹", "바닐라빈 페이스트"],
  },
  {
    ingredient: "두바이쿠키 완제품",
    unit: "1개",
    keywords: ["두바이 쫀득 쿠키", "두쫀쿠", "두바이 초콜릿 쿠키"],
  },
  {
    ingredient: "생크림",
    unit: "1L",
    keywords: ["동물성 생크림", "생크림 1L", "베이킹 생크림"],
  },
  {
    ingredient: "우유",
    unit: "1L",
    keywords: ["우유 1L", "서울우유", "베이킹 우유"],
  },
];

function cleanHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "google-youtube-collector",
    collector: "collect-naver-prices",
  });

  let totalRecords = 0;

  console.log(`\n${"=".repeat(65)}`);
  console.log("🍪 두바이 쫀득 쿠키 재료 + 완제품 실제 판매 가격 수집 (Naver 쇼핑)");
  console.log(`수집 시각: ${new Date().toLocaleString("ko-KR")}`);
  console.log("=".repeat(65));

  for (const { ingredient, unit, keywords } of ingredients) {
    console.log(`\n── 🧂 ${ingredient} (단위: ${unit}) ──`);

    for (const keyword of keywords) {
      try {
        const data = await searchNaverShopping(keyword, 100, "sim");
        const items = data.items || [];

        if (items.length === 0) {
          console.log(`  ⏭️  "${keyword}" - 결과 없음`);
          continue;
        }

        // MySQL 저장
        try {
          const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
          const dbRows: NaverIngredientPriceRow[] = items.map((item: NaverShopItem) => ({
            run_id: runId,
            ingredient,
            unit,
            keyword,
            requested_at: requestedAt,
            total_results: data.total,
            product_title: cleanHtml(item.title),
            product_link: item.link,
            product_image: item.image,
            lprice: parseInt(item.lprice || "0") || null,
            hprice: parseInt(item.hprice || "0") || null,
            mall_name: item.mallName,
            brand: item.brand,
            maker: item.maker,
            product_type: item.productType,
            category1: item.category1,
            category2: item.category2,
            category3: item.category3,
            category4: item.category4,
          }));
          await insertNaverIngredientPricesBatch(pool, dbRows);
          totalRecords += dbRows.length;
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        // 가격 통계
        const prices = items
          .map((i: NaverShopItem) => parseInt(i.lprice || "0"))
          .filter((p: number) => p > 0);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length);

        console.log(
          `  ✅ "${keyword}" - ${items.length}건 (전체 ${data.total.toLocaleString()}건)`,
        );
        console.log(
          `     💰 최저 ${minPrice.toLocaleString()}원 | 평균 ${avgPrice.toLocaleString()}원 | 최고 ${maxPrice.toLocaleString()}원`,
        );

        // 최저가 TOP 3
        const top3 = items
          .filter((i: NaverShopItem) => parseInt(i.lprice || "0") > 0)
          .sort((a: NaverShopItem, b: NaverShopItem) => parseInt(a.lprice) - parseInt(b.lprice))
          .slice(0, 3);
        for (const item of top3) {
          console.log(
            `     🏷️  ${parseInt(item.lprice).toLocaleString()}원 - ${cleanHtml(item.title).substring(0, 45)}`,
          );
        }

        await sleep(200);
      } catch (e) {
        console.log(`  ❌ "${keyword}" - ${(e as Error).message}`);
      }
    }
  }

  await completeCollectionRun(pool, runId, totalRecords);
  await closePool();

  console.log(`\n${"=".repeat(65)}`);
  console.log("📊 Naver 쇼핑 가격 수집 완료");
  console.log("=".repeat(65));
  console.log(`  총 저장 레코드: ${totalRecords}건`);
  console.log(`  재료 종류: ${ingredients.length}종`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(65));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
