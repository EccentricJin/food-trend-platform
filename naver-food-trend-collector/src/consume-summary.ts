import { kafka, TOPIC, KAFKA_GROUP_ID } from "./lib.js";

interface CategoryStats {
  count: number;
}

interface PriceStats {
  items: number;
  allMin: number;
  allMax: number;
  totalAvg: number;
  avgCount: number;
}

async function main() {
  const consumer = kafka.consumer({ groupId: `${KAFKA_GROUP_ID}-summary-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topics: [TOPIC], fromBeginning: true });

  const stats = {
    total: 0,
    byCategory: {} as Record<string, number>,
    byType: {} as Record<string, number>,
    byKeyword: {} as Record<string, number>,
    ingredientPrices: {} as Record<string, PriceStats>,
  };

  let resolve: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  const timeout = setTimeout(() => resolve(), 20000);

  await consumer.run({
    eachMessage: async ({ message }) => {
      stats.total++;
      const headers: Record<string, string> = {};
      if (message.headers) {
        for (const [k, v] of Object.entries(message.headers)) {
          if (Buffer.isBuffer(v)) headers[k] = v.toString();
          else if (typeof v === "string") headers[k] = v;
        }
      }

      const cat = headers.category || "unknown";
      const type = headers.searchType || "unknown";
      const query = headers.query || "unknown";

      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      const keywordKey = `[${type}] ${query}`;
      stats.byKeyword[keywordKey] = (stats.byKeyword[keywordKey] || 0) + 1;

      // 재료 가격 통계
      try {
        const val = JSON.parse(message.value?.toString() ?? "{}");
        if (val.type === "ingredient_price" && val.priceStats) {
          const name = val.ingredient as string;
          if (!stats.ingredientPrices[name]) {
            stats.ingredientPrices[name] = {
              items: 0,
              allMin: Infinity,
              allMax: 0,
              totalAvg: 0,
              avgCount: 0,
            };
          }
          const s = stats.ingredientPrices[name];
          s.items++;
          if (val.priceStats.min > 0 && val.priceStats.min < s.allMin)
            s.allMin = val.priceStats.min;
          if (val.priceStats.max > s.allMax) s.allMax = val.priceStats.max;
          if (val.priceStats.avg > 0) {
            s.totalAvg += val.priceStats.avg;
            s.avgCount++;
          }
        }
      } catch {
        // skip
      }
    },
  });

  await done;
  clearTimeout(timeout);
  await consumer.disconnect();

  // ── 결과 출력 ──
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Kafka 데이터 취합 결과");
  console.log("=".repeat(60));
  console.log(`\n총 메시지 수: ${stats.total}건\n`);

  console.log("── 카테고리별 ──");
  for (const [cat, count] of Object.entries(stats.byCategory).sort(
    (a, b) => (b[1] as number) - (a[1] as number),
  )) {
    console.log(`  ${cat}: ${count}건`);
  }

  console.log("\n── 검색 유형별 ──");
  for (const [type, count] of Object.entries(stats.byType).sort(
    (a, b) => (b[1] as number) - (a[1] as number),
  )) {
    console.log(`  ${type}: ${count}건`);
  }

  console.log("\n── 키워드별 상위 20개 ──");
  const topKeywords = Object.entries(stats.byKeyword)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 20);
  for (const [kw, count] of topKeywords) {
    console.log(`  ${kw}: ${count}건`);
  }

  // 재료 가격 테이블
  const priceEntries = Object.entries(stats.ingredientPrices);
  if (priceEntries.length > 0) {
    console.log("\n── 두바이 쿠키 재료 가격 요약 ──");
    console.log(
      "┌─────────────────┬────────────┬────────────┬────────────┬────────┐",
    );
    console.log(
      "│ 재료            │ 최저가     │ 평균가     │ 최고가     │ 상품수 │",
    );
    console.log(
      "├─────────────────┼────────────┼────────────┼────────────┼────────┤",
    );

    for (const [name, s] of priceEntries.sort((a, b) => b[1].items - a[1].items)) {
      const avg = s.avgCount > 0 ? Math.round(s.totalAvg / s.avgCount) : 0;
      const min = s.allMin === Infinity ? 0 : s.allMin;
      console.log(
        `│ ${name.padEnd(15)} │ ${(min.toLocaleString() + "원").padStart(10)} │ ${(avg.toLocaleString() + "원").padStart(10)} │ ${(s.allMax.toLocaleString() + "원").padStart(10)} │ ${String(s.items).padStart(6)} │`,
      );
    }
    console.log(
      "└─────────────────┴────────────┴────────────┴────────────┴────────┘",
    );
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((e) => {
  console.error("오류:", (e as Error).message);
  process.exit(1);
});
