-- 긴급 롤백 전용. 먼저 comparison_proposal_versions를 백업한 뒤 실행한다.
-- migration 065는 기존 운영 테이블을 수정하지 않으므로 일반 장애 대응은 앱 revert가 우선이다.

BEGIN;
DROP FUNCTION IF EXISTS public.record_comparison_proposal_version(
  uuid, text, text, text, text, text, text, jsonb, jsonb, text[], boolean, text, jsonb, uuid, timestamptz
);
DROP TABLE IF EXISTS public.comparison_monthly_report_runs;
DROP TABLE IF EXISTS public.comparison_proposal_versions;
DROP TABLE IF EXISTS public.comparison_proposals;
DROP TABLE IF EXISTS public.comparison_kindergarten_aliases;
DROP TABLE IF EXISTS public.comparison_kindergartens;
COMMIT;
