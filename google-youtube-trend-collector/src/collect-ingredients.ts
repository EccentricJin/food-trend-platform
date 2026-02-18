import {
  searchYouTube,
  getYouTubeVideoStats,
  sleep,
  oneWeekAgo,
} from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertYouTubeIngredientPricesBatch,
  type YouTubeIngredientRow,
} from "shared-db";

interface IngredientQuery {
  ingredient: string;
  keywords: string[];
}

const ingredients: IngredientQuery[] = [
  {
    ingredient: "피스타치오",
    keywords: ["피스타치오 가격", "피스타치오 구매 추천", "피스타치오 베이킹 재료"],
  },
  {
    ingredient: "카다이프(카타이피)",
    keywords: ["카다이프 가격", "카다이프 구매", "카타이피 면 베이킹"],
  },
  {
    ingredient: "다크초콜릿",
    keywords: ["다크초콜릿 가격 비교", "베이킹 초콜릿 추천", "커버춰 초콜릿 가격"],
  },
  {
    ingredient: "타히니(참깨페이스트)",
    keywords: ["타히니 가격", "타히니 만들기", "참깨 페이스트 구매"],
  },
  {
    ingredient: "버터",
    keywords: ["버터 가격 비교 2026", "베이킹 버터 추천", "무염버터 가격"],
  },
  {
    ingredient: "설탕",
    keywords: ["설탕 가격 2026", "베이킹 설탕 종류", "비정제 설탕 가격"],
  },
  {
    ingredient: "밀가루",
    keywords: ["밀가루 가격 비교", "박력분 가격", "베이킹 밀가루 추천"],
  },
  {
    ingredient: "달걀",
    keywords: ["달걀 가격 시세", "계란 가격 2026", "달걀 가격 추이"],
  },
  {
    ingredient: "바닐라",
    keywords: ["바닐라 에센스 가격", "바닐라빈 가격", "바닐라 익스트랙트 추천"],
  },
  {
    ingredient: "두바이쿠키 완제품",
    keywords: ["두바이 쫀득 쿠키 가격", "두쫀쿠 가격 비교", "두바이 쿠키 편의점 가격"],
  },
  {
    ingredient: "생크림",
    keywords: ["생크림 가격", "동물성 생크림 가격", "베이킹 생크림"],
  },
  {
    ingredient: "우유",
    keywords: ["우유 가격 시세", "베이킹 우유 가격", "우유 원유 가격"],
  },
  {
    ingredient: "카카오",
    keywords: ["카카오 가격 동향", "카카오 원두 시세", "카카오 버터 가격"],
  },
];

