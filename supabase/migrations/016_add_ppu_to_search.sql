-- PPU(단위당 가격) 필드를 검색 결과에 추가
--
-- 이전: standard_price만 반환
-- 이후: ppu, standard_unit도 반환하여 PPU 기반 비교 가능

DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT);

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
  match_score REAL,
  -- PPU 관련 필드 추가
  ppu DECIMAL,
  standard_unit TEXT
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
    -- 7가지 유사도 중 최고값 선택
    GREATEST(
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term),
      similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
      word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
      char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name))
    ) as match_score,
    -- PPU 필드 추가
    p.ppu,
    p.standard_unit
  FROM products p
  WHERE
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
      OR similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
      OR word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
      OR char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.6
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'PPU 필드 추가된 검색 함수. ppu와 standard_unit을 반환하여 정확한 단가 비교 가능.';
