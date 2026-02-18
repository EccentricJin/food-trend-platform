import { execSync } from "child_process";
import path from "path";

console.log("🚀 Google + YouTube + RSS 전체 수집 시작\n");

const projectRoot = path.resolve(__dirname, "..");

try {
  console.log("━".repeat(60));
  console.log("📌 [1/3] Google Custom Search 수집");
  console.log("━".repeat(60));
  execSync("npx tsx src/collect-google.ts", { stdio: "inherit", cwd: projectRoot });

  console.log("\n" + "━".repeat(60));
  console.log("📌 [2/3] YouTube Data API 수집");
  console.log("━".repeat(60));
  execSync("npx tsx src/collect-youtube.ts", { stdio: "inherit", cwd: projectRoot });

  console.log("\n" + "━".repeat(60));
  console.log("📌 [3/3] Google RSS News 수집");
  console.log("━".repeat(60));
  execSync("npx tsx src/collect-google-rss.ts", { stdio: "inherit", cwd: projectRoot });

  console.log("\n\n✅ 전체 수집 완료!");
} catch (e) {
  console.error("수집 중 오류 발생:", (e as Error).message);
  process.exit(1);
}
