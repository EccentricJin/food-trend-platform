import "dotenv/config";
import {
  getPool, closePool,
} from "shared-db";
import fs from "fs";
import path from "path";

const outDir = path.resolve(__dirname, "../../collected-data");

async function exportTable(pool: any, name: string, query: string) {
  const [rows] = await pool.execute(query);
  const arr = rows as any[];
  const filePath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf-8");
  console.log(`✅ ${name}: ${arr.length}건 → ${path.basename(filePath)}`);
  return arr.length;
}

async function main() {
  const pool = getPool();
  console.log("📦 데이터 내보내기 시작\n");
  let total = 0;

  total += await exportTable(pool, "youtube_search_results",
    "SELECT * FROM youtube_search_results ORDER BY created_at DESC");

  total += await exportTable(pool, "google_rss_news",
    "SELECT * FROM google_rss_news ORDER BY created_at DESC");

  total += await exportTable(pool, "naver_search_results",
    "SELECT id, run_id, msg_type, category, keyword, search_type, requested_at, total_available, item_title, item_link, created_at FROM naver_search_results ORDER BY created_at DESC");

  total += await exportTable(pool, "naver_ingredient_search_results",
    "SELECT id, run_id, msg_type, category, ingredient, keyword, search_type, requested_at, price_stats_min, price_stats_max, price_stats_avg, price_stats_count, item_title, item_link, created_at FROM naver_ingredient_search_results ORDER BY created_at DESC");

  total += await exportTable(pool, "collection_runs",
    "SELECT * FROM collection_runs ORDER BY started_at DESC");

  console.log(`\n📊 총 ${total}건 내보내기 완료`);
  await closePool();
}

main().catch(e => { console.error(e); process.exit(1); });
