-- 2026-04-21: 비교 제외 플래그 추가 (Susan 피드백 반영)
-- 미매칭 품목 또는 담당자가 수동으로 제외한 품목을 보고서 절감액 계산에서 스킵하기 위함
-- 제외된 품목은 보고서 하단에 "비교 불가 품목" 별지로 표시됨

ALTER TABLE audit_items
  ADD COLUMN IF NOT EXISTS is_excluded BOOLEAN DEFAULT false;

-- 부분 인덱스: 제외된 품목이 소수일 것으로 예상되므로 WHERE 조건부 인덱스로 효율화
CREATE INDEX IF NOT EXISTS idx_audit_items_excluded
  ON audit_items(is_excluded)
  WHERE is_excluded = true;

COMMENT ON COLUMN audit_items.is_excluded IS
  '담당자가 보고서 비교에서 제외로 마크한 품목 (매칭 없음 + 수동 제외)';
