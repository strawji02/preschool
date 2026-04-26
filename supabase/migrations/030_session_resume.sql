-- 2026-04-26: 세션 저장/이어가기 기능 (사용자 요청)
-- "최종 보고서 제출 전까지 단계별 작업을 여러 세션에 걸쳐 진행" 시나리오
-- 매번 거래명세표 재업로드/재OCR 부담을 없애고 DB에 영구 저장된 세션을 불러오기 위함

-- 페이지 수 / 파일 수 / 현재 단계 / 업체명 / 아카이브 플래그 추가
ALTER TABLE audit_sessions
  ADD COLUMN IF NOT EXISTS total_pages INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_files INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT 'image_preview',
  ADD COLUMN IF NOT EXISTS kindergarten_name TEXT,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

COMMENT ON COLUMN audit_sessions.total_pages IS
  '거래명세표 총 페이지 수 (PDF + 이미지 합산). 추가 업로드 시 자동 증가.';
COMMENT ON COLUMN audit_sessions.total_files IS
  '업로드한 원본 파일 수 (audit_items.source_file_name distinct count).';
COMMENT ON COLUMN audit_sessions.current_step IS
  '현재 작업 단계: image_preview | matching | report | completed';
COMMENT ON COLUMN audit_sessions.kindergarten_name IS
  '사용자가 편집한 유치원/업체명 (파일명에서 자동 추출 후 수정 가능).';
COMMENT ON COLUMN audit_sessions.is_archived IS
  '소프트 삭제 플래그. true면 세션 목록에서 숨김. 데이터는 보존.';

-- 세션 목록 조회 시 자주 쓰일 인덱스 (활성 세션 + 최신 정렬)
CREATE INDEX IF NOT EXISTS idx_audit_sessions_active_recent
  ON audit_sessions(updated_at DESC)
  WHERE is_archived = false;
