import { kafka, KAFKA_GROUP_ID, TOPICS } from "./lib.js";
import {
  getPool, closePool, ensureSchema,
  startCollectionRun, completeCollectionRun,
} from "shared-db";
import {
  handleGoogleSearch,
  handleYouTubeSearch,
  handleYouTubeIngredients,
  handleNaverIngredientPrices,
  handleNaverSearch,
} from "./handlers/index.js";
import type { EachMessagePayload } from "kafkajs";

const CONSUME_FROM_BEGINNING = process.env.CONSUME_FROM_BEGINNING !== "false";

async function main() {
  const pool = getPool();
  await ensureSchema(pool);

  const runId = await startCollectionRun(pool, {
    source: "kafka-consumer",
    collector: "kafka-consumer-all",
  });

  const allTopics = Object.values(TOPICS);
  const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });
  await consumer.connect();
  await consumer.subscribe({ topics: allTopics, fromBeginning: CONSUME_FROM_BEGINNING });

  let totalProcessed = 0;
  let errorCount = 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log("🔄 Kafka → MySQL Consumer 시작");
  console.log("=".repeat(60));
  console.log(`  토픽: ${allTopics.join(", ")}`);
  console.log(`  Consumer Group: ${KAFKA_GROUP_ID}`);
  console.log(`  처음부터 읽기: ${CONSUME_FROM_BEGINNING}`);
  console.log("=".repeat(60));

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n종료 중...");
    await consumer.disconnect();
    await completeCollectionRun(pool, runId, totalProcessed);
    await closePool();
    console.log(`\n${"=".repeat(60)}`);
    console.log("📊 Consumer 종료 요약");
    console.log("=".repeat(60));
    console.log(`  처리된 메시지: ${totalProcessed}건`);
    console.log(`  오류: ${errorCount}건`);
    console.log(`  run_id: ${runId}`);
    console.log("=".repeat(60));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      const { topic, partition, message } = payload;
      try {
        const value = JSON.parse(message.value?.toString() ?? "{}");
        const offset = message.offset ? parseInt(message.offset) : null;

        switch (topic) {
          case TOPICS.GOOGLE_SEARCH:
            await handleGoogleSearch(pool, value, runId, partition, offset);
            break;
          case TOPICS.YOUTUBE_SEARCH:
            await handleYouTubeSearch(pool, value, runId, partition, offset);
            break;
          case TOPICS.YOUTUBE_INGREDIENTS:
            await handleYouTubeIngredients(pool, value, runId, partition, offset);
            break;
          case TOPICS.NAVER_INGREDIENT_PRICES:
            await handleNaverIngredientPrices(pool, value, runId, partition, offset);
            break;
          case TOPICS.NAVER_SEARCH:
            await handleNaverSearch(pool, value, runId, partition, offset);
            break;
        }
        totalProcessed++;

        if (totalProcessed % 100 === 0) {
          console.log(`  [진행] ${totalProcessed}건 처리 완료`);
        }
      } catch (err) {
        errorCount++;
        console.error(
          `  [오류] topic=${topic} partition=${partition} offset=${message.offset}: ${(err as Error).message}`,
        );
      }
    },
  });
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
