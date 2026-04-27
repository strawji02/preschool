-- 2026-04-27: 제안서 부가서비스 데이터 저장 (사용자 요청)
-- 보고서 단계에서 검수자가 체크한 부가서비스 항목 + 자유 입력 텍스트를 세션별로 보관
-- 구조: { items: [{ key, label, checked, note }], proposed_to: '교재지사 유치원', ... }

ALTER TABLE audit_sessions
  ADD COLUMN IF NOT EXISTS proposal_extras JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN audit_sessions.proposal_extras IS
  '보고서 부가서비스 + 메타데이터. 예시:
   { "items": [{ "key": "snack", "label": "원아 간식", "checked": true, "note": "월 2회" }],
     "proposed_to": "교재지사 유치원",
     "based_on_period": "2024년 8월" }
   2026-04-27 추가.';
