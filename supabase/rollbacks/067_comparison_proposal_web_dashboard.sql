-- 앱을 먼저 직전 커밋으로 되돌린 뒤 실행한다. 기존 제안서 이력은 건드리지 않는다.

BEGIN;
DROP TABLE IF EXISTS public.comparison_proposal_dashboard_settings;
COMMIT;
