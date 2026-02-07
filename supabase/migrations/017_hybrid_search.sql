-- Phase 1: Hybrid Search (BM25 + Trigram)
--
-- 목표: 키워드 매칭 (BM25) + 의미 유사도 (Trigram) 결합으로 정확도 향상
-- 방법: Reciprocal Rank Fusion (RRF) - 두 순위의 역수 합산
--
-- 예상 효과: 60% → 65-70% 정확도

-- ========================================
-- 1. BM25 검색 함수 (키워드 기반)
-- ========================================

CREATE OR REPLACE FUNCTION search_products_bm25(
  search_term TEXT,
  limit_count INTEGER DEFAULT 5,
  supplier_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  standard_price INTEGER,
  unit_normalized TEXT,
  spec_quantity DECIMAL,
  spec_unit TEXT,
  supplier TEXT,
  bm25_rank REAL,
  ppu DECIMAL,
  standard_unit TEXT
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
    -- BM25 스코어 (ts_rank with normalization)
    ts_rank(p.search_vector, plainto_tsquery('simple', search_term)) as bm25_rank,
    p.ppu,
    p.standard_unit
  FROM products p
  WHERE
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND p.search_vector @@ plainto_tsquery('simple', search_term)
  ORDER BY bm25_rank DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_bm25(TEXT, INTEGER, TEXT) IS
'BM25 기반 키워드 검색. ts_rank 사용으로 정확한 단어 매칭에 강함.';

-- ========================================
-- 2. Hybrid Search 함수 (BM25 + Trigram)
-- ========================================

DROP FUNCTION IF EXISTS search_products_hybrid(TEXT, TEXT, INTEGER, TEXT, REAL, REAL);

CREATE OR REPLACE FUNCTION search_products_hybrid(
  search_term_raw TEXT,
  search_term_clean TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
  supplier_filter TEXT DEFAULT NULL,
  bm25_weight REAL DEFAULT 0.5,  -- BM25 가중치 (0~1)
  semantic_weight REAL DEFAULT 0.5  -- Semantic 가중치 (0~1)
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
  standard_unit TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  clean_term TEXT;
  k CONSTANT REAL := 60.0;  -- RRF 상수
BEGIN
  -- Clean term이 없으면 raw term 사용
  clean_term := COALESCE(search_term_clean, search_term_raw);

  RETURN QUERY
  WITH
  -- Step 1: BM25 검색 (키워드 순위)
  bm25_results AS (
    SELECT
      p.id,
      ts_rank(p.search_vector, plainto_tsquery('simple', search_term_raw)) as score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(p.search_vector, plainto_tsquery('simple', search_term_raw)) DESC) as rank
    FROM products p
    WHERE
      (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND p.search_vector @@ plainto_tsquery('simple', search_term_raw)
  ),
  -- Step 2: Semantic 검색 (유사도 순위)
  semantic_results AS (
    SELECT
      p.id,
      GREATEST(
        similarity(p.product_name, search_term_raw),
        similarity(p.product_name, clean_term),
        similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
        word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
        word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
        strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
        char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name))
      ) as score,
      ROW_NUMBER() OVER (
        ORDER BY GREATEST(
          similarity(p.product_name, search_term_raw),
          similarity(p.product_name, clean_term),
          similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
          word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
          word_similarity(COALESCE(p.product_name_normalized, p.product_name), clean_term),
          strict_word_similarity(clean_term, COALESCE(p.product_name_normalized, p.product_name)),
          char_overlap_ratio(clean_term, COALESCE(p.product_name_normalized, p.product_name))
        ) DESC
      ) as rank
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
  ),
  -- Step 3: Reciprocal Rank Fusion (RRF)
  rrf_scores AS (
    SELECT
      COALESCE(b.id, s.id) as product_id,
      -- RRF Formula: 1/(k + rank)
      (bm25_weight * COALESCE(1.0 / (k + b.rank::REAL), 0.0) +
       semantic_weight * COALESCE(1.0 / (k + s.rank::REAL), 0.0)) as combined_score,
      COALESCE(b.score, 0.0) as bm25_score,
      COALESCE(s.score, 0.0) as semantic_score
    FROM bm25_results b
    FULL OUTER JOIN semantic_results s ON b.id = s.id
  )
  -- Step 4: 최종 결과 반환
  SELECT
    p.id,
    p.product_name,
    p.standard_price::INTEGER,
    p.unit_normalized,
    p.spec_quantity,
    p.spec_unit,
    p.supplier,
    r.combined_score::REAL as match_score,
    r.bm25_score::REAL,
    r.semantic_score::REAL,
    p.ppu,
    p.standard_unit
  FROM rrf_scores r
  JOIN products p ON r.product_id = p.id
  ORDER BY r.combined_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_hybrid(TEXT, TEXT, INTEGER, TEXT, REAL, REAL) IS
'Hybrid Search with Reciprocal Rank Fusion (RRF).
Combines BM25 (keyword) + Trigram (semantic) for balanced accuracy.

Parameters:
- search_term_raw: Original query (with specs)
- search_term_clean: Normalized query (noise removed)
- limit_count: Max results (default 5)
- supplier_filter: CJ, SHINSEGAE, or NULL (all)
- bm25_weight: BM25 weight (0~1, default 0.5)
- semantic_weight: Semantic weight (0~1, default 0.5)

Example:
SELECT * FROM search_products_hybrid(''평양식왕만두'', ''평양식왕만두'', 5, NULL, 0.5, 0.5);';

-- ========================================
-- 3. 성능 최적화: GIN 인덱스 (이미 있으면 스킵)
-- ========================================

-- search_vector용 GIN 인덱스 (이미 존재할 수 있음)
CREATE INDEX IF NOT EXISTS idx_products_search_vector_gin
ON products USING GIN(search_vector);

-- product_name_normalized용 trigram 인덱스 (이미 존재할 수 있음)
CREATE INDEX IF NOT EXISTS idx_products_name_normalized_trgm
ON products USING GIN(product_name_normalized gin_trgm_ops);

-- ========================================
-- 4. 테스트 쿼리 (참고용)
-- ========================================

-- BM25 only
-- SELECT * FROM search_products_bm25('평양식왕만두', 5, NULL);

-- Hybrid (기본 50:50)
-- SELECT * FROM search_products_hybrid('평양식왕만두', '평양식왕만두', 5, NULL, 0.5, 0.5);

-- Hybrid (BM25 우선)
-- SELECT * FROM search_products_hybrid('평양식왕만두', '평양식왕만두', 5, NULL, 0.7, 0.3);

-- Hybrid (Semantic 우선)
-- SELECT * FROM search_products_hybrid('평양식왕만두', '평양식왕만두', 5, NULL, 0.3, 0.7);
