/**
 * 빵집/카페 원자재 가격 수집 → 주간 변동률 계산 → EC2 전송
 *
 * Phase 2: 네이버 쇼핑 API에서 실시간 가격 수집 후,
 *          주간 변동률/가격 알림을 계산하여 EC2 News API로 전송
 *
 * 수집 소스: 네이버 쇼핑 API (실시간 판매 가격)
 * 전송 대상: EC2 News API (POST /api/internal/news/articles/batch)
 *            + EC2 Prices API (POST /api/internal/prices/daily) — 준비 시 자동 전환
 *
 * 핵심 로직:
 *   weekly_change = (current_price - week_ago_price) / week_ago_price * 100
 *   if weekly_change > 5:  → 급등 알림
 *   if weekly_change < -5: → 급락 알림
 *
 * 실행: npx tsx src/sync-prices-to-ec2.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// .env 수동 로드
try {
  const envPath = resolve(__dirname, "..", ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env 없으면 환경변수에서 직접 읽음
}

// ── 설정 ──
const EC2_BASE_URL = process.env.EC2_NEWS_API_URL ?? "http://13.124.248.151";
const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? "";
const HISTORY_FILE = resolve(__dirname, "..", "price-history.json");

// ════════════════════════════════════════════════════════════════
// 1. 원자재 정의 (10종)
// ════════════════════════════════════════════════════════════════

interface IngredientDef {
  name: string;
  nameEn: string;
  icon: string;
  unit: string;
  naverKeywords: string[];
  /** 이 키워드들에서 수집한 가격의 대표값 산출 방식 */
  priceType: "median" | "min_p25"; // median: 중간값, min_p25: 하위 25% 평균
}

const INGREDIENTS: IngredientDef[] = [
  {
    name: "밀가루 (박력분)",
    nameEn: "Wheat Flour",
    icon: "🌾",
    unit: "1kg",
    naverKeywords: ["박력분 1kg"],
    priceType: "median",
  },
  {
    name: "설탕 (백설탕)",
    nameEn: "Sugar",
    icon: "🍬",
    unit: "1kg",
    naverKeywords: ["백설탕 1kg"],
    priceType: "median",
  },
  {
    name: "무염버터",
    nameEn: "Butter (Unsalted)",
    icon: "🧈",
    unit: "450g",
    naverKeywords: ["무염버터 450g"],
    priceType: "median",
  },
  {
    name: "계란 (특란)",
    nameEn: "Eggs",
    icon: "🥚",
    unit: "30구",
    naverKeywords: ["달걀 30구", "계란 30구"],
    priceType: "min_p25",
  },
  {
    name: "우유 (신선)",
    nameEn: "Milk",
    icon: "🥛",
    unit: "1L",
    naverKeywords: ["서울우유 1L"],
    priceType: "median",
  },
  {
    name: "생크림",
    nameEn: "Fresh Cream",
    icon: "🍦",
    unit: "1L",
    naverKeywords: ["동물성 생크림 1L"],
    priceType: "median",
  },
  {
    name: "커버춰 초콜릿",
    nameEn: "Couverture Chocolate",
    icon: "🍫",
    unit: "1kg",
    naverKeywords: ["커버춰 초콜릿 1kg"],
    priceType: "median",
  },
  {
    name: "커피 원두 (아라비카)",
    nameEn: "Coffee Beans",
    icon: "☕",
    unit: "1kg",
    naverKeywords: ["아라비카 원두 1kg"],
    priceType: "median",
  },
  {
    name: "바닐라 익스트랙트",
    nameEn: "Vanilla Extract",
    icon: "🌿",
    unit: "1병",
    naverKeywords: ["바닐라 익스트랙트"],
    priceType: "median",
  },
  {
    name: "아몬드",
    nameEn: "Almonds",
    icon: "🌰",
    unit: "1kg",
    naverKeywords: ["아몬드 1kg"],
    priceType: "median",
  },
];

