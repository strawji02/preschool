-- 058_invoice_rounding.sql
-- [정산] 계산서 원단위 절사 (docs/systems/settlement.md §6-2)
--
-- 일부 유치원은 **계산서 총액을 10원 단위로** 받는다. 원 단위가 남으면 회계
-- 처리에서 걸린다는 요청이다 (26년 7월 — 해밀·나래).
--
-- 유치원별 플래그로 두는 이유: 나중에 다른 곳이 추가돼도 **코드를 안 고친다.**
-- 특정 유치원 이름을 코드에 박으면 요청이 올 때마다 배포해야 한다.

BEGIN;

-- ============================================================
-- 1. 유치원별 절사 여부
-- ============================================================
ALTER TABLE public.settlement_venues
  ADD COLUMN IF NOT EXISTS invoice_round_down boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.settlement_venues.invoice_round_down IS
  '계산서 총액을 10원 단위로 절사한다 (docs §6-2). 계산서 한 장씩 각각 적용.';

-- ============================================================
-- 2. 절사 방식 — 차액을 어디서 뺄지
-- ============================================================
-- ★ **세무사 협의로 바뀔 수 있다.** 그래서 코드가 아니라 설정에 둔다.
--
--   vat    — 세액에서 뺀다 (2026-07-31 기준). 공급가는 실제 거래금액이라
--            건드리지 않는다. 대신 `세액 = 공급가 × 10%`가 몇 원 어긋난다.
--   supply — 공급가에서 뺀다. 세액 산식은 맞지만 거래금액이 달라진다.
--
-- 어느 쪽이든 `공급가 + 세액 = 총액`은 반드시 성립한다 (앱에서 보장).
-- 여기가 깨지면 홈택스 업로드가 통째로 반려된다.
ALTER TABLE public.settlement_issuer
  ADD COLUMN IF NOT EXISTS invoice_rounding_mode text NOT NULL DEFAULT 'vat';

ALTER TABLE public.settlement_issuer
  DROP CONSTRAINT IF EXISTS settlement_issuer_rounding_mode_valid;
ALTER TABLE public.settlement_issuer
  ADD CONSTRAINT settlement_issuer_rounding_mode_valid
    CHECK (invoice_rounding_mode IN ('vat', 'supply'));

COMMENT ON COLUMN public.settlement_issuer.invoice_rounding_mode IS
  '원단위 절사 차액을 어디서 뺄지: vat(세액) | supply(공급가). 세무사 협의로 변경 가능.';

-- ============================================================
-- 3. 시드 — 26년 7월 요청분
-- ============================================================
-- 코드로 지정한다. 상호는 바뀔 수 있지만 원천 코드는 안 바뀐다.
UPDATE public.settlement_venues
   SET invoice_round_down = true,
       updated_at = now()
 WHERE (source = 'cj'        AND business_code = '1005')   -- 해밀유치원
    OR (source = 'shinsegae' AND business_code = '89912'); -- 나래유치원

COMMIT;
