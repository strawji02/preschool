-- Savings Analysis 피벗: supplier_filter 제거한 새 RPC 함수
-- 3rd Party 명세서 → 전체 DB(CJ + 신세계) 검색으로 절감 가능액 분석

-- 기존 함수 삭제 후 재생성
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER);

-- supplier 필터 없이 전체 DB 검색, 결과에 supplier 포함
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term TEXT,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  standard_price INTEGER,
  unit_normalized TEXT,
  spec_quantity DECIMAL,
  spec_unit TEXT,
  supplier TEXT,
  match_score REAL
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.product_name,
    p.standard_price::INTEGER,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    p.supplier,
    similarity(p.product_name, search_term) as match_score
  FROM products p
  WHERE
    similarity(p.product_name, search_term) > 0.1
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 인덱스 추가 (전체 테이블 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (product_name gin_trgm_ops);
