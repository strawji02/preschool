-- Hybrid Search: BM25 + Vector (Simplified)
--
-- 목표: 문서 권장사항에 따라 BM25 (키워드) + Vector (시맨틱) 조합
-- 방법: Reciprocal Rank Fusion (RRF) - 두 순위의 역수 합산
-- 예상 효과: 15-30% 정확도 향상
--
-- 참고: claudedocs/korean_search_production.md

-- ========================================
-- 1. Hybrid Search: BM25 + Vector
-- ========================================

CREATE OR REPLACE FUNCTION search_products_hybrid_bm25_vector(
  search_term TEXT,
  query_embedding vector(384),
  limit_count INTEGER DEFAULT 10,
  supplier_filter TEXT DEFAULT NULL,
  bm25_weight REAL DEFAULT 0.5,
  vector_weight REAL DEFAULT 0.5,
  similarity_threshold REAL DEFAULT 0.3
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
  vector_score REAL,
  ppu DECIMAL,
  standard_unit TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  k CONSTANT REAL := 60.0;  -- RRF constant
BEGIN
  RETURN QUERY
  WITH
  -- Step 1: BM25 Search (Keyword matching)
  bm25_results AS (
    SELECT
      p.id,
      ts_rank(p.search_vector, plainto_tsquery('simple', search_term)) as score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(p.search_vector, plainto_tsquery('simple', search_term)) DESC) as rank
    FROM products p
    WHERE
      (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND p.search_vector @@ plainto_tsquery('simple', search_term)
  ),
  -- Step 2: Vector Search (Semantic similarity)
  vector_results AS (
    SELECT
      p.id,
      (1 - (p.embedding <=> query_embedding)) as score,
      ROW_NUMBER() OVER (ORDER BY p.embedding <=> query_embedding) as rank
    FROM products p
    WHERE
      p.embedding IS NOT NULL
      AND (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND (1 - (p.embedding <=> query_embedding)) > similarity_threshold
  ),
  -- Step 3: Reciprocal Rank Fusion (RRF)
  rrf_scores AS (
    SELECT
      COALESCE(b.id, v.id) as product_id,
      -- RRF Formula: weight * (1 / (k + rank))
      (bm25_weight * COALESCE(1.0 / (k + b.rank::REAL), 0.0) +
       vector_weight * COALESCE(1.0 / (k + v.rank::REAL), 0.0)) as combined_score,
      COALESCE(b.score, 0.0)::REAL as bm25_score,
      COALESCE(v.score, 0.0)::REAL as vector_score
    FROM bm25_results b
    FULL OUTER JOIN vector_results v ON b.id = v.id
  )
  -- Step 4: Return final results
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
    r.vector_score,
    p.ppu,
    p.standard_unit
  FROM rrf_scores r
  JOIN products p ON r.product_id = p.id
  ORDER BY r.combined_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_hybrid_bm25_vector(TEXT, vector, INTEGER, TEXT, REAL, REAL, REAL) IS
'Hybrid Search: BM25 + Vector with Reciprocal Rank Fusion (RRF).
Combines keyword matching (BM25) and semantic similarity (Vector) for balanced accuracy.

Based on: claudedocs/korean_search_production.md
Expected improvement: 15-30% accuracy increase

Parameters:
- search_term: Search query text
- query_embedding: 384-dim embedding vector from query text
- limit_count: Max results (default 10)
- supplier_filter: CJ, SHINSEGAE, or NULL (all suppliers)
- bm25_weight: BM25 weight (0~1, default 0.5)
- vector_weight: Vector weight (0~1, default 0.5)
- similarity_threshold: Minimum cosine similarity (0~1, default 0.3)

Returns:
Products ordered by RRF combined score with individual BM25 and Vector scores.

Example:
SELECT * FROM search_products_hybrid_bm25_vector(
  ''당근'',
  ''[0.1, 0.2, ...]''::vector(384),
  10,
  NULL,
  0.5,
  0.5,
  0.3
);';

-- ========================================
-- Performance Notes
-- ========================================

-- HNSW index settings (already configured in 019_pgvector_setup.sql):
-- - m = 16 (connections per layer)
-- - ef_construction = 64 (build quality)
--
-- Query-time tuning (optional):
-- SET hnsw.ef_search = 100;  -- Higher = more accurate but slower (default: 40)

-- ========================================
-- Testing Queries
-- ========================================

-- Test BM25 + Vector hybrid search
-- SELECT * FROM search_products_hybrid_bm25_vector(
--   '당근',
--   (SELECT embedding FROM products WHERE product_name LIKE '%당근%' LIMIT 1),
--   10,
--   NULL,
--   0.5,
--   0.5,
--   0.3
-- );

-- Test with different weights (BM25 preferred)
-- SELECT * FROM search_products_hybrid_bm25_vector(
--   '당근',
--   (SELECT embedding FROM products WHERE product_name LIKE '%당근%' LIMIT 1),
--   10,
--   NULL,
--   0.7,  -- Higher BM25 weight
--   0.3,  -- Lower vector weight
--   0.3
-- );

-- Test with different weights (Vector preferred)
-- SELECT * FROM search_products_hybrid_bm25_vector(
--   '당근',
--   (SELECT embedding FROM products WHERE product_name LIKE '%당근%' LIMIT 1),
--   10,
--   NULL,
--   0.3,  -- Lower BM25 weight
--   0.7,  -- Higher vector weight
--   0.3
-- );
