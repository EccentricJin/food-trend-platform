import "dotenv/config";
import { Kafka } from "kafkajs";

export const KAFKA_BOOTSTRAP_SERVERS = process.env.KAFKA_BOOTSTRAP_SERVERS ?? "";
export const KAFKA_API_KEY = process.env.KAFKA_API_KEY ?? "";
export const KAFKA_API_SECRET = process.env.KAFKA_API_SECRET ?? "";
export const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID ?? "mysql-consumer-group";

export const kafka = new Kafka({
  clientId: "kafka-to-mysql-consumer",
  brokers: KAFKA_BOOTSTRAP_SERVERS.split(","),
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: KAFKA_API_KEY,
    password: KAFKA_API_SECRET,
  },
});

export const TOPICS = {
  GOOGLE_SEARCH: "google-search-results",
  YOUTUBE_SEARCH: "youtube-search-results",
  YOUTUBE_INGREDIENTS: "youtube-ingredient-prices",
  NAVER_INGREDIENT_PRICES: "naver-ingredient-prices",
  NAVER_SEARCH: "naver-search-results",
} as const;
