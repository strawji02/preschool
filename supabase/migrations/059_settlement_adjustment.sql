-- 059_settlement_adjustment.sql
-- [정산] 품목 단위 조정 (docs/systems/settlement/조정.md §18)
--
-- ★ **왜 원천을 고치지 않는가.** CJ 집계표가 먼저 확정된 뒤에 영업파트너의
-- 본인부담 요청이 온다. 집계표를 매번 재발행받으면 마감이 CJ 일정에 묶이고,
-- 재발행본이 거래명세서와 또 어긋나 교차검증(§5-2)이 깨진다.
--
-- 그래서 원천은 사실 그대로 두고, 조정을 우리 쪽 기록으로 얹는다.
-- "CJ가 이렇게 청구했고, 우리가 이만큼을 뺐다"가 둘 다 남는다.
--
-- 26년 7월 실제 3건:
--   ① 아름솔 7/6 명품 순두부 13,840  정산제외(본인부담)
--   ② 아름솔 7/8 사과 12개 중 9개    방과후간식으로 이동
--   ③ 우성  7/6 백김치 13,270       정산제외(본인부담)

BEGIN;

CREATE TABLE IF NOT EXISTS public.settlement_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 정산월 `YYYY-MM`. 조정은 그 달에만 적용된다.
  period text NOT NULL,

  -- exclude: 유치원 청구에서 뺀다 / move: 식당 간 이동 (사업장 합계 불변)
  kind text NOT NULL,

  -- ── 원천 품목을 가리키는 키 ──
  -- ⚠️ 거래명세서에는 **사업장코드·식당코드가 없다.** 이름만 있어서 이름으로 잡는다.
  -- 26년 7월 실측에서 아래 4개 조합에 중복이 0건이었다 (2,006개 품목).
  business_name text NOT NULL,
  restaurant_name text NOT NULL,
  item_date date NOT NULL,
  product_code text NOT NULL,
  -- 나중에 사람이 목록만 보고 알아볼 수 있게 이름도 함께 남긴다
  product_name text NOT NULL,
  unit text NOT NULL DEFAULT '',

  -- 조정 수량. **소수 허용** — KG 단위 품목이 있다 (26년 7월 46행).
  quantity numeric NOT NULL,

  -- move일 때만. exclude면 NULL.
  target_restaurant_name text,

  -- ── 기록 ──
  -- 왜 뺐는지와 누가 요청했는지는 **필수**다. 이게 없으면 나중에 아무도 설명 못 한다.
  reason text NOT NULL,
  requested_by text NOT NULL,

  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settlement_adjustments
  DROP CONSTRAINT IF EXISTS settlement_adjustments_kind_valid;
ALTER TABLE public.settlement_adjustments
  ADD CONSTRAINT settlement_adjustments_kind_valid
    CHECK (kind IN ('exclude', 'move'));

-- move면 대상 식당이 반드시 있어야 하고, exclude면 없어야 한다.
ALTER TABLE public.settlement_adjustments
  DROP CONSTRAINT IF EXISTS settlement_adjustments_target_valid;
ALTER TABLE public.settlement_adjustments
  ADD CONSTRAINT settlement_adjustments_target_valid
    CHECK (
      (kind = 'move' AND target_restaurant_name IS NOT NULL)
      OR (kind = 'exclude' AND target_restaurant_name IS NULL)
    );

ALTER TABLE public.settlement_adjustments
  DROP CONSTRAINT IF EXISTS settlement_adjustments_quantity_positive;
ALTER TABLE public.settlement_adjustments
  ADD CONSTRAINT settlement_adjustments_quantity_positive
    CHECK (quantity > 0);

-- 분석할 때마다 그 달 조정을 전부 읽는다
CREATE INDEX IF NOT EXISTS settlement_adjustments_period_idx
  ON public.settlement_adjustments (period);

COMMENT ON TABLE public.settlement_adjustments IS
  '품목 단위 조정 (docs §18). 원천은 고치지 않고 우리 쪽 기록으로 얹는다. 단가에서만 뺀다.';
COMMENT ON COLUMN public.settlement_adjustments.quantity IS
  '조정 수량. 소수 허용 — KG 단위 품목이 있다.';
COMMENT ON COLUMN public.settlement_adjustments.target_restaurant_name IS
  'move일 때 옮겨 갈 식당. 그 달에 그 식당 실적이 있어야 한다.';

-- 앱은 service_role로만 접근한다 (다른 정산 테이블과 동일)
ALTER TABLE public.settlement_adjustments ENABLE ROW LEVEL SECURITY;

COMMIT;
