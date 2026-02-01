-- 양방향 word_similarity 추가
--
-- 문제: word_similarity(A, B)는 A가 B의 부분 문자열인지만 체크
--       "바라깻잎" vs "깻잎바라"는 어순이 반대라 매칭 실패
-- 해결: 양방향 word_similarity + strict_word_similarity 적용
--       → 어순이 달라도 공통 글자가 많으면 매칭

-- 1. 기존 함수 삭제
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT);

-- 2. RPC 함수 재생성: 양방향 word_similarity 적용
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
  normalized_col TEXT;
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
    -- 6가지 유사도 중 최고값 선택
    GREATEST(
      -- 1. similarity: 전체 문자열 비교 (기본)
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term),
      similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      -- 2. word_similarity 정방향: 검색어가 상품명의 부분 문자열인지
      word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
      -- 3. word_similarity 역방향: 상품명이 검색어의 부분 문자열인지 (NEW!)
      word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      -- 4. strict_word_similarity: 더 엄격한 단어 경계 매칭 (NEW!)
      strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name))
    ) as match_score
  FROM products p
  WHERE
    -- 공급사 필터 적용 (NULL이면 전체)
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      -- 6가지 중 하나라도 0.1 이상이면 후보에 포함
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
      OR similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
      OR word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 함수 설명 코멘트
COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'양방향 word_similarity + strict_word_similarity 적용
- 정방향: 검색어 → 상품명 부분 매칭
- 역방향: 상품명 → 검색어 부분 매칭
- strict: 단어 경계 기반 엄격 매칭
예: "바라깻잎" ↔ "깻잎바라" 양방향 매칭';
