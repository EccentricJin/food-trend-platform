import type { Pool } from "mysql2/promise";
import { insertNaverIngredientPrice, type NaverIngredientPriceRow } from "shared-db";

export async function handleNaverIngredientPrices(
  pool: Pool, value: any, runId: string, partition: number, offset: number | null,
): Promise<void> {
  const row: NaverIngredientPriceRow = {
    run_id: runId,
    ingredient: value.ingredient,
    unit: value.unit ?? null,
    keyword: value.keyword,
    requested_at: value.requestedAt,
    total_results: value.totalResults ?? null,
    product_title: value.product?.title ?? "",
    product_link: value.product?.link ?? null,
    product_image: value.product?.image ?? null,
    lprice: value.product?.lprice ?? null,
    hprice: value.product?.hprice ?? null,
    mall_name: value.product?.mallName ?? null,
    brand: value.product?.brand ?? null,
    maker: value.product?.maker ?? null,
    product_type: value.product?.productType ?? null,
    category1: value.product?.category1 ?? null,
    category2: value.product?.category2 ?? null,
    category3: value.product?.category3 ?? null,
    category4: value.product?.category4 ?? null,
    kafka_offset: offset,
    kafka_partition: partition,
  };
  await insertNaverIngredientPrice(pool, row);
}
