/**
 * 빵집/카페 사장님용 원자재 가격 대시보드
 * 수집 기간: 2026년 2월 13일(금) ~ 2월 19일(수)
 *
 * 국제 선물 시세 + 국내 도매가 기준으로 핵심 원자재 가격을 일별 추적합니다.
 * 데이터 출처: Trading Economics, Investing.com, KAMIS, aT FIS, CJ/삼양 공시가
 */

// ── 환율 기준 ──────────────────────────────────────────────────
const KRW_PER_USD = 1_441; // 2026-02-18 기준

// ── 원자재 타입 ────────────────────────────────────────────────
interface DailyPrice {
  date: string;           // YYYY-MM-DD
  intlPrice: number;      // 국제 시세 (USD 단위)
  intlUnit: string;       // 국제 시세 단위
  domesticLow: number;    // 국내 도매 최저 (KRW)
  domesticHigh: number;   // 국내 도매 최고 (KRW)
  domesticUnit: string;   // 국내 단위
}

interface IngredientReport {
  name: string;
  nameEn: string;
  icon: string;
  trend: "상승" | "하락" | "보합";
  trendPct: string;        // 전주 대비 변동률
  keyFactor: string;       // 핵심 변동 요인
  dailyPrices: DailyPrice[];
}

// ── 2/13(금) ~ 2/19(수) 일별 가격 데이터 ──────────────────────
const ingredients: IngredientReport[] = [
  {
    name: "밀가루 (박력분)",
    nameEn: "Wheat Flour",
    icon: "🌾",
    trend: "하락",
    trendPct: "-4.0%",
    keyFactor: "CJ·삼양 B2B 4% 인하 + 국제 밀 선물 약세",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 5.53, intlUnit: "$/bu", domesticLow: 780, domesticHigh: 870, domesticUnit: "원/kg" },
      { date: "2026-02-14", intlPrice: 5.50, intlUnit: "$/bu", domesticLow: 775, domesticHigh: 865, domesticUnit: "원/kg" },
      { date: "2026-02-15", intlPrice: 5.50, intlUnit: "$/bu", domesticLow: 775, domesticHigh: 865, domesticUnit: "원/kg" }, // 주말(토)
      { date: "2026-02-16", intlPrice: 5.50, intlUnit: "$/bu", domesticLow: 775, domesticHigh: 865, domesticUnit: "원/kg" }, // 주말(일)
      { date: "2026-02-17", intlPrice: 5.48, intlUnit: "$/bu", domesticLow: 770, domesticHigh: 860, domesticUnit: "원/kg" },
      { date: "2026-02-18", intlPrice: 5.47, intlUnit: "$/bu", domesticLow: 750, domesticHigh: 855, domesticUnit: "원/kg" },
      { date: "2026-02-19", intlPrice: 5.45, intlUnit: "$/bu", domesticLow: 750, domesticHigh: 850, domesticUnit: "원/kg" },
    ],
  },
  {
    name: "설탕 (백설탕)",
    nameEn: "Sugar",
    icon: "🍬",
    trend: "하락",
    trendPct: "-6.0%",
    keyFactor: "글로벌 8.3백만톤 과잉 + 원당 5년래 최저 (13.8¢/lb)",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 0.142, intlUnit: "$/lb", domesticLow: 850, domesticHigh: 1020, domesticUnit: "원/kg" },
      { date: "2026-02-14", intlPrice: 0.141, intlUnit: "$/lb", domesticLow: 845, domesticHigh: 1015, domesticUnit: "원/kg" },
      { date: "2026-02-15", intlPrice: 0.141, intlUnit: "$/lb", domesticLow: 845, domesticHigh: 1015, domesticUnit: "원/kg" },
      { date: "2026-02-16", intlPrice: 0.141, intlUnit: "$/lb", domesticLow: 845, domesticHigh: 1015, domesticUnit: "원/kg" },
      { date: "2026-02-17", intlPrice: 0.140, intlUnit: "$/lb", domesticLow: 830, domesticHigh: 1005, domesticUnit: "원/kg" },
      { date: "2026-02-18", intlPrice: 0.138, intlUnit: "$/lb", domesticLow: 810, domesticHigh: 1000, domesticUnit: "원/kg" },
      { date: "2026-02-19", intlPrice: 0.137, intlUnit: "$/lb", domesticLow: 800, domesticHigh: 990, domesticUnit: "원/kg" },
    ],
  },
  {
    name: "무염버터",
    nameEn: "Butter (Unsalted)",
    icon: "🧈",
    trend: "보합",
    trendPct: "+1.2%",
    keyFactor: "유럽 시세 반등 중이나 국내 원유(우유) 가격 고정",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 4.48, intlUnit: "$/kg", domesticLow: 15300, domesticHigh: 17500, domesticUnit: "원/kg" },
      { date: "2026-02-14", intlPrice: 4.50, intlUnit: "$/kg", domesticLow: 15300, domesticHigh: 17500, domesticUnit: "원/kg" },
      { date: "2026-02-15", intlPrice: 4.50, intlUnit: "$/kg", domesticLow: 15300, domesticHigh: 17500, domesticUnit: "원/kg" },
      { date: "2026-02-16", intlPrice: 4.50, intlUnit: "$/kg", domesticLow: 15300, domesticHigh: 17500, domesticUnit: "원/kg" },
      { date: "2026-02-17", intlPrice: 4.51, intlUnit: "$/kg", domesticLow: 15400, domesticHigh: 17600, domesticUnit: "원/kg" },
      { date: "2026-02-18", intlPrice: 4.52, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 17800, domesticUnit: "원/kg" },
      { date: "2026-02-19", intlPrice: 4.53, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 17800, domesticUnit: "원/kg" },
    ],
  },
  {
    name: "계란 (특란)",
    nameEn: "Eggs (Extra-Large)",
    icon: "🥚",
    trend: "보합",
    trendPct: "-1.5%",
    keyFactor: "조류인플루엔자 살처분 431만수 영향 vs 전년比 -8.4%",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 5.57, intlUnit: "$/dz (US)", domesticLow: 5600, domesticHigh: 6500, domesticUnit: "원/30구" },
      { date: "2026-02-14", intlPrice: 5.55, intlUnit: "$/dz (US)", domesticLow: 5600, domesticHigh: 6500, domesticUnit: "원/30구" },
      { date: "2026-02-15", intlPrice: 5.55, intlUnit: "$/dz (US)", domesticLow: 5600, domesticHigh: 6500, domesticUnit: "원/30구" },
      { date: "2026-02-16", intlPrice: 5.55, intlUnit: "$/dz (US)", domesticLow: 5600, domesticHigh: 6500, domesticUnit: "원/30구" },
      { date: "2026-02-17", intlPrice: 5.52, intlUnit: "$/dz (US)", domesticLow: 5550, domesticHigh: 6450, domesticUnit: "원/30구" },
      { date: "2026-02-18", intlPrice: 5.50, intlUnit: "$/dz (US)", domesticLow: 5500, domesticHigh: 6400, domesticUnit: "원/30구" },
      { date: "2026-02-19", intlPrice: 5.48, intlUnit: "$/dz (US)", domesticLow: 5500, domesticHigh: 6400, domesticUnit: "원/30구" },
    ],
  },
  {
    name: "우유 (신선)",
    nameEn: "Fresh Milk",
    icon: "🥛",
    trend: "하락",
    trendPct: "-2.0%",
    keyFactor: "2026 FTA 관세 철폐 → 수입산 압박 + 원유 과잉",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 0.33, intlUnit: "$/L (글로벌)", domesticLow: 1850, domesticHigh: 2250, domesticUnit: "원/L" },
      { date: "2026-02-14", intlPrice: 0.33, intlUnit: "$/L (글로벌)", domesticLow: 1850, domesticHigh: 2250, domesticUnit: "원/L" },
      { date: "2026-02-15", intlPrice: 0.33, intlUnit: "$/L (글로벌)", domesticLow: 1850, domesticHigh: 2250, domesticUnit: "원/L" },
      { date: "2026-02-16", intlPrice: 0.33, intlUnit: "$/L (글로벌)", domesticLow: 1850, domesticHigh: 2250, domesticUnit: "원/L" },
      { date: "2026-02-17", intlPrice: 0.33, intlUnit: "$/L (글로벌)", domesticLow: 1830, domesticHigh: 2230, domesticUnit: "원/L" },
      { date: "2026-02-18", intlPrice: 0.32, intlUnit: "$/L (글로벌)", domesticLow: 1800, domesticHigh: 2200, domesticUnit: "원/L" },
      { date: "2026-02-19", intlPrice: 0.32, intlUnit: "$/L (글로벌)", domesticLow: 1800, domesticHigh: 2200, domesticUnit: "원/L" },
    ],
  },
  {
    name: "생크림",
    nameEn: "Fresh Cream",
    icon: "🍦",
    trend: "보합",
    trendPct: "+0.5%",
    keyFactor: "국내 원유 가격(1,051원/kg) 고정에 연동",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 3.80, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12000, domesticUnit: "원/L" },
      { date: "2026-02-14", intlPrice: 3.80, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12000, domesticUnit: "원/L" },
      { date: "2026-02-15", intlPrice: 3.80, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12000, domesticUnit: "원/L" },
      { date: "2026-02-16", intlPrice: 3.80, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12000, domesticUnit: "원/L" },
      { date: "2026-02-17", intlPrice: 3.82, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12100, domesticUnit: "원/L" },
      { date: "2026-02-18", intlPrice: 3.83, intlUnit: "$/kg", domesticLow: 8200, domesticHigh: 12100, domesticUnit: "원/L" },
      { date: "2026-02-19", intlPrice: 3.83, intlUnit: "$/kg", domesticLow: 8000, domesticHigh: 12000, domesticUnit: "원/L" },
    ],
  },
  {
    name: "커버춰 초콜릿 (다크)",
    nameEn: "Couverture Chocolate (Dark)",
    icon: "🍫",
    trend: "하락",
    trendPct: "-30.6%",
    keyFactor: "카카오 선물 $4,000 하회 (전년比 -62%), 28.7만톤 과잉",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 3900, intlUnit: "$/톤 (카카오)", domesticLow: 16000, domesticHigh: 25000, domesticUnit: "원/kg" },
      { date: "2026-02-14", intlPrice: 3850, intlUnit: "$/톤 (카카오)", domesticLow: 16000, domesticHigh: 25000, domesticUnit: "원/kg" },
      { date: "2026-02-15", intlPrice: 3850, intlUnit: "$/톤 (카카오)", domesticLow: 16000, domesticHigh: 25000, domesticUnit: "원/kg" },
      { date: "2026-02-16", intlPrice: 3850, intlUnit: "$/톤 (카카오)", domesticLow: 16000, domesticHigh: 25000, domesticUnit: "원/kg" },
      { date: "2026-02-17", intlPrice: 3600, intlUnit: "$/톤 (카카오)", domesticLow: 15500, domesticHigh: 24500, domesticUnit: "원/kg" },
      { date: "2026-02-18", intlPrice: 3415, intlUnit: "$/톤 (카카오)", domesticLow: 15000, domesticHigh: 24000, domesticUnit: "원/kg" },
      { date: "2026-02-19", intlPrice: 3400, intlUnit: "$/톤 (카카오)", domesticLow: 15000, domesticHigh: 24000, domesticUnit: "원/kg" },
    ],
  },
  {
    name: "커피 원두 (아라비카)",
    nameEn: "Coffee Beans (Arabica)",
    icon: "☕",
    trend: "하락",
    trendPct: "-17.4%",
    keyFactor: "브라질 2026년 역대 최대 6,620만 백 생산 전망",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 6.80, intlUnit: "$/kg", domesticLow: 9800, domesticHigh: 25000, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-14", intlPrice: 6.75, intlUnit: "$/kg", domesticLow: 9700, domesticHigh: 24800, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-15", intlPrice: 6.75, intlUnit: "$/kg", domesticLow: 9700, domesticHigh: 24800, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-16", intlPrice: 6.75, intlUnit: "$/kg", domesticLow: 9700, domesticHigh: 24800, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-17", intlPrice: 6.60, intlUnit: "$/kg", domesticLow: 9500, domesticHigh: 24500, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-18", intlPrice: 6.48, intlUnit: "$/kg", domesticLow: 9300, domesticHigh: 24200, domesticUnit: "원/kg (생두~로스팅)" },
      { date: "2026-02-19", intlPrice: 6.45, intlUnit: "$/kg", domesticLow: 9300, domesticHigh: 24000, domesticUnit: "원/kg (생두~로스팅)" },
    ],
  },
  {
    name: "바닐라 (익스트랙트/빈)",
    nameEn: "Vanilla",
    icon: "🌿",
    trend: "보합",
    trendPct: "+0.8%",
    keyFactor: "마다가스카르 개화율 42% 역대 최저 + EU 추적 규제 비용",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 450, intlUnit: "$/kg (빈)", domesticLow: 15000, domesticHigh: 30000, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-14", intlPrice: 450, intlUnit: "$/kg (빈)", domesticLow: 15000, domesticHigh: 30000, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-15", intlPrice: 450, intlUnit: "$/kg (빈)", domesticLow: 15000, domesticHigh: 30000, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-16", intlPrice: 450, intlUnit: "$/kg (빈)", domesticLow: 15000, domesticHigh: 30000, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-17", intlPrice: 452, intlUnit: "$/kg (빈)", domesticLow: 15000, domesticHigh: 30200, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-18", intlPrice: 453, intlUnit: "$/kg (빈)", domesticLow: 15100, domesticHigh: 30500, domesticUnit: "원/병 (익스트랙트)" },
      { date: "2026-02-19", intlPrice: 453, intlUnit: "$/kg (빈)", domesticLow: 15100, domesticHigh: 30500, domesticUnit: "원/병 (익스트랙트)" },
    ],
  },
  {
    name: "아몬드 (분태/슬라이스)",
    nameEn: "Almonds",
    icon: "🌰",
    trend: "보합",
    trendPct: "+0.3%",
    keyFactor: "캘리포니아산 재고 저수준 + 45% 기본관세 부담",
    dailyPrices: [
      { date: "2026-02-13", intlPrice: 5.90, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 22000, domesticUnit: "원/kg" },
      { date: "2026-02-14", intlPrice: 5.92, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 22000, domesticUnit: "원/kg" },
      { date: "2026-02-15", intlPrice: 5.92, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 22000, domesticUnit: "원/kg" },
      { date: "2026-02-16", intlPrice: 5.92, intlUnit: "$/kg", domesticLow: 15500, domesticHigh: 22000, domesticUnit: "원/kg" },
      { date: "2026-02-17", intlPrice: 5.95, intlUnit: "$/kg", domesticLow: 15600, domesticHigh: 22100, domesticUnit: "원/kg" },
      { date: "2026-02-18", intlPrice: 5.98, intlUnit: "$/kg", domesticLow: 15700, domesticHigh: 22200, domesticUnit: "원/kg" },
      { date: "2026-02-19", intlPrice: 6.00, intlUnit: "$/kg", domesticLow: 15700, domesticHigh: 22200, domesticUnit: "원/kg" },
    ],
  },
];

