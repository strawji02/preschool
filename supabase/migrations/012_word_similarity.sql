-- word_similarity() 함수 추가로 부분 문자열 매칭 개선
--
-- 문제: "바라깻잎" 검색 시 "깻잎바라"가 매칭 안됨 (단어 순서 문제)
-- 해결: word_similarity()는 검색어가 대상 문자열의 부분 문자열과 유사한지 측정
--       → 단어 순서가 달라도 매칭 가능

-- 1. 기존 함수 삭제 (시그니처 동일하지만 로직 변경)
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT);

-- 2. RPC 함수 재생성: word_similarity() 추가
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
    -- 4가지 유사도 중 최고값 선택
    -- 1. similarity(원본, raw): 전체 문자열 비교
    -- 2. similarity(원본, clean): 정규화된 검색어와 비교
    -- 3. similarity(정규화컬럼, clean): 둘 다 정규화된 상태로 비교
    -- 4. word_similarity(clean, 정규화컬럼): 부분 문자열 매칭 (NEW!)
    GREATEST(
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term),
      similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name))
    ) as match_score
  FROM products p
  WHERE
    -- 공급사 필터 적용 (NULL이면 전체)
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      -- 4가지 중 하나라도 0.1 이상이면 후보에 포함
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
      OR similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 함수 설명 코멘트
COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'word_similarity() 포함 검색: 단어 순서 무관하게 부분 문자열 매칭 지원
예: "바라깻잎" → "깻잎바라" 매칭 가능';
