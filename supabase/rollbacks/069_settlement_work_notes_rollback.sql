-- 긴급 롤백 전용. 저장된 메모가 없는 초기 배포 단계에서만 사용한다.
BEGIN;
DROP TABLE IF EXISTS public.settlement_work_notes;
COMMIT;