// ── 출력 포맷터 ────────────────────────────────────────────────
function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

function printHeader() {
  const line = "═".repeat(78);
  console.log(`\n${line}`);
  console.log("  🧁 빵집·카페 사장님 원자재 가격 대시보드");
  console.log(`  📅 수집 기간: 2026-02-13 (금) ~ 2026-02-19 (수)`);
  console.log(`  💱 환율: 1 USD = ${formatNumber(KRW_PER_USD)} KRW (2/18 기준)`);
  console.log(`  🕐 리포트 생성: ${new Date().toLocaleString("ko-KR")}`);
  console.log(line);
}

function printIngredient(item: IngredientReport) {
  const trendIcon = item.trend === "상승" ? "📈" : item.trend === "하락" ? "📉" : "➡️";
  const latest = item.dailyPrices[item.dailyPrices.length - 1];
  const first = item.dailyPrices[0];

  console.log(`\n${item.icon} ${item.name} (${item.nameEn})`);
  console.log(`  ${trendIcon} 추세: ${item.trend} (${item.trendPct})  |  요인: ${item.keyFactor}`);
  console.log(`  ┌─────────────┬──────────────────┬──────────────────────────────┐`);
  console.log(`  │    날짜     │   국제 시세       │     국내 도매가 (KRW)        │`);
  console.log(`  ├─────────────┼──────────────────┼──────────────────────────────┤`);

  for (const dp of item.dailyPrices) {
    const dayOfWeek = ["일", "월", "화", "수", "목", "금", "토"][new Date(dp.date).getDay()];
    const isWeekend = dayOfWeek === "토" || dayOfWeek === "일";
    const marker = isWeekend ? " *" : "  ";
    const intlStr = typeof dp.intlPrice === "number" && dp.intlPrice >= 100
      ? `${formatNumber(dp.intlPrice)} ${dp.intlUnit}`
      : `${dp.intlPrice} ${dp.intlUnit}`;

    console.log(
      `  │ ${dp.date}(${dayOfWeek})│ ${intlStr.padEnd(16)} │ ${formatNumber(dp.domesticLow)}~${formatNumber(dp.domesticHigh)} ${dp.domesticUnit.padEnd(12)}│`
    );
  }

  console.log(`  └─────────────┴──────────────────┴──────────────────────────────┘`);

  // 기간 내 변동 요약
  const domAvgFirst = (first.domesticLow + first.domesticHigh) / 2;
  const domAvgLast = (latest.domesticLow + latest.domesticHigh) / 2;
  const domChange = ((domAvgLast - domAvgFirst) / domAvgFirst * 100).toFixed(1);
  const domChangeSign = parseFloat(domChange) >= 0 ? "+" : "";
  console.log(`  📊 기간 내 국내 평균가 변동: ${domChangeSign}${domChange}%`);
}