function buildDbRows(
  runId: string,
  ingredient: string,
  keyword: string,
  period: string,
  totalResults: number,
  itemsList: Array<{ id: { videoId?: string }; snippet: { title: string; description: string; channelTitle: string; publishedAt: string; thumbnails: Record<string, { url: string; width: number; height: number }> } }>,
  statsMap: Record<string, { viewCount: string; likeCount: string; commentCount: string }>,
): YouTubeIngredientRow[] {
  const requestedAt = new Date().toISOString();
  return itemsList.map((item) => {
    const videoId = item.id.videoId ?? "";
    const stats = statsMap[videoId];
    return {
      run_id: runId,
      ingredient,
      keyword,
      requested_at: requestedAt,
      period,
      total_results: totalResults,
      video_id: videoId,
      video_title: item.snippet.title,
      video_description: item.snippet.description,
      channel_title: item.snippet.channelTitle,
      published_at: item.snippet.publishedAt,
      thumbnail_url: item.snippet.thumbnails?.medium?.url ?? "",
      video_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      view_count: stats ? parseInt(stats.viewCount || "0") : null,
      like_count: stats ? parseInt(stats.likeCount || "0") : null,
      comment_count: stats ? parseInt(stats.commentCount || "0") : null,
    };
  });
}

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "google-youtube-collector",
    collector: "collect-ingredients",
  });

  let totalRecords = 0;
  const publishedAfter = oneWeekAgo();

  console.log(`\n${"=".repeat(60)}`);
  console.log("🍪 두바이 쫀득 쿠키 재료 가격 수집 (YouTube)");
  console.log(`수집 기간: ${publishedAfter.split("T")[0]} ~ 현재`);
  console.log("=".repeat(60));

  for (const { ingredient, keywords } of ingredients) {
    console.log(`\n── 🧂 ${ingredient} ──`);

    for (const keyword of keywords) {
      try {
        // 최근 1주일, 관련도순 15건
        const data = await searchYouTube(keyword, 15, "relevance", publishedAfter);
        const items = data.items || [];

        if (items.length === 0) {
          // 기간 제한 없이 재시도
          const dataAll = await searchYouTube(keyword, 15, "relevance");
          const itemsAll = dataAll.items || [];

          if (itemsAll.length === 0) {
            console.log(`  ⏭️  "${keyword}" - 결과 없음`);
            continue;
          }

          // 통계 가져오기
          const videoIds = itemsAll
            .map((i) => i.id.videoId)
            .filter((id): id is string => !!id);

          let statsMap: Record<string, { viewCount: string; likeCount: string; commentCount: string }> = {};
          if (videoIds.length > 0) {
            try {
              const statsResult = await getYouTubeVideoStats(videoIds);
              for (const v of statsResult.items) {
                statsMap[v.id] = v.statistics;
              }
            } catch {
              // 통계 조회 실패 시 무시
            }
          }

          // MySQL 저장
          try {
            const dbRows = buildDbRows(runId, ingredient, keyword, "all", dataAll.pageInfo.totalResults, itemsAll, statsMap);
            await insertYouTubeIngredientPricesBatch(pool, dbRows);
            totalRecords += dbRows.length;
          } catch (dbErr) {
            console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
          }

          console.log(
            `  ✅ "${keyword}" - ${itemsAll.length}건 (전체기간, 총 ${dataAll.pageInfo.totalResults}건)`,
          );
          await sleep(200);
          continue;
        }

        // 통계 가져오기
        const videoIds = items
          .map((i) => i.id.videoId)
          .filter((id): id is string => !!id);

        let statsMap: Record<string, { viewCount: string; likeCount: string; commentCount: string }> = {};
        if (videoIds.length > 0) {
          try {
            const statsResult = await getYouTubeVideoStats(videoIds);
            for (const v of statsResult.items) {
              statsMap[v.id] = v.statistics;
            }
          } catch {
            // 통계 조회 실패 시 무시
          }
        }

        // MySQL 저장
        try {
          const dbRows = buildDbRows(runId, ingredient, keyword, "1week", data.pageInfo.totalResults, items, statsMap);
          await insertYouTubeIngredientPricesBatch(pool, dbRows);
          totalRecords += dbRows.length;
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        // 조회수 상위 2개 표시
        const topViewed = items
          .filter((i) => i.id.videoId && statsMap[i.id.videoId!])
          .sort((a, b) => {
            const aViews = parseInt(statsMap[a.id.videoId!]?.viewCount || "0");
            const bViews = parseInt(statsMap[b.id.videoId!]?.viewCount || "0");
            return bViews - aViews;
          })
          .slice(0, 2);

        console.log(
          `  ✅ "${keyword}" - ${items.length}건 (1주일, 총 ${data.pageInfo.totalResults}건)`,
        );
        for (const v of topViewed) {
          const stats = statsMap[v.id.videoId!];
          console.log(
            `     🎬 ${v.snippet.title.substring(0, 50)}... (조회 ${parseInt(stats.viewCount).toLocaleString()})`,
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

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 재료 가격 수집 완료");
  console.log("=".repeat(60));
  console.log(`  총 저장 레코드: ${totalRecords}건`);
  console.log(`  재료 종류: ${ingredients.length}종`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
