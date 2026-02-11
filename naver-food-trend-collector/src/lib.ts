import "dotenv/config";
import { Kafka, CompressionTypes } from "kafkajs";

// ── Environment ──────────────────────────────────────────────────────
export const KAFKA_BOOTSTRAP_SERVERS = process.env.KAFKA_BOOTSTRAP_SERVERS ?? "";
export const KAFKA_API_KEY = process.env.KAFKA_API_KEY ?? "";
export const KAFKA_API_SECRET = process.env.KAFKA_API_SECRET ?? "";
export const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID ?? "mcp-consumer-group";
export const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID ?? "";
export const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET ?? "";

export const TOPIC = "naver-search-results";
export { CompressionTypes };

// ── Kafka Client ─────────────────────────────────────────────────────
export const kafka = new Kafka({
  clientId: "naver-food-trend-collector",
  brokers: KAFKA_BOOTSTRAP_SERVERS.split(","),
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: KAFKA_API_KEY,
    password: KAFKA_API_SECRET,
  },
});

// ── Naver Search API ─────────────────────────────────────────────────
export type NaverSearchType = "news" | "blog" | "shop" | "image" | "webkr" | "cafearticle";

export interface NaverSearchResult<T = unknown> {
  lastBuildDate: string;
  total: number;
  start: number;
  display: number;
  items: T[];
}

export interface NaverShopItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
}

export async function searchNaver<T = unknown>(
  type: NaverSearchType,
  query: string,
  display = 100,
  sort: "sim" | "date" = "date",
): Promise<NaverSearchResult<T>> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET 환경변수를 설정해주세요.");
  }

  const url = new URL(`https://openapi.naver.com/v1/search/${type}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", sort);

  const response = await fetch(url.toString(), {
    headers: {
      "X-Naver-Client-Id": NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Naver API 오류 (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<NaverSearchResult<T>>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
