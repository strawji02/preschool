-- 신세계 매월 단가 동기화 지원 컬럼 (2026-05-09)
--
-- 목적: 매월 신세계 단가표 엑셀 UPSERT 시 가격 변경 추적, 단종 마킹, 협력사 정보 보존.
--
-- 원칙:
--  - audit_items의 standard_price는 명세표 작성 시점 스냅샷 → 자동 업데이트 X
--  - 새 매칭은 is_active=true 만, 단종 품목은 검색 결과에서 제외
--  - previous_price는 내부 데이터 (UI 노출은 추후 결정)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS previous_price NUMERIC,        -- 종전단가 (이전 변경 전 가격)
  ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ,  -- 가격 변경 시점
  ADD COLUMN IF NOT EXISTS supplier_partner TEXT,         -- 협력사 (예: "주식회사명천")
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,-- 단종 여부 (false=이번 동기화에 누락된 품목)
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;    -- 마지막 신세계 엑셀 동기화 시점

COMMENT ON COLUMN products.previous_price IS '종전단가 — 가격 변경 추적용 (마지막 변경 직전 가격)';
COMMENT ON COLUMN products.price_changed_at IS '가격 변경 시점';
COMMENT ON COLUMN products.supplier_partner IS '협력사 (신세계 단가표 협력사 컬럼)';
COMMENT ON COLUMN products.is_active IS '단종 여부 — false면 검색 결과 제외 (신규 매칭 차단)';
COMMENT ON COLUMN products.last_synced_at IS '마지막 신세계 엑셀 동기화 시점 — 단종 후보 식별용';

-- is_active 인덱스 (검색 시 필터 효율)
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE supplier = 'SHINSEGAE';
