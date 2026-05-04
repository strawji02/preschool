-- 검수자 의견 컬럼 추가 (2026-05-04)
-- - 검수자가 매칭 카드 하단에 작성한 의견 저장
-- - AI 학습 데이터로 활용 (동일 품목 반복 시 우선순위 보정)
ALTER TABLE audit_items ADD COLUMN IF NOT EXISTS reviewer_note TEXT;

COMMENT ON COLUMN audit_items.reviewer_note IS '검수자 의견 (AI 학습용)';
