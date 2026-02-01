-- Products 테이블 인덱스
CREATE INDEX idx_products_supplier ON products(supplier);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_unit_normalized ON products(unit_normalized);
CREATE INDEX idx_products_spec_unit ON products(spec_unit);
CREATE INDEX idx_products_name_trgm ON products USING gin (product_name gin_trgm_ops);
CREATE INDEX idx_products_search ON products USING gin (search_vector);
CREATE INDEX idx_products_parse_failed ON products(spec_parse_failed) WHERE spec_parse_failed = true;

-- Audit Sessions 테이블 인덱스
CREATE INDEX idx_audit_sessions_status ON audit_sessions(status);
CREATE INDEX idx_audit_sessions_created ON audit_sessions(created_at DESC);

-- Audit Files 테이블 인덱스
CREATE INDEX idx_audit_files_session ON audit_files(session_id);
CREATE INDEX idx_audit_files_status ON audit_files(ocr_status);

-- Audit Items 테이블 인덱스
CREATE INDEX idx_audit_items_session ON audit_items(session_id);
CREATE INDEX idx_audit_items_matched ON audit_items(matched_product_id);
CREATE INDEX idx_audit_items_status ON audit_items(match_status);
CREATE INDEX idx_audit_items_flagged ON audit_items(is_flagged) WHERE is_flagged = true;
