import type { Pool } from "mysql2/promise";
import type { NaverIngredientPriceRow } from "../types.js";

export async function insertNaverIngredientPrice(
  pool: Pool,
  row: NaverIngredientPriceRow,
): Promise<void> {
  await pool.execute(
    `INSERT INTO naver_ingredient_prices
       (run_id, ingredient, unit, keyword, requested_at, total_results,
        product_title, product_link, product_image, lprice, hprice,
        mall_name, brand, maker, product_type,
        category1, category2, category3, category4)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.run_id, row.ingredient, row.unit, row.keyword, row.requested_at, row.total_results,
      row.product_title, row.product_link, row.product_image, row.lprice, row.hprice,
      row.mall_name, row.brand, row.maker, row.product_type,
      row.category1, row.category2, row.category3, row.category4,
    ],
  );
}

export async function insertNaverIngredientPricesBatch(
  pool: Pool,
  rows: NaverIngredientPriceRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const placeholders = rows
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const values = rows.flatMap((row) => [
    row.run_id, row.ingredient, row.unit, row.keyword, row.requested_at, row.total_results,
    row.product_title, row.product_link, row.product_image, row.lprice, row.hprice,
    row.mall_name, row.brand, row.maker, row.product_type,
    row.category1, row.category2, row.category3, row.category4,
  ]);
  await pool.execute(
    `INSERT INTO naver_ingredient_prices
       (run_id, ingredient, unit, keyword, requested_at, total_results,
        product_title, product_link, product_image, lprice, hprice,
        mall_name, brand, maker, product_type,
        category1, category2, category3, category4)
     VALUES ${placeholders}`,
    values,
  );
}
