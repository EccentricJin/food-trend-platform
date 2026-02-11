# 🍽️ Food Trend Data Platform (음식 트렌드 데이터 수집 플랫폼)

실시간 음식 트렌드(두바이 쿠키 등)를 Google, YouTube, Naver에서 자동 수집하여 Kafka + MySQL에 저장하는 데이터 파이프라인입니다.

## 📁 프로젝트 구조

```
mcp-servers/
├── google-youtube-trend-collector/   # Google/YouTube/Naver 쇼핑 데이터 수집
├── naver-food-trend-collector/       # Naver 뉴스/블로그/쇼핑 트렌드 수집
├── kafka-to-mysql-consumer/          # Kafka → MySQL 독립 컨슈머
├── shared-db/                        # 공유 MySQL 모듈 (커넥션, 스키마, 리포지토리)
└── confluent-kafka/                  # Kafka MCP Server (토픽 관리)
```

## 🏗️ 아키텍처

```
┌────────────────────────┐     ┌─────────────┐     ┌─────────┐
│  Google Custom Search  │────→│             │────→│         │
│  YouTube Data API v3   │────→│  Confluent  │────→│  MySQL  │
│  Naver Search API      │────→│  Cloud      │     │   DB    │
│  Naver Shopping API    │────→│  Kafka      │     │         │
└────────────────────────┘     └─────────────┘     └─────────┘
        │                                               ▲
        │           Direct DB Write                     │
        └───────────────────────────────────────────────┘
```

**이중 저장 (Dual Write)**:
- **경로 1**: Collector → Kafka + MySQL (수집 시 직접 저장)
- **경로 2**: Kafka → kafka-to-mysql-consumer → MySQL (별도 컨슈머)

## 📊 데이터 소스 & Kafka 토픽

| 소스 | 토픽 | 설명 |
|------|------|------|
| Google Custom Search | `google-search-results` | 키워드별 검색 결과 |
| YouTube Data API v3 | `youtube-search-results` | 트렌드 영상 정보 |
| YouTube Data API v3 | `youtube-ingredient-prices` | 재료 가격 영상 |
| Naver Shopping API | `naver-ingredient-prices` | 재료별 쇼핑 가격 |
| Naver Search API | `naver-search-results` | 뉴스/블로그/쇼핑 트렌드 |

## 🗄️ MySQL 스키마 (7개 테이블)

| 테이블 | 용도 |
|--------|------|
| `collection_runs` | 수집 실행 메타데이터 (run_id, 상태, 통계) |
| `google_search_results` | Google 검색 결과 |
| `youtube_search_results` | YouTube 영상 검색 결과 |
| `youtube_ingredient_prices` | YouTube 재료 가격 영상 |
| `naver_ingredient_prices` | 네이버 쇼핑 재료 가격 |
| `naver_search_results` | 네이버 트렌드 검색 (뉴스/블로그/쇼핑) |
| `naver_ingredient_search_results` | 네이버 재료 검색 (가격통계 포함) |

## 🚀 시작하기

### 사전 요구사항
- Node.js 18+
- MySQL 8.0+
- Confluent Cloud 계정 (Kafka)

### 1. 환경변수 설정

각 프로젝트의 `.env.example`을 `.env`로 복사 후 실제 값을 입력:

```bash
# 각 프로젝트 디렉토리에서
cp .env.example .env
# .env 파일에 실제 API 키와 비밀번호 입력
```

### 2. MySQL 설정

```sql
CREATE DATABASE food_trend_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'food_trend_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';
GRANT ALL PRIVILEGES ON food_trend_db.* TO 'food_trend_user'@'localhost';
FLUSH PRIVILEGES;
```

### 3. 의존성 설치 & 빌드

```bash
# shared-db 먼저 빌드
cd shared-db && npm install && npm run build

# 각 프로젝트 설치
cd ../google-youtube-trend-collector && npm install
cd ../naver-food-trend-collector && npm install
cd ../kafka-to-mysql-consumer && npm install
```

### 4. 데이터 수집 실행

```bash
# Google/YouTube 수집
cd google-youtube-trend-collector
npm run collect:google      # Google 검색 수집
npm run collect:youtube     # YouTube 영상 수집
npm run collect:ingredients # YouTube 재료 가격 수집
npm run collect:naver       # Naver 쇼핑 가격 수집
npm run collect:all         # 전체 수집

# Naver 트렌드 수집
cd naver-food-trend-collector
npm run collect:trends      # 뉴스/블로그/쇼핑 트렌드
npm run collect:ingredients # 재료 검색

# Kafka Consumer (별도 터미널)
cd kafka-to-mysql-consumer
npm run consume             # Kafka → MySQL 소비 시작
```

## 🔑 필요한 API 키

| API | 발급처 |
|-----|--------|
| Confluent Cloud Kafka | https://confluent.cloud |
| Google Custom Search | https://console.cloud.google.com |
| YouTube Data API v3 | https://console.cloud.google.com |
| Naver Search/Shopping API | https://developers.naver.com |

## 🛠️ 기술 스택

- **Runtime**: Node.js + TypeScript (ES2022)
- **Message Queue**: Apache Kafka (Confluent Cloud)
- **Database**: MySQL 8.0 (mysql2/promise)
- **APIs**: Google CSE, YouTube Data v3, Naver Search, Naver Shopping
