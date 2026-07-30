-- 057_closing_reopen.sql
-- [정산] 마감 해제 이력 (docs §8)
--
-- 마감은 "이 숫자로 세무·지급이 끝났다"는 선언이라 덮어쓸 수 없게 막았다.
-- 그래도 고쳐야 할 때가 온다 — 세무사가 뒤늦게 오류를 찾는 일은 실제로 생긴다.
--
-- 그래서 막지 않고 **해제라는 별도 동작**으로 분리한다: admin만, 사유 필수,
-- 이력에 남는다. 마감 문서가 바뀐 사건이므로 눈에 띄어야 한다.

BEGIN;

-- 리비전이 저장인지 해제인지 구분한다.
-- status만으로는 알 수 없다 — 해제도 confirmed로 기록되기 때문이다.
ALTER TABLE public.settlement_closing_snapshots
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'save'
    CHECK (action IN ('save', 'reopen'));

COMMENT ON COLUMN public.settlement_closing_snapshots.action IS
  'save = 확정·마감 저장 / reopen = 마감 해제. status만으로는 구분되지 않는다.';

-- 해제 횟수를 세어 둔다. 보고서·목록에서 "손댄 적 있는 달"을 바로 알아보게 한다.
ALTER TABLE public.settlement_closings
  ADD COLUMN IF NOT EXISTS reopen_count integer NOT NULL DEFAULT 0
    CHECK (reopen_count >= 0);

COMMENT ON COLUMN public.settlement_closings.reopen_count IS
  '마감 해제 횟수. 0보다 크면 마감 후 수정이 있었다는 뜻이다.';

COMMIT;
