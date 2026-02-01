-- 단위 매핑 테이블
CREATE TABLE unit_mappings (
  id SERIAL PRIMARY KEY,
  raw_unit TEXT NOT NULL UNIQUE,
  normalized_unit TEXT NOT NULL,
  unit_category TEXT NOT NULL
);

-- 마스터 상품 테이블
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL CHECK (supplier IN ('CJ', 'SHINSEGAE')),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  standard_price INTEGER NOT NULL,
  unit_raw TEXT NOT NULL,
  unit_normalized TEXT NOT NULL,
  spec_raw TEXT,
  spec_quantity DECIMAL(10, 2),
  spec_unit TEXT,
  spec_parse_failed BOOLEAN DEFAULT false,
  category TEXT,
  subcategory TEXT,
  origin TEXT,
  tax_type TEXT CHECK (tax_type IN ('과세', '면세')),
  storage_temp TEXT,
  order_deadline TEXT,
  supply_status TEXT DEFAULT '가능',
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(product_name, ''))
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(supplier, product_code)
);

-- 감사 세션 테이블
CREATE TABLE audit_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  supplier TEXT NOT NULL CHECK (supplier IN ('CJ', 'SHINSEGAE')),
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  total_items INTEGER DEFAULT 0,
  matched_items INTEGER DEFAULT 0,
  pending_items INTEGER DEFAULT 0,
  unmatched_items INTEGER DEFAULT 0,
  total_billed DECIMAL(12, 2) DEFAULT 0,
  total_standard DECIMAL(12, 2) DEFAULT 0,
  total_loss DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 감사 파일 테이블
CREATE TABLE audit_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  page_count INTEGER,
  ocr_status TEXT DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processing', 'completed', 'error')),
  ocr_raw_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 감사 항목 테이블
CREATE TABLE audit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  file_id UUID REFERENCES audit_files(id) ON DELETE SET NULL,
  extracted_name TEXT NOT NULL,
  extracted_spec TEXT,
  extracted_quantity DECIMAL(10, 2) NOT NULL,
  extracted_unit_price DECIMAL(10, 2) NOT NULL,
  extracted_total_price DECIMAL(12, 2),
  matched_product_id UUID REFERENCES products(id),
  match_score DECIMAL(5, 4),
  match_candidates JSONB,
  match_status TEXT DEFAULT 'pending' CHECK (
    match_status IN ('auto_matched', 'pending', 'manual_matched', 'unmatched')
  ),
  standard_price DECIMAL(10, 2),
  price_difference DECIMAL(10, 2),
  loss_amount DECIMAL(12, 2),
  page_number INTEGER,
  row_index INTEGER,
  is_flagged BOOLEAN DEFAULT false,
  user_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
