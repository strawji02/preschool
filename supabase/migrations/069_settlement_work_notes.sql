-- 069_settlement_work_notes.sql
-- [정산] 월별 상시 메모 체크리스트
--
-- 메모는 금액을 자동 변경하지 않는다. 담당자가 정산 순서 중 직접 반영한 뒤
-- 반영/미반영 여부만 확인한다. RLS default deny로 서버 경로에서만 접근한다.

BEGIN;

CREATE TABLE public.settlement_work_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period        text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  target_type   text NOT NULL
                CHECK (target_type IN ('supplier', 'partner', 'venue', 'other')),
  target_key    text NOT NULL CHECK (btrim(target_key) <> ''),
  target_label  text NOT NULL CHECK (btrim(target_label) <> ''),
  memo          text NOT NULL CHECK (btrim(memo) <> '' AND char_length(memo) <= 2000),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'applied', 'not_applied')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text NOT NULL,
  resolved_at   timestamptz,
  resolved_by   text,
  CONSTRAINT settlement_work_notes_resolution_audit CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR
    (status IN ('applied', 'not_applied') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX settlement_work_notes_period_status_idx
  ON public.settlement_work_notes(period, status, created_at);

ALTER TABLE public.settlement_work_notes ENABLE ROW LEVEL SECURITY;

COMMIT;
