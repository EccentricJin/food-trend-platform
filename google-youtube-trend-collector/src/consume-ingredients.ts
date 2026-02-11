import { kafka, YOUTUBE_INGREDIENTS_TOPIC, KAFKA_GROUP_ID } from "./lib.js";

interface VideoInfo {
  title: string;
  channelTitle: string;
  viewCount: number;
  videoId: string;
  publishedAt: string;
}

interface IngredientStats {
  total: number;
  keywords: Record<string, number>;
  topVideos: VideoInfo[];
}

async function main() {
  // 토픽 존재 확인
  const admin = kafka.admin();
  await admin.connect();
  const existingTopics = await admin.listTopics();
  await admin.disconnect();

  if (!existingTopics.includes(YOUTUBE_INGREDIENTS_TOPIC)) {
    console.log("⚠️  재료 가격 토픽이 없습니다. 먼저 collect-ingredients를 실행해주세요.");
    return;
  }

  const consumer = kafka.consumer({ groupId: `${KAFKA_GROUP_ID}-ingredients-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({
    topics: [YOUTUBE_INGREDIENTS_TOPIC],
    fromBeginning: true,
  });

  const stats: Record<string, IngredientStats> = {};

  let resolve: () => void;
  const done = new Promise<void>((r) => { resolve = r; });
  const timeout = setTimeout(() => resolve(), 20000);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const val = JSON.parse(message.value?.toString() ?? "{}");
        const ingredient = val.ingredient || "unknown";
        const keyword = val.keyword || "unknown";

        if (!stats[ingredient]) {
          stats[ingredient] = { total: 0, keywords: {}, topVideos: [] };
        }

        stats[ingredient].total++;
        stats[ingredient].keywords[keyword] = (stats[ingredient].keywords[keyword] || 0) + 1;

        if (val.video) {
          stats[ingredient].topVideos.push({
            title: val.video.title,
            channelTitle: val.video.channelTitle,
            viewCount: val.statistics?.viewCount ?? 0,
            videoId: val.video.videoId,
            publishedAt: val.video.publishedAt,
          });
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
  console.log(`\n${"=".repeat(65)}`);
  console.log("🍪 두바이 쫀득 쿠키 재료별 가격 정보 (YouTube 기반)");
  console.log("=".repeat(65));

  const sortedIngredients = Object.entries(stats).sort((a, b) => b[1].total - a[1].total);
  let grandTotal = 0;

  for (const [ingredient, data] of sortedIngredients) {
    grandTotal += data.total;
    console.log(`\n── 🧂 ${ingredient} (${data.total}건) ──`);

    // 키워드별
    console.log("  키워드별:");
    for (const [kw, cnt] of Object.entries(data.keywords).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${kw}: ${cnt}건`);
    }

    // 조회수 상위 3개 영상
    const topVideos = data.topVideos
      .sort((a, b) => b.viewCount - a.viewCount)
      .filter((v, i, arr) => arr.findIndex((x) => x.videoId === v.videoId) === i) // 중복 제거
      .slice(0, 3);

    if (topVideos.length > 0) {
      console.log("  인기 영상:");
      topVideos.forEach((v, i) => {
        const date = v.publishedAt ? v.publishedAt.split("T")[0] : "N/A";
        console.log(
          `    ${i + 1}. [${v.viewCount.toLocaleString()}회] ${v.title.substring(0, 50)}`,
        );
        console.log(
          `       📺 ${v.channelTitle} | ${date} | https://youtube.com/watch?v=${v.videoId}`,
        );
      });
    }
  }

  console.log(`\n${"=".repeat(65)}`);
  console.log(`📊 총 수집: ${grandTotal}건 | 재료: ${sortedIngredients.length}종`);
  console.log("=".repeat(65));
}

main().catch((e) => {
  console.error("오류:", (e as Error).message);
  process.exit(1);
});
