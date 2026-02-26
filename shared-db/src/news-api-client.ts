// ── News Domain API Client ───────────────────────────────────

export interface NewsArticleInput {
  title: string;
  url: string;
  source: string | null;
  publisher: string | null;
  summary: string | null;
  publishedAt: string | null;
}

export interface NewsApiBatchResultItem {
  newsId: number;
  created: boolean;
}

export interface NewsApiBatchResponse {
  total: number;
  created: number;
  updated: number;
  results: NewsApiBatchResultItem[];
}

export async function sendNewsArticlesBatch(
  baseUrl: string,
  articles: NewsArticleInput[],
): Promise<NewsApiBatchResponse> {
  if (articles.length === 0) {
    return { total: 0, created: 0, updated: 0, results: [] };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/news/articles/batch`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: articles }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`News API 오류 (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<NewsApiBatchResponse>;
}
