-- 2026-04-23: PDF/이미지 OCR에서 추출한 단위/공급가액/세액 저장 (사용자 요청)
-- 사용자 피드백: "거래명세표 확인" 페이지에서 단위/공급가액/세액 3개 컬럼이 누락되어 있음
-- 엑셀 flow(ExcelPreview)는 이미 이 3개 컬럼을 표시하나, PDF/이미지 flow는 보존하지 않아 미표시
-- 이 마이그레이션으로 PDF/이미지도 엑셀과 동일한 UX로 통일

ALTER TABLE audit_items
  ADD COLUMN IF NOT EXISTS extracted_unit TEXT,
  ADD COLUMN IF NOT EXISTS extracted_supply_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS extracted_tax_amount NUMERIC;

COMMENT ON COLUMN audit_items.extracted_unit IS
  '원본 거래명세표의 단위 (EA, KG, BOX 등) — OCR/엑셀 파싱 시 추출';
COMMENT ON COLUMN audit_items.extracted_supply_amount IS
  '세액 미포함 공급가액 — 거래명세표에 명시된 값 (없으면 NULL, 이 경우 extracted_total_price 또는 unit_price*qty 사용)';
COMMENT ON COLUMN audit_items.extracted_tax_amount IS
  '부가세/세액 — 거래명세표에 명시된 값 (면세 품목은 0, 없으면 NULL)';
