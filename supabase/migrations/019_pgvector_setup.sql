-- Phase 2: Semantic Search with pgvector
--
-- 목표: 의미 기반 임베딩 검색으로 카테고리 오매칭 해결
-- 예상: 85% → 90-95% 정확도 향상
--
-- 방법:
-- 1. pgvector extension으로 벡터 유사도 검색
-- 2. 384차원 임베딩 (gte-small 또는 multilingual-e5-small)
-- 3. HNSW 인덱스로 빠른 근사 최근접 이웃 검색

-- ========================================
-- 1. pgvector Extension 활성화
-- ========================================

CREATE EXTENSION IF NOT EXISTS vector;

COMMENT ON EXTENSION vector IS
'pgvector: Open-source vector similarity search for PostgreSQL.
Enables semantic search with embeddings.';

-- ========================================
-- 2. products 테이블에 embedding 컬럼 추가
-- ========================================

ALTER TABLE products
ADD COLUMN IF NOT EXISTS embedding vector(384);

COMMENT ON COLUMN products.embedding IS
'Semantic embedding vector (384 dimensions).
Generated from product_name using multilingual embedding model.
Used for semantic similarity search to prevent category mismatches.';

-- ========================================
-- 3. HNSW 인덱스 생성 (빠른 근사 검색)
-- ========================================

-- HNSW (Hierarchical Navigable Small World) 인덱스
-- - 23K 벡터에서 millisecond 검색 속도
-- - m=16: 연결 수 (높을수록 정확, 낮을수록 빠름)
-- - ef_construction=64: 구축 시 탐색 범위 (높을수록 정확한 인덱스)

CREATE INDEX IF NOT EXISTS products_embedding_idx
ON products
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX products_embedding_idx IS
'HNSW index for fast approximate nearest neighbor search.
Uses cosine distance for semantic similarity.
Parameters: m=16 (connections), ef_construction=64 (build quality).';

-- ========================================
-- 4. 벡터 유사도 검색 함수
-- ========================================

