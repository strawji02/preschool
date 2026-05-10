-- 043_add_is_food.sql (2026-05-11)
--
-- 거래명세표는 100% 식자재이므로 매칭 후보를 식자재로만 제한.
-- 비식자재 (용기/조리도구/유니폼/사무용품 등) 18개 카테고리는 매칭에서 제외.
--
-- - is_food = true:  식자재 (매칭 가능)
-- - is_food = false: 비식자재 (매칭 제외) — 용기/잡화/유니폼/사무용품 등
-- - is_food = NULL:  미분류 (안전망 — 매칭 시 포함)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_food BOOLEAN DEFAULT NULL;

-- 비식자재 카테고리 18개 → false
UPDATE products
SET is_food = FALSE
WHERE category IN (
  '키친',        -- 조리도구, 테이블웨어 (895건)
  '잡화',        -- 일회용품, 주방장갑 (223건)
  '용기',        -- 합성수지용기, 종이용기, 친환경용기 (219건)
  '유니폼',      -- (192건)
  '사무용품',    -- (147건)
  '소모품',      -- (143건)
  '세척용품',    -- (95건)
  '세제',        -- (48건)
  '제지',        -- (41건)
  '위생용품',    -- (33건)
  '안전용품',    -- (31건)
  '사무장비',    -- (26건)
  '종이',        -- 카톤박스, 쇼핑백 (12건)
  '일회용품',    -- (11건)
  '인쇄',        -- (8건)
  '연포장',      -- 합성수지필름, 비닐포장재 (6건)
  '스티커',      -- (5건)
  '소모품 기타'  -- (1건)
);

-- 나머지 카테고리는 식자재로 마킹 (NULL인 행은 안전망으로 남김)
UPDATE products
SET is_food = TRUE
WHERE is_food IS NULL
  AND category IS NOT NULL;

-- 인덱스 — 매칭/검색 시 is_food 필터 사용 빈도 높음
CREATE INDEX IF NOT EXISTS idx_products_is_food
  ON products (is_food)
  WHERE is_food = TRUE;

-- 코멘트
COMMENT ON COLUMN products.is_food IS
  '식자재 여부. true=매칭 가능, false=비식자재(용기/조리도구/유니폼 등) 매칭 제외, NULL=미분류 안전망';
