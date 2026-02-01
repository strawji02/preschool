-- 토큰 기반 오버랩 검색 추가
--
-- 문제: trigram 함수들은 글자 순서가 중요해서 "바라깻잎" ↔ "깻잎바라" 매칭 실패
-- 해결: 글자 단위로 분리하여 공통 글자 비율 계산
--       "바라깻잎" (4글자) vs "깻잎바라" (4글자) → 4글자 모두 공통 = 100%

-- 1. 헬퍼 함수: 글자 오버랩 비율 계산
CREATE OR REPLACE FUNCTION char_overlap_ratio(text1 TEXT, text2 TEXT)
RETURNS REAL AS $$
DECLARE
  chars1 TEXT[];
  chars2 TEXT[];
  common_count INTEGER := 0;
  total_count INTEGER;
  i INTEGER;
BEGIN
  -- 빈 문자열 처리
  IF text1 IS NULL OR text2 IS NULL OR text1 = '' OR text2 = '' THEN
    RETURN 0.0;
  END IF;

  -- 공백 제거 후 글자 배열로 변환
  text1 := REPLACE(text1, ' ', '');
  text2 := REPLACE(text2, ' ', '');

  chars1 := string_to_array(text1, NULL);
  chars2 := string_to_array(text2, NULL);

  -- 짧은 쪽 기준으로 공통 글자 수 계산
  FOR i IN 1..array_length(chars1, 1) LOOP
    IF chars1[i] = ANY(chars2) THEN
      common_count := common_count + 1;
    END IF;
  END LOOP;

  -- 짧은 쪽 길이 기준 비율 반환 (검색어가 짧은 경우가 많으므로)
  total_count := LEAST(array_length(chars1, 1), array_length(chars2, 1));
  IF total_count = 0 THEN
    RETURN 0.0;
  END IF;

  RETURN common_count::REAL / total_count::REAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION char_overlap_ratio(TEXT, TEXT) IS
'글자 단위 오버랩 비율 계산. 순서 무관하게 공통 글자 비율 반환.
예: char_overlap_ratio(''바라깻잎'', ''깻잎바라'') = 1.0 (100%)';

-- 2. 기존 함수 삭제
DROP FUNCTION IF EXISTS search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT);

-- 3. RPC 함수 재생성: char_overlap_ratio 추가
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
    -- 7가지 유사도 중 최고값 선택
    GREATEST(
      -- 1. similarity: 전체 문자열 비교 (trigram 기반)
      similarity(p.product_name, search_term_raw),
      similarity(p.product_name, clean_term),
      similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      -- 2. word_similarity 양방향
      word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
      word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
      -- 3. strict_word_similarity
      strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
      -- 4. char_overlap_ratio: 글자 오버랩 (순서 무관!) - NEW!
      char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name))
    ) as match_score
  FROM products p
  WHERE
    -- 공급사 필터 적용 (NULL이면 전체)
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (
      -- 7가지 중 하나라도 threshold 이상이면 후보에 포함
      similarity(p.product_name, search_term_raw) > 0.1
      OR similarity(p.product_name, clean_term) > 0.1
      OR similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
      OR word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term) > 0.1
      OR strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.1
      -- char_overlap은 0.6 이상 (60% 글자 일치)
      OR char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name)) > 0.6
    )
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_fuzzy(TEXT, TEXT, INTEGER, TEXT) IS
'7가지 유사도 함수 조합:
1. similarity (3종): 기본 trigram 비교
2. word_similarity (양방향): 부분 문자열 매칭
3. strict_word_similarity: 단어 경계 기반
4. char_overlap_ratio: 글자 단위 오버랩 (순서 무관)

예: "바라깻잎" → "깻잎바라" 100% 매칭 (글자 오버랩)';