CREATE OR REPLACE FUNCTION search_products_vector(
  query_embedding vector(384),
  limit_count INTEGER DEFAULT 5,
  supplier_filter TEXT DEFAULT NULL,
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
  similarity REAL,
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
    -- Cosine similarity (1 - cosine_distance)
    (1 - (p.embedding <=> query_embedding))::REAL as similarity,
    p.ppu,
    p.standard_unit
  FROM products p
  WHERE
    p.embedding IS NOT NULL
    AND (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (1 - (p.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_vector(vector, INTEGER, TEXT, REAL) IS
'Vector similarity search using cosine distance.

Parameters:
- query_embedding: 384-dim embedding vector from query text
- limit_count: Max results (default 5)
- supplier_filter: CJ, SHINSEGAE, or NULL (all)
- similarity_threshold: Minimum cosine similarity (0~1, default 0.3)

Returns products ordered by semantic similarity.
Note: Requires embedding to be generated first.';

-- ========================================
-- 5. Hybrid Search v2 (BM25 + Vector + Trigram)
-- ========================================

CREATE OR REPLACE FUNCTION search_products_hybrid_v2(
  search_term_raw TEXT,
  search_term_clean TEXT DEFAULT NULL,
  query_embedding vector(384) DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
  supplier_filter TEXT DEFAULT NULL,
  bm25_weight REAL DEFAULT 0.3,
  vector_weight REAL DEFAULT 0.5,
  trigram_weight REAL DEFAULT 0.2
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
  trigram_score REAL,
  ppu DECIMAL,
  standard_unit TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  clean_term TEXT;
  k CONSTANT REAL := 60.0;  -- RRF 상수
BEGIN
  clean_term := COALESCE(search_term_clean, search_term_raw);

  RETURN QUERY
  WITH
  -- BM25 검색 (키워드)
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
  -- Vector 검색 (의미)
  vector_results AS (
    SELECT
      p.id,
      (1 - (p.embedding <=> query_embedding)) as score,
      ROW_NUMBER() OVER (ORDER BY p.embedding <=> query_embedding) as rank
    FROM products p
    WHERE
      query_embedding IS NOT NULL
      AND p.embedding IS NOT NULL
      AND (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND (1 - (p.embedding <=> query_embedding)) > 0.3
  ),
  -- Trigram 검색 (글자 유사도)
  trigram_results AS (
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
  -- RRF: Reciprocal Rank Fusion (3가지 방법 결합)
  rrf_scores AS (
    SELECT
      COALESCE(b.id, v.id, t.id) as product_id,
      (
        bm25_weight * COALESCE(1.0 / (k + b.rank::REAL), 0.0) +
        vector_weight * COALESCE(1.0 / (k + v.rank::REAL), 0.0) +
        trigram_weight * COALESCE(1.0 / (k + t.rank::REAL), 0.0)
      )::REAL as combined_score,
      COALESCE(b.score, 0.0)::REAL as bm25_score,
      COALESCE(v.score, 0.0)::REAL as vector_score,
      COALESCE(t.score, 0.0)::REAL as trigram_score
    FROM bm25_results b
    FULL OUTER JOIN vector_results v ON b.id = v.id
    FULL OUTER JOIN trigram_results t ON COALESCE(b.id, v.id) = t.id
  )
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
    r.trigram_score,
    p.ppu,
    p.standard_unit
  FROM rrf_scores r
  JOIN products p ON r.product_id = p.id
  ORDER BY r.combined_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_hybrid_v2(TEXT, TEXT, vector, INTEGER, TEXT, REAL, REAL, REAL) IS
'Hybrid Search v2: BM25 + Vector + Trigram with RRF.

Combines three search methods:
- BM25 (30%): Keyword matching for exact terms
- Vector (50%): Semantic similarity to prevent category mismatches
- Trigram (20%): Character similarity for typos

Parameters:
- search_term_raw: Original query
- search_term_clean: Normalized query
- query_embedding: 384-dim embedding vector (required for vector search)
- limit_count: Max results (default 5)
- supplier_filter: CJ, SHINSEGAE, or NULL
- bm25_weight: BM25 weight (default 0.3)
- vector_weight: Vector weight (default 0.5)
- trigram_weight: Trigram weight (default 0.2)

Example:
SELECT * FROM search_products_hybrid_v2(
  ''프렌치버터롤'',
  ''프렌치버터롤'',
  (SELECT embedding FROM get_query_embedding(''프렌치버터롤'')),
  5, NULL, 0.3, 0.5, 0.2
);';

-- ========================================
-- 6. 임베딩 통계 조회 함수
-- ========================================

CREATE OR REPLACE FUNCTION get_embedding_stats()
RETURNS TABLE (
  total_products BIGINT,
  products_with_embedding BIGINT,
  embedding_coverage_percent NUMERIC,
  avg_vector_length REAL
)
LANGUAGE sql AS $$
  SELECT
    COUNT(*) as total_products,
    COUNT(embedding) as products_with_embedding,
    ROUND((COUNT(embedding)::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 2) as embedding_coverage_percent,
    AVG(vector_dims(embedding))::REAL as avg_vector_length
  FROM products;
$$;

COMMENT ON FUNCTION get_embedding_stats() IS
'Get embedding coverage statistics.
Useful for monitoring embedding generation progress.';

-- ========================================
-- 성능 최적화 설정
-- ========================================

-- ef_search는 쿼리 시점에 SET 명령으로 설정:
-- SET hnsw.ef_search = 40;
-- 기본값: 40, 높을수록 정확하지만 느림 (범위: 1-1000)

-- ========================================
-- 테스트 쿼리 (참고용)
-- ========================================

-- 임베딩 통계 확인
-- SELECT * FROM get_embedding_stats();

-- 벡터 검색 테스트 (임베딩 생성 후)
-- SELECT * FROM search_products_vector(
--   (SELECT embedding FROM products WHERE product_name LIKE '%오렌지%' LIMIT 1),
--   5, NULL, 0.3
-- );

-- Hybrid v2 검색 테스트 (임베딩 생성 후)
-- SELECT * FROM search_products_hybrid_v2(
--   '프렌치버터롤',
--   '프렌치버터롤',
--   NULL,  -- 임베딩은 클라이언트에서 생성 후 전달
--   5, NULL, 0.3, 0.5, 0.2
-- );
