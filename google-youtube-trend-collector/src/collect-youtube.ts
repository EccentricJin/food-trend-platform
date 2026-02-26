import {
  searchYouTube,
  getYouTubeVideoStats,
  sleep,
  oneWeekAgo,
} from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun, failCollectionRun,
  insertYouTubeSearchResultsBatch,
  type YouTubeSearchRow,
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
      "두바이 쫀득 쿠키 만들기",
      "두바이 쿠키 레시피",
      "dubai chocolate cookie",
    ],
  },
  {
    category: "유행디저트",
    keywords: [
      "2026 디저트 트렌드",
      "크럼블쿠키 만들기",
      "약과 만들기",
      "소금빵 레시피",
      "휘낭시에 만들기",
      "크루아상 레시피",
      "타르트 만들기",
      "마들렌 레시피",
      "까눌레 만들기",
      "스콘 레시피",
      "에그타르트 만들기",
      "티라미수 레시피",
    ],
  },
  {
    category: "유행음식",
    keywords: [
      "2026 음식 트렌드",
      "마라탕 먹방",
      "로제떡볶이 레시피",
      "제로음료 리뷰",
      "오마카세 브이로그",
    ],
  },
  {
    category: "유행카페",
    keywords: [
      "2026 카페 추천",
      "성수 카페 브이로그",
      "을지로 카페 투어",
      "카페 디저트 추천",
    ],
  },
  {
    category: "카페운영",
    keywords: [
      "카페 창업 브이로그",
      "카페 운영 일상",
      "카페 메뉴 개발",
      "카페 인테리어 꾸미기",
    ],
  },
  {
    category: "베이커리운영",
    keywords: [
      "빵집 창업 브이로그",
      "베이커리 운영",
      "제과 기술 배우기",
      "빵집 메뉴 개발",
    ],
  },
  {
    category: "원재료가격",
    keywords: [
      "밀가루 가격",
      "버터 가격 비교",
      "설탕 가격",
      "달걀 가격",
      "베이킹 재료 가격",
      "카카오 초콜릿 가격",
    ],
  },
];

async function main() {
  // MySQL 초기화
  const pool = getPool();
  await ensureSchema(pool);
  const runId = await startCollectionRun(pool, {
    source: "google-youtube-collector",
    collector: "collect-youtube",
  });

  let totalRecords = 0;
  const publishedAfter = oneWeekAgo();

  for (const { category, keywords } of queries) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📂 카테고리: ${category}`);
    console.log("=".repeat(60));

    for (const keyword of keywords) {
      try {
        // 최근 1주일, 최신순 25건
        const data = await searchYouTube(keyword, 25, "date", publishedAfter);
        const items = data.items || [];

        if (items.length === 0) {
          console.log(`  ⏭️  "${keyword}" - 결과 없음`);
          continue;
        }

        // 조회수/좋아요 통계 가져오기
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
          const requestedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
          const dbRows: YouTubeSearchRow[] = items.map((item) => {
            const videoId = item.id.videoId ?? "";
            const stats = statsMap[videoId];
            return {
              run_id: runId,
              category,
              keyword,
              requested_at: requestedAt,
              total_results: data.pageInfo.totalResults,
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
          await insertYouTubeSearchResultsBatch(pool, dbRows);
        } catch (dbErr) {
          console.log(`  [DB] 저장 실패: ${(dbErr as Error).message}`);
        }

        totalRecords += items.length;

        // 조회수 상위 3개 표시
        const topViewed = items
          .filter((i) => i.id.videoId && statsMap[i.id.videoId!])
          .sort((a, b) => {
            const aViews = parseInt(statsMap[a.id.videoId!]?.viewCount || "0");
            const bViews = parseInt(statsMap[b.id.videoId!]?.viewCount || "0");
            return bViews - aViews;
          })
          .slice(0, 3);

        console.log(
          `  ✅ "${keyword}" - ${items.length}건 수집 (전체 ${data.pageInfo.totalResults}건)`,
        );
        for (const v of topViewed) {
          const stats = statsMap[v.id.videoId!];
          console.log(
            `     🎬 ${v.snippet.title.substring(0, 45)}... (조회 ${parseInt(stats.viewCount).toLocaleString()})`,
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
  console.log("📊 YouTube 검색 수집 완료");
  console.log("=".repeat(60));
  console.log(`  총 수집: ${totalRecords}건`);
  console.log(`  수집 기간: ${publishedAfter.split("T")[0]} ~ 현재`);
  console.log(`  MySQL 저장: ✅ (run_id: ${runId})`);
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
