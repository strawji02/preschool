-- Fuzzy Matching RPC 함수
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_term TEXT,
  supplier_filter TEXT,
  limit_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  product_name TEXT,
  standard_price INTEGER,
  unit_normalized TEXT,
  spec_quantity DECIMAL,
  spec_unit TEXT,
  match_score REAL
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
    similarity(p.product_name, search_term) as match_score
  FROM products p
  WHERE
    p.supplier = supplier_filter
    AND similarity(p.product_name, search_term) > 0.1
  ORDER BY match_score DESC
  LIMIT limit_count;
END;
$$;

-- 세션 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_session_stats(session_uuid UUID)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE audit_sessions
  SET
    total_items = (
      SELECT COUNT(*) FROM audit_items WHERE session_id = session_uuid
    ),
    matched_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'auto_matched'
    ),
    pending_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'pending'
    ),
    unmatched_items = (
      SELECT COUNT(*) FROM audit_items
      WHERE session_id = session_uuid AND match_status = 'unmatched'
    ),
    total_billed = (
      SELECT COALESCE(SUM(extracted_unit_price * extracted_quantity), 0)
      FROM audit_items WHERE session_id = session_uuid
    ),
    total_standard = (
      SELECT COALESCE(SUM(standard_price * extracted_quantity), 0)
      FROM audit_items
      WHERE session_id = session_uuid AND matched_product_id IS NOT NULL
    ),
    total_loss = (
      SELECT COALESCE(SUM(loss_amount), 0)
      FROM audit_items
      WHERE session_id = session_uuid AND loss_amount > 0
    ),
    updated_at = now()
  WHERE id = session_uuid;
END;
$$;
