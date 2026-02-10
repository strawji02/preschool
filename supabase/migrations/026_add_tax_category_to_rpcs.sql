-- Add tax_type and category to RPC function return types
-- This enables VAT normalization in price comparisons

-- ========================================
-- 1. Update search_products_hybrid
-- ========================================
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
BEGIN
  RETURN QUERY
  WITH
  -- Step 1: BM25 Search
  bm25_results AS (
    SELECT
      p.id,
      ts_rank(p.search_vector, plainto_tsquery('simple', search_term_clean)) as score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(p.search_vector, plainto_tsquery('simple', search_term_clean)) DESC) as rank
    FROM products p
    WHERE
      (supplier_filter IS NULL OR p.supplier = supplier_filter)
      AND p.search_vector @@ plainto_tsquery('simple', search_term_clean)
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
       semantic_weight * COALESCE(1.0 / (k + s.rank::REAL), 0.0)) as combined_score,
      COALESCE(b.score, 0.0)::REAL as bm25_score,
      COALESCE(s.score, 0.0)::REAL as semantic_score
    FROM bm25_results b
    FULL OUTER JOIN semantic_results s ON b.id = s.id
  )
  -- Step 4: Return results with new fields
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

-- ========================================
-- 2. Update search_products_fuzzy (Trigram only)
-- ========================================
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term_raw TEXT,
  search_term_clean TEXT,
  limit_count INTEGER DEFAULT 10,
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
  match_score REAL,
  ppu DECIMAL,
  standard_unit TEXT,
  tax_type TEXT,
  category TEXT
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
    similarity(p.product_name, search_term_raw) as match_score,
    p.ppu,
    p.standard_unit,
    p.tax_type,
    p.category
  FROM products p
  WHERE
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND similarity(p.product_name, search_term_raw) > 0.1
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- ========================================
-- 3. Update search_products_bm25
-- ========================================
CREATE OR REPLACE FUNCTION search_products_bm25(
  search_term TEXT,
  limit_count INTEGER DEFAULT 10,
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
  match_score REAL,
  ppu DECIMAL,
  standard_unit TEXT,
  tax_type TEXT,
  category TEXT
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
    ts_rank(p.search_vector, plainto_tsquery('simple', search_term)) as match_score,
    p.ppu,
    p.standard_unit,
    p.tax_type,
    p.category
  FROM products p
  WHERE
    (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND p.search_vector @@ plainto_tsquery('simple', search_term)
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- ========================================
-- 4. Update search_products_vector
-- ========================================
CREATE OR REPLACE FUNCTION search_products_vector(
  query_embedding vector(384),
  limit_count INTEGER DEFAULT 10,
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
  standard_unit TEXT,
  tax_type TEXT,
  category TEXT
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
    (1 - (p.embedding <=> query_embedding))::REAL as similarity,
    p.ppu,
    p.standard_unit,
    p.tax_type,
    p.category
  FROM products p
  WHERE
    p.embedding IS NOT NULL
    AND (supplier_filter IS NULL OR p.supplier = supplier_filter)
    AND (1 - (p.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;

-- Comments
COMMENT ON FUNCTION search_products_hybrid IS 'Hybrid search with tax_type and category for VAT normalization and unit conversion';
COMMENT ON FUNCTION search_products_fuzzy IS 'Trigram search with tax_type and category';
COMMENT ON FUNCTION search_products_bm25 IS 'BM25 search with tax_type and category';
COMMENT ON FUNCTION search_products_vector IS 'Vector semantic search with tax_type and category';
