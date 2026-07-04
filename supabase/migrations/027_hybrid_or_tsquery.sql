-- ============================================================
-- 027: hybrid RPC의 BM25 검색을 plainto_tsquery(AND) → to_tsquery(OR)로 전환
-- ============================================================
-- 근본 원인 (2026-07-04 검증):
--   기존 search_products_hybrid는 `plainto_tsquery('simple', search_term_clean)`를
--   사용. plainto_tsquery는 모든 토큰을 AND로 묶는다.
--   → expandedKeyword에 동의어가 여러 개 확장되면(예: "N 달걀 계란 란 에그 특란 무항생제")
--     그 조합을 전부 가진 상품이 없어 BM25가 0건 → 트리그램(글자유사도)만으로 랭킹.
--     결과: 계란절단기·샤프란 같은 노이즈가 상위, 정답은 밀리고, 비교불가 대량 발생.
--
-- 해결:
--   clean 토큰을 공백분리 → 특수문자 제거 → ' | '로 결합해 to_tsquery(OR) 구성.
--   OR라 토큰 중 하나만 매칭돼도 후보에 들고, ts_rank가 "더 많은/희귀한 토큰을 가진"
--   상품을 상위로 올린다. tsvector는 whole-lexeme 매칭이라 substring 과매칭도 없음.
--   (예: "무생채"는 토큰 '무'가 아니라 '무생채' 통째라 '무' OR에 안 걸림)
--
-- 안전장치: OR 쿼리가 비면 기존 plainto_tsquery로 폴백.
-- ============================================================

-- 기존 함수와 OUT 파라미터가 달라 CREATE OR REPLACE 불가 → DROP 후 재생성
DROP FUNCTION IF EXISTS search_products_hybrid(TEXT, TEXT, INTEGER, TEXT, REAL, REAL);

CREATE OR REPLACE FUNCTION search_products_hybrid(
  search_term_raw TEXT,
  search_term_clean TEXT,
  limit_count INTEGER DEFAULT 10,
  supplier_filter TEXT DEFAULT NULL,
  bm25_weight REAL DEFAULT 0.5,
  semantic_weight REAL DEFAULT 0.5
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
  bm25_score REAL,
  semantic_score REAL,
  ppu DECIMAL,
  standard_unit TEXT,
  tax_type TEXT,
  category TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  k CONSTANT REAL := 60.0;  -- RRF constant
  clean_or TEXT;
  ts_q tsquery;
BEGIN
  -- OR tsquery 구성: 공백분리 → 특수문자 제거(한글/영문/숫자만) → DISTINCT → ' | ' 결합
  SELECT string_agg(DISTINCT tok, ' | ')
  INTO clean_or
  FROM (
    SELECT regexp_replace(t, '[^0-9A-Za-z가-힣]', '', 'g') AS tok
    FROM unnest(regexp_split_to_array(COALESCE(search_term_clean, ''), '\s+')) AS t
  ) s
  WHERE tok <> '';

  -- OR 쿼리 구성 (폴백: 비면 plainto_tsquery)
  IF clean_or IS NULL OR clean_or = '' THEN
    ts_q := plainto_tsquery('simple', COALESCE(search_term_clean, ''));
  ELSE
    ts_q := to_tsquery('simple', clean_or);
  END IF;

  RETURN QUERY
  WITH
  -- Step 1: BM25 Search (OR tsquery)
  bm25_results AS (
    SELECT
      p.id,
      ts_rank(p.search_vector, ts_q) as score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(p.search_vector, ts_q) DESC) as rank
    FROM products p
    WHERE
      (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND p.search_vector @@ ts_q
  ),
  -- Step 2: Trigram Search (Semantic)
  semantic_results AS (
    SELECT
      p.id,
      similarity(p.product_name, search_term_raw) as score,
      ROW_NUMBER() OVER (ORDER BY similarity(p.product_name, search_term_raw) DESC) as rank
    FROM products p
    WHERE
      (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND similarity(p.product_name, search_term_raw) > 0.1
  ),
  -- Step 3: RRF Fusion
  rrf_scores AS (
    SELECT
      COALESCE(b.id, s.id) as product_id,
      (bm25_weight * COALESCE(1.0 / (k + b.rank::REAL), 0.0) +
       semantic_weight * COALESCE(1.0 / (k + s.rank::REAL), 0.0))::REAL as combined_score,
      COALESCE(b.score, 0.0)::REAL as bm25_score,
      COALESCE(s.score, 0.0)::REAL as semantic_score
    FROM bm25_results b
    FULL OUTER JOIN semantic_results s ON b.id = s.id
  )
  -- Step 4: Return results
  SELECT
    p.id,
    p.product_name,
    p.standard_price::INTEGER,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    p.supplier,
    r.combined_score as match_score,
    r.bm25_score,
    r.semantic_score,
    p.ppu,
    p.standard_unit,
    p.tax_type,
    p.category
  FROM rrf_scores r
  JOIN products p ON r.product_id = p.id
  ORDER BY r.combined_score DESC
  LIMIT limit_count;
END;
$$;
