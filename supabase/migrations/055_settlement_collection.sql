-- 055_settlement_collection.sql
-- [정산] 수금·지급 관리 (docs/systems/settlement.md §9, §13-3)
--
-- 발생(청구)과 현금(수금)을 잇는다. 청구액·실지급액은 **마감 스냅샷에서 오고**,
-- 여기에는 입금·지급 기록만 담는다 — 금액을 두 곳에 두면 어긋난다.
--
-- 마감된 달에만 기록할 수 있다 (`period` FK). 마감 전에는 청구액이 확정되지 않아
-- 미수금을 계산할 근거가 없다.

BEGIN;

-- ============================================================
-- 1. 유치원 입금
-- ============================================================
-- 한 유치원이 **여러 번 나눠 입금**할 수 있으므로 (period, 사업장)당 여러 행을 허용한다.
-- 유일 키를 걸면 부분 입금을 기록할 수 없다.
CREATE TABLE IF NOT EXISTS public.settlement_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  period         text NOT NULL,
  source         text NOT NULL CHECK (source IN ('shinsegae', 'cj')),
  business_code  text NOT NULL,

  -- docs §9: 입금일자가 핵심 입력이다
  received_date  date NOT NULL,
  -- 금액도 받는다 — 부분 입금이 실제로 생긴다. 화면은 청구액을 기본값으로 넣는다.
  amount         bigint NOT NULL CHECK (amount <> 0),

  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,

  CONSTRAINT settlement_receipts_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_receipts IS
  '유치원 입금 기록. 청구액은 마감 스냅샷에서 오므로 여기 두지 않는다. RLS default deny.';
COMMENT ON COLUMN public.settlement_receipts.amount IS
  '부분 입금을 지원하려고 금액을 받는다. 여러 행으로 나눠 기록할 수 있다.';

CREATE INDEX IF NOT EXISTS idx_settlement_receipts_period
  ON public.settlement_receipts(period, source, business_code);

ALTER TABLE public.settlement_receipts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 영업자 지급
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settlement_payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  period      text NOT NULL,
  -- 마감 스냅샷의 영업자를 가리킨다. **FK를 걸지 않는다** — 영업자가 삭제돼도
  -- 지급 기록은 남아야 한다 (마감 문서와 같은 이유, §14-8).
  partner_id  uuid NOT NULL,

  paid_date   date NOT NULL,
  amount      bigint NOT NULL CHECK (amount <> 0),

  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,

  CONSTRAINT settlement_payouts_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_payouts IS
  '영업자 지급 기록. 실지급액(U)은 마감 스냅샷에서 온다. RLS default deny.';

CREATE INDEX IF NOT EXISTS idx_settlement_payouts_period
  ON public.settlement_payouts(period, partner_id);

ALTER TABLE public.settlement_payouts ENABLE ROW LEVEL SECURITY;

COMMIT;
