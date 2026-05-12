-- 045_search_vector_with_spec_raw.sql
-- search_vector 확장: product_name + spec_raw 합쳐서 BM25 검색 대상 확대
--
-- 배경 (사용자 보고 2026-05-12):
-- - SHINSEGAE 220776 "돈앞다리 국내산 냉동" (spec_raw: '1KG, 다짐육')
-- - 검수 "돈민찌"/"돼지 다짐육" 시 220776 후보 누락
-- - 원인: search_vector가 product_name만 포함 → spec_raw '다짐육' BM25 hit 안 됨
--
-- 영향:
-- - GENERATED column 재계산 — 전체 row 재산정 (수만 row, 수십초 예상)
-- - 기존 GIN 인덱스 재구축 (DROP INDEX 후 CREATE)

-- 1. generated column 재정의
ALTER TABLE products
  DROP COLUMN search_vector;

ALTER TABLE products
  ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(product_name, '') || ' ' || coalesce(spec_raw, ''))
  ) STORED;

-- 2. GIN 인덱스 재생성 (DROP COLUMN으로 자동 삭제됨)
CREATE INDEX IF NOT EXISTS idx_products_search_vector
  ON products USING gin(search_vector);

COMMENT ON COLUMN products.search_vector IS
  'product_name + spec_raw 통합 tsvector — 가공정보(다짐육/컷팅/슬라이스 등) BM25 검색 가능';