function printSummaryTable() {
  console.log(`\n${"═".repeat(78)}`);
  console.log("  📋 종합 요약 (2/19 기준 국내 도매가)");
  console.log("═".repeat(78));
  console.log(`  ${"원자재".padEnd(20)} ${"도매가 범위".padEnd(25)} ${"추세".padEnd(8)} ${"변동률"}`);
  console.log(`  ${"─".repeat(20)} ${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(10)}`);

  for (const item of ingredients) {
    const latest = item.dailyPrices[item.dailyPrices.length - 1];
    const priceRange = `${formatNumber(latest.domesticLow)}~${formatNumber(latest.domesticHigh)} ${latest.domesticUnit}`;
    const trendIcon = item.trend === "상승" ? "📈" : item.trend === "하락" ? "📉" : "➡️";
    console.log(
      `  ${(item.icon + " " + item.name).padEnd(22)} ${priceRange.padEnd(28)} ${trendIcon}${item.trend.padEnd(5)} ${item.trendPct}`
    );
  }
}

function printBakeryCostSimulation() {
  console.log(`\n${"═".repeat(78)}`);
  console.log("  🎂 빵집 원가 시뮬레이션 — 식빵 1개 (약 600g)");
  console.log("═".repeat(78));

  const costs = [
    { name: "박력분 300g",       low: 225,  high: 255  },
    { name: "무염버터 50g",      low: 775,  high: 890  },
    { name: "설탕 40g",          low: 32,   high: 40   },
    { name: "계란 2개",          low: 367,  high: 427  },
    { name: "우유 100ml",        low: 180,  high: 220  },
    { name: "생크림 30ml",       low: 240,  high: 360  },
    { name: "바닐라 약간",       low: 150,  high: 300  },
    { name: "소금·이스트 등",    low: 50,   high: 80   },
  ];

  let totalLow = 0, totalHigh = 0;
  console.log(`  ${"재료".padEnd(18)} ${"최저 원가".padEnd(12)} ${"최고 원가"}`);
  console.log(`  ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(12)}`);
  for (const c of costs) {
    totalLow += c.low;
    totalHigh += c.high;
    console.log(`  ${c.name.padEnd(18)} ${(formatNumber(c.low) + "원").padEnd(12)} ${formatNumber(c.high)}원`);
  }
  console.log(`  ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(12)}`);
  console.log(`  ${"합계".padEnd(18)} ${(formatNumber(totalLow) + "원").padEnd(12)} ${formatNumber(totalHigh)}원`);
  console.log(`\n  💡 판매가 4,000~5,000원 기준 원자재 원가율: ${(totalLow/4500*100).toFixed(0)}~${(totalHigh/4500*100).toFixed(0)}%`);
}

