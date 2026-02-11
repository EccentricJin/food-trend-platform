import type { Pool } from "mysql2/promise";

const TABLES: string[] = [
  // 1. collection_runs
  `CREATE TABLE IF NOT EXISTS collection_runs (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id        VARCHAR(36) NOT NULL,
    source        VARCHAR(50) NOT NULL,
    collector     VARCHAR(80) NOT NULL,
    status        ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
    total_records INT UNSIGNED NOT NULL DEFAULT 0,
    started_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at   DATETIME(3) NULL,
    error_message TEXT NULL,
    created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_run_id (run_id),
    INDEX idx_source (source),
    INDEX idx_started_at (started_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 2. google_search_results
  `CREATE TABLE IF NOT EXISTS google_search_results (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id         VARCHAR(36) NULL,
    category       VARCHAR(50) NOT NULL,
    keyword        VARCHAR(200) NOT NULL,
    requested_at   DATETIME(3) NOT NULL,
    total_results  VARCHAR(30) NULL,
    search_time    DECIMAL(10,4) NULL,
    title          TEXT NOT NULL,
    link           VARCHAR(2048) NOT NULL,
    snippet        TEXT NULL,
    display_link   VARCHAR(500) NULL,
    kafka_offset   BIGINT NULL,
    kafka_partition INT NULL,
    created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_category (category),
    INDEX idx_keyword (keyword),
    INDEX idx_requested_at (requested_at),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 3. youtube_search_results
  `CREATE TABLE IF NOT EXISTS youtube_search_results (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(36) NULL,
    category        VARCHAR(50) NOT NULL,
    keyword         VARCHAR(200) NOT NULL,
    requested_at    DATETIME(3) NOT NULL,
    total_results   INT UNSIGNED NULL,
    video_id        VARCHAR(20) NOT NULL,
    video_title     TEXT NOT NULL,
    video_description TEXT NULL,
    channel_title   VARCHAR(200) NULL,
    published_at    DATETIME NULL,
    thumbnail_url   VARCHAR(2048) NULL,
    video_url       VARCHAR(2048) NULL,
    view_count      BIGINT UNSIGNED NULL,
    like_count      BIGINT UNSIGNED NULL,
    comment_count   BIGINT UNSIGNED NULL,
    kafka_offset    BIGINT NULL,
    kafka_partition INT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_category (category),
    INDEX idx_keyword (keyword),
    INDEX idx_video_id (video_id),
    INDEX idx_requested_at (requested_at),
    INDEX idx_view_count (view_count),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 4. youtube_ingredient_prices
  `CREATE TABLE IF NOT EXISTS youtube_ingredient_prices (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(36) NULL,
    ingredient      VARCHAR(100) NOT NULL,
    keyword         VARCHAR(200) NOT NULL,
    requested_at    DATETIME(3) NOT NULL,
    period          VARCHAR(20) NULL,
    total_results   INT UNSIGNED NULL,
    video_id        VARCHAR(20) NOT NULL,
    video_title     TEXT NOT NULL,
    video_description TEXT NULL,
    channel_title   VARCHAR(200) NULL,
    published_at    DATETIME NULL,
    thumbnail_url   VARCHAR(2048) NULL,
    video_url       VARCHAR(2048) NULL,
    view_count      BIGINT UNSIGNED NULL,
    like_count      BIGINT UNSIGNED NULL,
    comment_count   BIGINT UNSIGNED NULL,
    kafka_offset    BIGINT NULL,
    kafka_partition INT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_ingredient (ingredient),
    INDEX idx_keyword (keyword),
    INDEX idx_video_id (video_id),
    INDEX idx_requested_at (requested_at),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 5. naver_ingredient_prices
  `CREATE TABLE IF NOT EXISTS naver_ingredient_prices (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(36) NULL,
    ingredient      VARCHAR(100) NOT NULL,
    unit            VARCHAR(50) NULL,
    keyword         VARCHAR(200) NOT NULL,
    requested_at    DATETIME(3) NOT NULL,
    total_results   INT UNSIGNED NULL,
    product_title   TEXT NOT NULL,
    product_link    VARCHAR(2048) NULL,
    product_image   VARCHAR(2048) NULL,
    lprice          INT UNSIGNED NULL,
    hprice          INT UNSIGNED NULL,
    mall_name       VARCHAR(200) NULL,
    brand           VARCHAR(200) NULL,
    maker           VARCHAR(200) NULL,
    product_type    VARCHAR(50) NULL,
    category1       VARCHAR(100) NULL,
    category2       VARCHAR(100) NULL,
    category3       VARCHAR(100) NULL,
    category4       VARCHAR(100) NULL,
    kafka_offset    BIGINT NULL,
    kafka_partition INT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_ingredient (ingredient),
    INDEX idx_keyword (keyword),
    INDEX idx_lprice (lprice),
    INDEX idx_requested_at (requested_at),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 6. naver_search_results (트렌드: news/blog/shop)
  `CREATE TABLE IF NOT EXISTS naver_search_results (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(36) NULL,
    msg_type        VARCHAR(30) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    keyword         VARCHAR(200) NOT NULL,
    search_type     VARCHAR(20) NOT NULL,
    requested_at    DATETIME(3) NOT NULL,
    total_available INT UNSIGNED NULL,
    item_title      TEXT NULL,
    item_link       VARCHAR(2048) NULL,
    item_data       JSON NOT NULL,
    kafka_offset    BIGINT NULL,
    kafka_partition INT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_msg_type (msg_type),
    INDEX idx_category (category),
    INDEX idx_keyword (keyword),
    INDEX idx_search_type (search_type),
    INDEX idx_requested_at (requested_at),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 7. naver_ingredient_search_results (재료 검색)
  `CREATE TABLE IF NOT EXISTS naver_ingredient_search_results (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    run_id          VARCHAR(36) NULL,
    msg_type        VARCHAR(30) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    ingredient      VARCHAR(100) NOT NULL,
    keyword         VARCHAR(200) NOT NULL,
    search_type     VARCHAR(20) NOT NULL,
    requested_at    DATETIME(3) NOT NULL,
    price_stats_min INT UNSIGNED NULL,
    price_stats_max INT UNSIGNED NULL,
    price_stats_avg INT UNSIGNED NULL,
    price_stats_count INT UNSIGNED NULL,
    item_title      TEXT NULL,
    item_link       VARCHAR(2048) NULL,
    item_data       JSON NOT NULL,
    kafka_offset    BIGINT NULL,
    kafka_partition INT NULL,
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_msg_type (msg_type),
    INDEX idx_ingredient (ingredient),
    INDEX idx_keyword (keyword),
    INDEX idx_search_type (search_type),
    INDEX idx_requested_at (requested_at),
    INDEX idx_run_id (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureSchema(pool: Pool): Promise<void> {
  for (const ddl of TABLES) {
    await pool.execute(ddl);
  }
  console.log("[DB] 스키마 확인 완료 (7개 테이블)");
}
