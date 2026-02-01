-- Supplier-filtered search for Side-by-Side comparison
--
-- 각 공급사별 best match를 찾기 위한 supplier_filter 파라미터 추가
-- 기존 함수를 확장하여 optional supplier 필터 지원

-- 기존 함수 삭제 (시그니처 변경)
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER);

-- Supplier Filter 지원 RPC 함수
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term_raw TEXT,
  search_term_clean TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
  supplier_filter TEXT DEFAULT NULL  -- 'CJ', 'SHINSEGAE', or NULL (전체)
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
DECLARE
  clean_term TEXT;
BEGIN
  -- Clean term이 없으면 raw term 사용
  clean_term := COALESCE(search_term_clean, search_term_raw);

  RETURN QUERY
  SELECT
    p.id,
    p.product_name,
    p.standard_price::INTEGER,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    p.supplier,
    -- 두 검색어 중 더 높은 유사도 채택
    GREATEST(
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term)
    ) as match_score
  FROM products p
  WHERE
    -- 공급사 필터 적용 (NULL이면 전체)
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      -- 둘 중 하나라도 0.1 이상이면 후보에 포함
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 함수 설명 코멘트
COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'Dual search with optional supplier filter: CJ, SHINSEGAE, or NULL for all';