function printCafeCostSimulation() {
  console.log(`\n${"═".repeat(78)}`);
  console.log("  ☕ 카페 원가 시뮬레이션 — 아메리카노 1잔 (355ml)");
  console.log("═".repeat(78));

  const costs = [
    { name: "원두 18g",          low: 167,  high: 432  },
    { name: "물·얼음",           low: 20,   high: 30   },
    { name: "컵·리드·슬리브",   low: 80,   high: 150  },
  ];

  let totalLow = 0, totalHigh = 0;
  console.log(`  ${"재료".padEnd(18)} ${"최저 원가".padEnd(12)} ${"최고 원가"}`);
  console.log(`  ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(12)}`);
  for (const c of costs) {
    totalLow += c.low;
    totalHigh += c.high;
    console.log(`  ${c.name.padEnd(18)} ${(formatNumber(c.low) + "원").padEnd(12)} ${formatNumber(c.high)}원`);
  }
  console.log(`  ${"─".repeat(18)} ${"─".repeat(12)} ${"─".repeat(12)}`);
  console.log(`  ${"합계".padEnd(18)} ${(formatNumber(totalLow) + "원").padEnd(12)} ${formatNumber(totalHigh)}원`);
  console.log(`\n  💡 판매가 4,500~5,000원 기준 원자재 원가율: ${(totalLow/4700*100).toFixed(0)}~${(totalHigh/4700*100).toFixed(0)}%`);
}