// ════════════════════════════════════════════════════════════════
// 2. 타입 정의
// ════════════════════════════════════════════════════════════════

interface PriceSnapshot {
  date: string;           // YYYY-MM-DD
  collectedAt: string;    // ISO-8601
  ingredientName: string;
  unit: string;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  p25Price: number;       // 하위 25%
  productCount: number;
  representativePrice: number; // 대표 가격 (비교용)
}

interface PriceHistory {
  version: number;
  lastUpdated: string;
  snapshots: PriceSnapshot[];
}

interface WeeklyChange {
  ingredient: IngredientDef;
  currentPrice: number;
  weekAgoPrice: number | null;
  changeAmount: number | null;
  changePct: number | null;
  alertLevel: "급등" | "상승" | "보합" | "하락" | "급락" | "신규";
  snapshot: PriceSnapshot;
}

// ════════════════════════════════════════════════════════════════
// 3. 유틸리티
// ════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, "");
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile25(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.25));
  const subset = sorted.slice(0, cutoff);
  return Math.round(subset.reduce((a, b) => a + b, 0) / subset.length);
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ════════════════════════════════════════════════════════════════
// 4. 가격 이력 관리 (로컬 JSON 파일)
// ════════════════════════════════════════════════════════════════

function loadHistory(): PriceHistory {
  if (existsSync(HISTORY_FILE)) {
    try {
      const data = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
      return data as PriceHistory;
    } catch {
      // 파일 손상 시 초기화
    }
  }
  return { version: 1, lastUpdated: "", snapshots: [] };
}

function saveHistory(history: PriceHistory): void {
  history.lastUpdated = new Date().toISOString();
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

function getWeekAgoPrice(
  history: PriceHistory,
  ingredientName: string,
): number | null {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split("T")[0];

  // 7일 전 ±2일 범위에서 가장 가까운 스냅샷
  const candidates = history.snapshots
    .filter((s) => s.ingredientName === ingredientName)
    .filter((s) => {
      const d = new Date(s.date);
      const diff = Math.abs(d.getTime() - weekAgo.getTime());
      return diff <= 2 * 24 * 60 * 60 * 1000; // ±2일
    })
    .sort((a, b) => {
      const diffA = Math.abs(
        new Date(a.date).getTime() - weekAgo.getTime(),
      );
      const diffB = Math.abs(
        new Date(b.date).getTime() - weekAgo.getTime(),
      );
      return diffA - diffB;
    });

  return candidates.length > 0 ? candidates[0].representativePrice : null;
}

// ════════════════════════════════════════════════════════════════
// 5. 네이버 쇼핑 가격 수집
// ════════════════════════════════════════════════════════════════

interface NaverShopItem {
  title: string;
  link: string;
  lprice: string;
  hprice: string;
  mallName: string;
}

async function searchNaverShopping(
  query: string,
  display = 100,
): Promise<{ total: number; items: NaverShopItem[] }> {
  const url = new URL("https://openapi.naver.com/v1/search/shop.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", "sim");

  const res = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    throw new Error(`Naver API 오류 (${res.status})`);
  }

  const data = (await res.json()) as { total: number; items: NaverShopItem[] };
  return data;
}

async function collectPriceSnapshot(
  ing: IngredientDef,
): Promise<PriceSnapshot | null> {
  let allPrices: number[] = [];
  let totalProducts = 0;

  for (const keyword of ing.naverKeywords) {
    try {
      const data = await searchNaverShopping(keyword, 100);
      const prices = data.items
        .map((i) => parseInt(i.lprice || "0"))
        .filter((p) => p > 0);

      allPrices.push(...prices);
      totalProducts += data.total;
      await sleep(200);
    } catch (e) {
      console.log(`    [Naver] "${keyword}" 오류: ${(e as Error).message}`);
    }
  }

  if (allPrices.length === 0) return null;

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const avgPrice = Math.round(
    allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
  );
  const medianPrice = median(allPrices);
  const p25Price = percentile25(allPrices);

  const representativePrice =
    ing.priceType === "min_p25" ? p25Price : medianPrice;

  return {
    date: todayStr(),
    collectedAt: new Date().toISOString(),
    ingredientName: ing.name,
    unit: ing.unit,
    minPrice,
    maxPrice,
    avgPrice,
    medianPrice,
    p25Price,
    productCount: allPrices.length,
    representativePrice,
  };
}

