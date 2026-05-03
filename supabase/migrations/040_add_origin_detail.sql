-- 2026-05-04: 신세계 카탈로그 엑셀의 "원산지상세" 컬럼 추가
-- "외국산"/"국내제조"처럼 모호한 origin일 때 구체적 국가명 (예: "네덜란드, 중국 등")이 들어있음
-- 매칭 품질 향상 + 검수자 정보 강화에 활용

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS origin_detail TEXT;

COMMENT ON COLUMN products.origin_detail IS
  '신세계 엑셀의 "원산지상세" 컬럼 — origin이 모호할 때 구체적 국가명 (예: "호주 등", "네덜란드, 중국 등", "국내산/수입산(필리핀,페루 등)").';

-- 검색 가능하도록 인덱스 (선택적 — 현재 쿼리 패턴에는 불필요. 필요시 추가)
-- CREATE INDEX IF NOT EXISTS idx_products_origin_detail ON products(origin_detail) WHERE origin_detail IS NOT NULL;
