-- 2026-04-23: 1개월치 거래명세표 여러 파일 업로드 지원 (사용자 요청)
-- 사용자 시나리오: 한 업체의 1개월치 거래명세표 14장 사진 + PDF 1-2개를 한번에 업로드하여
-- (1) 페이지별 합계 금액 담당자가 검증, (2) 전체 1개월 합계 금액 담당자가 검증

-- audit_sessions에 페이지별 OCR footer 합계 저장 (페이지 번호 → OCR이 읽은 합계)
-- 예: [{"page": 1, "ocr_total": 324560, "source_file": "photo1.jpg"}, ...]
ALTER TABLE audit_sessions
  ADD COLUMN IF NOT EXISTS page_totals JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN audit_sessions.page_totals IS
  '페이지별 OCR 합계 배열 (거래명세표 하단 footer에서 인식한 총액). 2026-04-23 추가.
   구조: [{"page": 1, "ocr_total": 324560, "source_file": "file.jpg"}, ...]';

-- audit_items에 원본 파일명 컬럼 추가 (여러 파일 업로드 시 행-파일 추적용)
ALTER TABLE audit_items
  ADD COLUMN IF NOT EXISTS source_file_name TEXT;

COMMENT ON COLUMN audit_items.source_file_name IS
  '원본 파일명 (여러 파일 업로드 시 페이지가 속한 파일 추적). 2026-04-23 추가.';