// ════════════════════════════════════════════════════════════════
// 6. 주간 변동률 계산
// ════════════════════════════════════════════════════════════════

function calculateWeeklyChange(
  ing: IngredientDef,
  snapshot: PriceSnapshot,
  history: PriceHistory,
): WeeklyChange {
  const currentPrice = snapshot.representativePrice;
  const weekAgoPrice = getWeekAgoPrice(history, ing.name);

  if (weekAgoPrice === null) {
    return {
      ingredient: ing,
      currentPrice,
      weekAgoPrice: null,
      changeAmount: null,
      changePct: null,
      alertLevel: "신규",
      snapshot,
    };
  }

  const changeAmount = currentPrice - weekAgoPrice;
  const changePct = (changeAmount / weekAgoPrice) * 100;

  let alertLevel: WeeklyChange["alertLevel"];
  if (changePct > 5) alertLevel = "급등";
  else if (changePct > 2) alertLevel = "상승";
  else if (changePct < -5) alertLevel = "급락";
  else if (changePct < -2) alertLevel = "하락";
  else alertLevel = "보합";

  return {
    ingredient: ing,
    currentPrice,
    weekAgoPrice,
    changeAmount,
    changePct,
    alertLevel,
    snapshot,
  };
}

// ════════════════════════════════════════════════════════════════
// 7. EC2 전송
// ════════════════════════════════════════════════════════════════

interface PriceDailyPayload {
  ingredientName: string;
  ingredientNameEn: string;
  unit: string;
  date: string;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  representativePrice: number;
  productCount: number;
  weeklyChangePct: number | null;
  weeklyChangeAmount: number | null;
  alertLevel: string;
  source: string;
}

async function tryPricesApi(
  payload: PriceDailyPayload[],
): Promise<boolean> {
  try {
    const res = await fetch(
      `${EC2_BASE_URL}/api/internal/prices/daily`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      },
    );

    if (res.ok) {
      const result = await res.json();
      console.log(
        `  ✅ Prices API 전송 성공: ${JSON.stringify(result)}`,
      );
      return true;
    }

    // 500 등 서버 오류 → fallback
    return false;
  } catch {
    return false;
  }
}

interface NewsArticle {
  title: string;
  url: string;
  source: string | null;
  publisher: string | null;
  summary: string | null;
  publishedAt: string | null;
}

interface BatchResponse {
  total: number;
  created: number;
  updated: number;
  results: Array<{ newsId: number; created: boolean }>;
}

