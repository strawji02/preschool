-- product_name_normalized 컬럼 추가
--
-- 문제: DB에 "[K]바라깻잎" 형태로 저장 → "깻잎" 검색 시 유사도 낮음
-- 해결: 정규화된 상품명 컬럼 추가하여 검색 정확도 향상

-- 1. 컬럼 추가
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_name_normalized TEXT;

-- 2. 기존 데이터 정규화 (SQL로 처리)
-- 규칙: [대괄호], (괄호) 제거 후 특수문자 제거
UPDATE products SET product_name_normalized =
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(product_name, '\[[^\]]*\]', '', 'g'),  -- [대괄호 내용] 제거
        '\([^)]*\)', '', 'g'                                   -- (괄호 내용) 제거
      ),
      '[^가-힣a-zA-Z0-9\s]', '', 'g'                          -- 특수문자 제거
    )
  )
WHERE product_name_normalized IS NULL;

-- 3. 인덱스 추가 (pg_trgm 유사도 검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_products_name_normalized_trgm
  ON products USING gin (product_name_normalized gin_trgm_ops);

-- 4. 기존 함수 삭제 (시그니처 변경)
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT);

-- 5. RPC 함수 업데이트 - product_name_normalized 포함
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
    -- 세 가지 검색 중 가장 높은 유사도 채택
    GREATEST(
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term),
      similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term)
    ) as match_score
  FROM products p
  WHERE
    -- 공급사 필터 적용 (NULL이면 전체)
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      -- 셋 중 하나라도 0.1 이상이면 후보에 포함
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
      OR similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 함수 설명 코멘트
COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'Dual search with normalized column: product_name + product_name_normalized 모두 검색';