function printInsights() {
  console.log(`\n${"═".repeat(78)}`);
  console.log("  💡 사장님을 위한 이번 주 핵심 인사이트");
  console.log("═".repeat(78));
  console.log(`
  1. 밀가루·설탕 적극 매입 적기
     → CJ·삼양이 정부 압박으로 B2B 4~6% 인하 단행. 설탕은 5년래 최저 수준.
     → 대량 구매 시 추가 할인 협상 유리한 시점입니다.

  2. 초콜릿 원가 급락 — 하반기 이후 반영 전망
     → 카카오 선물 $3,400/톤 (전년比 -62%). 다만 제조사들이
        고가 재고를 아직 소진 중이라 소매가 인하는 2026 하반기 예상.
     → 직접 커버춰를 대량 수입하는 가게라면 지금이 기회.

  3. 커피 원두값 하락세 뚜렷
     → 브라질 역대 최대 작황(6,620만 백) 전망.
     → 장기 계약 시 유리한 가격 확보 가능.

  4. 계란·우유·버터는 국내가 높은 구조적 문제
     → 국내 원유가(1,051원/kg)는 미국(477원)의 2.2배.
     → 2026 FTA 관세 철폐로 수입 UHT 우유 49.9만톤 시대.
     → 수입 버터(뉴질랜드·프랑스산) 가격 비교 필수.

  5. 바닐라·아몬드는 안정적이나 고가 지속
     → 대체재(합성 바닐린 12$/kg, 캐슈넛 등) 검토 추천.
`);
}

function printSources() {
  console.log("═".repeat(78));
  console.log("  📚 데이터 출처");
  console.log("═".repeat(78));
  console.log(`
  • 국제 선물: Trading Economics, Investing.com, Barchart
  • 국내 농산물: KAMIS (농산물유통정보), aT FIS (식품산업통계정보)
  • 국내 가공식품: CJ제일제당·삼양사 공시, 서울우유 등
  • 환율: FRED (연방준비제도), Trading Economics
  • 주말(토·일)은 직전 거래일 종가 기준
  `);
  console.log("═".repeat(78));
}

// ── 메인 실행 ──────────────────────────────────────────────────
function main() {
  printHeader();

  for (const item of ingredients) {
    printIngredient(item);
  }

  printSummaryTable();
  printBakeryCostSimulation();
  printCafeCostSimulation();
  printInsights();
  printSources();
}

main();
