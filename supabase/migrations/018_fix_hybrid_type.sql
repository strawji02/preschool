-- Fix type mismatch in hybrid search function
-- Change DOUBLE PRECISION to REAL for match_score

DROP FUNCTION IF EXISTS search_products_hybrid(TEXT, TEXT, INTEGER, TEXT, REAL, REAL);

CREATE OR REPLACE FUNCTION search_products_hybrid(
  search_term_raw TEXT,
  search_term_clean TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5,
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
  standard_unit TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
  clean_term TEXT;
  k CONSTANT REAL := 60.0;
BEGIN
  clean_term := COALESCE(search_term_clean, search_term_raw);

  RETURN QUERY
  WITH
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
    p.standard_unit
  FROM rrf_scores r
  JOIN products p ON r.product_id = p.id
  ORDER BY r.combined_score DESC
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_products_hybrid(TEXT, TEXT, INTEGER, TEXT, REAL, REAL) IS
'Hybrid Search with Reciprocal Rank Fusion (RRF) - Type fixed version.
Combines BM25 (keyword) + Trigram (semantic) for balanced accuracy.';
