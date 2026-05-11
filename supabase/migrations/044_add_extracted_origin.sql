-- 044_add_extracted_origin.sql (2026-05-11)
--
-- 거래명세표 OCR 시 원산지를 spec과 별도 필드로 추출 → 매칭 정확도 향상
-- 다양한 거래명세표 형식 대응 (별도 D열 / spec 합쳐짐 / name 안 / 누락)

ALTER TABLE audit_items
  ADD COLUMN IF NOT EXISTS extracted_origin TEXT DEFAULT NULL;

COMMENT ON COLUMN audit_items.extracted_origin IS
  '거래명세표 OCR 시 추출된 원산지 raw 텍스트. 예: "캐나다", "국내산", "한국Wn※국내산", "호주산". 정규화는 token-match.normalizeOrigin 사용. NULL=OCR 누락.';