async function sendToNewsApi(articles: NewsArticle[]): Promise<BatchResponse> {
  const res = await fetch(
    `${EC2_BASE_URL}/api/internal/news/articles/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: articles }),
    },
  );

  if (!res.ok) {
    throw new Error(`News API 오류 (${res.status}): ${await res.text()}`);
  }

  return res.json() as Promise<BatchResponse>;
}

function buildPriceAlertArticle(change: WeeklyChange): NewsArticle {
  const { ingredient: ing, currentPrice, weekAgoPrice, changePct, alertLevel, snapshot } = change;
  const date = snapshot.date;
  const pctStr = changePct !== null ? (changePct >= 0 ? `+${changePct.toFixed(1)}%` : `${changePct.toFixed(1)}%`) : "N/A";

  let title: string;
  let summary: string;

  if (alertLevel === "신규") {
    title = `[가격수집] ${ing.icon} ${ing.name} ${formatNumber(currentPrice)}원 (${ing.unit}, ${date})`;
    summary =
      `${ing.name} 네이버 쇼핑 대표가격 ${formatNumber(currentPrice)}원 ` +
      `(최저 ${formatNumber(snapshot.minPrice)}원, 평균 ${formatNumber(snapshot.avgPrice)}원, ` +
      `최고 ${formatNumber(snapshot.maxPrice)}원). ` +
      `${snapshot.productCount}개 상품 기준. 첫 수집이므로 주간 변동률 없음.`;
  } else {
    const direction = changePct! >= 0 ? "상승" : "하락";
    const emoji =
      alertLevel === "급등" ? "🔴" :
      alertLevel === "상승" ? "🟠" :
      alertLevel === "급락" ? "🟢" :
      alertLevel === "하락" ? "🔵" : "⚪";

    title =
      `${emoji} [${alertLevel}] ${ing.icon} ${ing.name} 주간 ${pctStr} ` +
      `(${formatNumber(weekAgoPrice!)}→${formatNumber(currentPrice)}원)`;
    summary =
      `${ing.name} (${ing.unit}) 주간 변동: ${formatNumber(weekAgoPrice!)}원 → ${formatNumber(currentPrice)}원 ` +
      `(${direction} ${Math.abs(changePct!).toFixed(1)}%, ${changePct! >= 0 ? "+" : ""}${formatNumber(change.changeAmount!)}원). ` +
      `네이버 쇼핑 ${snapshot.productCount}개 상품 기준. ` +
      `최저 ${formatNumber(snapshot.minPrice)}원 / 평균 ${formatNumber(snapshot.avgPrice)}원 / ` +
      `최고 ${formatNumber(snapshot.maxPrice)}원.`;
  }

  // URL: 고유한 가격 리포트 URL 생성 (날짜 + 원자재)
  const slug = ing.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = `https://price-alert.breadalert.com/daily/${date}/${slug}`;

  return {
    title,
    url,
    source: "naver_shopping_price",
    publisher: "BreadAlert 가격 모니터",
    summary,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
  };
}

// ════════════════════════════════════════════════════════════════
// 8. 출력 포맷
// ════════════════════════════════════════════════════════════════

function printReport(changes: WeeklyChange[]): void {
  console.log();
  console.log("─".repeat(70));
  console.log("  주간 가격 변동 리포트");
  console.log("─".repeat(70));

  // 헤더
  const hdr =
    "  " +
    "원자재".padEnd(20) +
    "현재가".padStart(12) +
    "1주전".padStart(12) +
    "변동".padStart(12) +
    "등급".padStart(8);
  console.log(hdr);
  console.log("  " + "─".repeat(66));

  // 급등/급락 먼저
  const sorted = [...changes].sort((a, b) => {
    const order = { "급등": 0, "급락": 1, "상승": 2, "하락": 3, "보합": 4, "신규": 5 };
    return (order[a.alertLevel] ?? 9) - (order[b.alertLevel] ?? 9);
  });

  for (const c of sorted) {
    const emoji =
      c.alertLevel === "급등" ? "🔴" :
      c.alertLevel === "상승" ? "🟠" :
      c.alertLevel === "급락" ? "🟢" :
      c.alertLevel === "하락" ? "🔵" :
      c.alertLevel === "보합" ? "⚪" : "🆕";

    const name = `${c.ingredient.icon} ${c.ingredient.name}`;
    const current = `${formatNumber(c.currentPrice)}원`;
    const weekAgo =
      c.weekAgoPrice !== null ? `${formatNumber(c.weekAgoPrice)}원` : "-";
    const change =
      c.changePct !== null
        ? `${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(1)}%`
        : "신규";

    console.log(
      `  ${name.padEnd(20)}${current.padStart(12)}${weekAgo.padStart(12)}${change.padStart(12)}  ${emoji} ${c.alertLevel}`,
    );
  }

  // 알림 대상 요약
  const alerts = changes.filter(
    (c) => c.alertLevel === "급등" || c.alertLevel === "급락",
  );

  if (alerts.length > 0) {
    console.log();
    console.log("  ⚠️ 사장님 알림:");
    for (const a of alerts) {
      const dir = a.changePct! > 0 ? "↑ 급등" : "↓ 급락";
      console.log(
        `    ${a.ingredient.icon} ${a.ingredient.name}: 주간 ${Math.abs(a.changePct!).toFixed(1)}% ${dir}! ` +
          `(${formatNumber(a.weekAgoPrice!)}→${formatNumber(a.currentPrice)}원)`,
      );
    }
  } else {
    console.log();
    console.log("  ✅ 주간 5% 이상 급변동 원자재 없음");
  }
}

// ════════════════════════════════════════════════════════════════
// 9. 메인 실행
// ════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timeStr = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  console.log();
  console.log("=".repeat(70));
  console.log("  빵집/카페 원자재 가격 수집 & 주간 변동률 → EC2 전송");
  console.log("=".repeat(70));
  console.log(`  실행 시각: ${dateStr} ${timeStr}`);
  console.log(`  EC2 대상: ${EC2_BASE_URL}`);
  console.log(`  원자재: ${INGREDIENTS.length}종`);
  console.log(`  이력 파일: ${HISTORY_FILE}`);
  console.log("=".repeat(70));

  // ── 이력 로드 ──
  const history = loadHistory();
  console.log(
    `\n  기존 이력: ${history.snapshots.length}건 (${history.lastUpdated || "없음"})`,
  );

  // ── 가격 수집 ──
  console.log("\n[1] 네이버 쇼핑 가격 수집");
  console.log("─".repeat(70));

  const changes: WeeklyChange[] = [];

  for (let i = 0; i < INGREDIENTS.length; i++) {
    const ing = INGREDIENTS[i];
    console.log(`  [${i + 1}/${INGREDIENTS.length}] ${ing.icon} ${ing.name}`);

    const snapshot = await collectPriceSnapshot(ing);

    if (!snapshot) {
      console.log(`    ❌ 가격 수집 실패`);
      continue;
    }

    console.log(
      `    대표가 ${formatNumber(snapshot.representativePrice)}원 ` +
        `(최저 ${formatNumber(snapshot.minPrice)} / 중간 ${formatNumber(snapshot.medianPrice)} / ` +
        `최고 ${formatNumber(snapshot.maxPrice)}) [${snapshot.productCount}건]`,
    );

    // 주간 변동률 계산
    const change = calculateWeeklyChange(ing, snapshot, history);
    changes.push(change);

    if (change.changePct !== null) {
      const pctStr = change.changePct >= 0
        ? `+${change.changePct.toFixed(1)}%`
        : `${change.changePct.toFixed(1)}%`;
      console.log(
        `    주간 변동: ${pctStr} (${formatNumber(change.weekAgoPrice!)}→${formatNumber(change.currentPrice)}원) [${change.alertLevel}]`,
      );
    } else {
      console.log(`    주간 변동: 첫 수집 (비교 대상 없음)`);
    }

    // 이력에 오늘 스냅샷 추가 (같은 날짜+원자재는 교체)
    const existingIdx = history.snapshots.findIndex(
      (s) => s.date === snapshot.date && s.ingredientName === snapshot.ingredientName,
    );
    if (existingIdx >= 0) {
      history.snapshots[existingIdx] = snapshot;
    } else {
      history.snapshots.push(snapshot);
    }
  }

  // ── 이력 저장 ──
  // 90일 이상 된 데이터 정리
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  history.snapshots = history.snapshots.filter((s) => s.date >= cutoffStr);
  saveHistory(history);
  console.log(`\n  이력 저장 완료: ${history.snapshots.length}건`);

  // ── 주간 변동 리포트 ──
  printReport(changes);

  // ── EC2 전송 ──
  console.log("\n[2] EC2 전송");
  console.log("─".repeat(70));

  // Phase 2-A: Prices API 시도
  const pricePayloads: PriceDailyPayload[] = changes.map((c) => ({
    ingredientName: c.ingredient.name,
    ingredientNameEn: c.ingredient.nameEn,
    unit: c.ingredient.unit,
    date: c.snapshot.date,
    minPrice: c.snapshot.minPrice,
    maxPrice: c.snapshot.maxPrice,
    avgPrice: c.snapshot.avgPrice,
    medianPrice: c.snapshot.medianPrice,
    representativePrice: c.snapshot.representativePrice,
    productCount: c.snapshot.productCount,
    weeklyChangePct: c.changePct,
    weeklyChangeAmount: c.changeAmount,
    alertLevel: c.alertLevel,
    source: "naver_shopping",
  }));

  console.log("  [2-A] Prices API 시도...");
  const pricesApiOk = await tryPricesApi(pricePayloads);

  if (!pricesApiOk) {
    console.log("  ⚠️ Prices API 미사용 (500/미구현) → News API fallback");
  }

  // Phase 2-B: News API로 가격 알림 전송
  console.log("  [2-B] News API로 가격 알림 전송...");

  const newsArticles: NewsArticle[] = changes.map(buildPriceAlertArticle);

  try {
    const result = await sendToNewsApi(newsArticles);
    console.log(
      `  ✅ News API 전송 완료: ${result.total}건 (생성 ${result.created} / 갱신 ${result.updated})`,
    );
  } catch (e) {
    console.log(`  ❌ News API 전송 실패: ${(e as Error).message}`);
  }

  // ── JSON 출력 (알림 서비스용) ──
  console.log("\n--- PRICE_ALERT_JSON_START ---");
  const alertJson = {
    reportType: "daily-price-alert",
    date: todayStr(),
    generatedAt: new Date().toISOString(),
    ec2Target: EC2_BASE_URL,
    pricesApiAvailable: pricesApiOk,
    ingredientCount: changes.length,
    alerts: changes
      .filter((c) => c.alertLevel === "급등" || c.alertLevel === "급락")
      .map((c) => ({
        name: c.ingredient.name,
        nameEn: c.ingredient.nameEn,
        currentPrice: c.currentPrice,
        weekAgoPrice: c.weekAgoPrice,
        changePct: c.changePct,
        alertLevel: c.alertLevel,
      })),
    prices: changes.map((c) => ({
      name: c.ingredient.name,
      nameEn: c.ingredient.nameEn,
      unit: c.ingredient.unit,
      currentPrice: c.currentPrice,
      weekAgoPrice: c.weekAgoPrice,
      changePct: c.changePct !== null ? Number(c.changePct.toFixed(2)) : null,
      alertLevel: c.alertLevel,
      min: c.snapshot.minPrice,
      max: c.snapshot.maxPrice,
      avg: c.snapshot.avgPrice,
      median: c.snapshot.medianPrice,
      productCount: c.snapshot.productCount,
    })),
  };
  console.log(JSON.stringify(alertJson, null, 2));
  console.log("--- PRICE_ALERT_JSON_END ---");

  // ── 최종 요약 ──
  console.log("\n" + "=".repeat(70));
  console.log("  완료 요약");
  console.log("=".repeat(70));
  console.log(`  수집: ${changes.length}종 원자재`);
  console.log(`  급등 (>5%): ${changes.filter((c) => c.alertLevel === "급등").length}건`);
  console.log(`  급락 (<-5%): ${changes.filter((c) => c.alertLevel === "급락").length}건`);
  console.log(`  Prices API: ${pricesApiOk ? "✅ 전송됨" : "⚠️ 미사용 (fallback)"}`);
  console.log(`  News API: ✅ ${changes.length}건 전송`);
  console.log(`  이력 파일: ${HISTORY_FILE}`);
  console.log("=".repeat(70));
  console.log();
}

main().catch((e) => {
  console.error("치명적 오류:", (e as Error).message);
  process.exit(1);
});
