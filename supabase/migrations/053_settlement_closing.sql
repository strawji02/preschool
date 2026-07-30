-- 053_settlement_closing.sql
-- [정산] 월 마감 + 스냅샷 (docs/systems/settlement.md §8, §14-1)
--
-- ★ 절대 원칙: **과거 정산은 바뀌지 않는다.**
-- 지난달 내역서를 다시 뽑았을 때 담당자나 금액이 달라지면 지급 근거와 세무 문서가
-- 흔들린다. 그래서 마감 시점의 상태를 통째로 굳혀 둔다.
--
-- 구조가 두 층인 이유
--   1. `settlement_closing_snapshots` — **append-only 이력.** 그때의 전체 상태를
--      jsonb로 굳힌다. 재현이 목적이므로 스키마가 변해도 읽을 수 있어야 한다.
--   2. `settlement_closing_venues` / `_partners` — **질의용 flat facts.**
--      경영 보고서(§13)가 월별·유치원별·영업자별로 훑어야 하므로 정규 컬럼이 필요하다.
--      현재 리비전만 담고, 재저장 시 교체된다. 이력은 위 jsonb가 갖는다.

BEGIN;

-- ============================================================
-- 1. 마감 상태
-- ============================================================
-- 상태는 영어로 둔다 (docs의 `작성중 → 확정 → 마감`에 대응).
-- 코드에서 한글 문자열을 비교하면 인코딩 사고가 나기 쉽다.
CREATE TABLE IF NOT EXISTS public.settlement_closings (
  -- `YYYY-MM`. `26년6월` 같은 표기는 연도가 애매해서 받지 않는다 (앱: isValidPeriod)
  period          text PRIMARY KEY CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  status          text NOT NULL CHECK (status IN ('draft', 'confirmed', 'closed')),

  -- 재저장할 때마다 1 증가. 스냅샷 이력의 최신 번호와 같다.
  revision        integer NOT NULL DEFAULT 1 CHECK (revision >= 1),

  -- ── 헤드라인 숫자 (경영 보고서 목록용, docs §13) ──
  -- jsonb를 파싱하지 않고 월별 추이를 뽑을 수 있어야 한다.
  revenue            bigint NOT NULL DEFAULT 0,
  cost_of_sales      bigint NOT NULL DEFAULT 0,
  marketing_cost     bigint NOT NULL DEFAULT 0,
  gross_margin       bigint NOT NULL DEFAULT 0,
  platform_fee       bigint NOT NULL DEFAULT 0,
  vat_diff           bigint NOT NULL DEFAULT 0,
  business_deduction bigint NOT NULL DEFAULT 0,
  partner_pre_tax    bigint NOT NULL DEFAULT 0,
  withholding        bigint NOT NULL DEFAULT 0,
  partner_net_pay    bigint NOT NULL DEFAULT 0,
  declared           bigint NOT NULL DEFAULT 0,
  hq_share           bigint NOT NULL DEFAULT 0,
  operating_profit   bigint NOT NULL DEFAULT 0,
  sales_vat          bigint NOT NULL DEFAULT 0,
  purchase_vat       bigint NOT NULL DEFAULT 0,
  vat_payable        bigint NOT NULL DEFAULT 0,

  confirmed_at    timestamptz,
  confirmed_by    text,
  closed_at       timestamptz,
  closed_by       text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- 마감 상태면 언제·누가 마감했는지 반드시 남는다.
  -- 이력 없는 마감은 나중에 "정말 마감된 건가"를 답할 수 없다.
  CONSTRAINT settlement_closings_closed_has_who
    CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL))
);

COMMENT ON TABLE public.settlement_closings IS
  '월 마감 상태 + 헤드라인 합계. period = YYYY-MM. RLS default deny.';
COMMENT ON COLUMN public.settlement_closings.status IS
  'draft(작성중) / confirmed(확정) / closed(마감). docs §8';
COMMENT ON COLUMN public.settlement_closings.revision IS
  '재저장 횟수. settlement_closing_snapshots의 최신 revision과 같다.';

ALTER TABLE public.settlement_closings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 스냅샷 이력 (append-only)
-- ============================================================
-- **절대 UPDATE/DELETE 하지 않는다.** 마감 후 수정도 새 리비전을 쌓는 방식이다
-- (docs §8: 마감 후에도 수정 가능하되 이력을 남긴다).
CREATE TABLE IF NOT EXISTS public.settlement_closing_snapshots (
  period      text NOT NULL,
  revision    integer NOT NULL CHECK (revision >= 1),

  -- 그때의 전체 상태. 정산 결과·공제 입력·분할 신고·계산서 행까지 담는다.
  -- 정규화하지 않는 이유: 재현이 목적이고, 스키마가 바뀌어도 과거 리비전을
  -- 그대로 읽을 수 있어야 한다.
  snapshot    jsonb NOT NULL,

  status      text NOT NULL CHECK (status IN ('draft', 'confirmed', 'closed')),
  -- 왜 다시 저장했는지. 마감 후 수정이면 특히 중요하다.
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,

  CONSTRAINT settlement_closing_snapshots_pk PRIMARY KEY (period, revision),
  CONSTRAINT settlement_closing_snapshots_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_closing_snapshots IS
  '마감 스냅샷 이력. **append-only** — 수정·삭제하지 않는다 (docs §8).';

ALTER TABLE public.settlement_closing_snapshots ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. 식당 단위 facts (경영 보고서용)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settlement_closing_venues (
  period           text NOT NULL,
  source           text NOT NULL CHECK (source IN ('shinsegae', 'cj')),
  business_code    text NOT NULL,
  business_name    text NOT NULL,
  restaurant_code  text NOT NULL,
  restaurant_name  text NOT NULL,

  -- 그때의 담당 영업자. **이름을 함께 굳힌다** — 나중에 이름이 바뀌거나
  -- 영업자가 삭제돼도 마감 문서는 그대로여야 한다. 그래서 FK를 걸지 않는다.
  partner_id       uuid,
  partner_name     text,

  is_excluded      boolean NOT NULL DEFAULT false,
  exclusion_reason text,

  cost_supply      bigint NOT NULL DEFAULT 0,
  cost_vat         bigint NOT NULL DEFAULT 0,
  cost_exempt      bigint NOT NULL DEFAULT 0,
  cost_total       bigint NOT NULL DEFAULT 0,
  price_supply     bigint NOT NULL DEFAULT 0,
  price_vat        bigint NOT NULL DEFAULT 0,
  price_exempt     bigint NOT NULL DEFAULT 0,
  price_total      bigint NOT NULL DEFAULT 0,

  CONSTRAINT settlement_closing_venues_pk
    PRIMARY KEY (period, source, business_code, restaurant_code),
  CONSTRAINT settlement_closing_venues_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_closing_venues IS
  '마감 월의 식당 단위 확정값. 현재 리비전만 담는다 (이력은 snapshots).';
COMMENT ON COLUMN public.settlement_closing_venues.partner_name IS
  '그때의 영업자 이름. 이름이 바뀌어도 마감 문서는 그대로여야 하므로 함께 굳힌다.';

CREATE INDEX IF NOT EXISTS idx_settlement_closing_venues_partner
  ON public.settlement_closing_venues(period, partner_id);

ALTER TABLE public.settlement_closing_venues ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. 영업자 단위 facts (산식 결과를 굳힌다)
-- ============================================================
-- 수수료율·유형이 나중에 바뀌어도 마감된 달의 산식 결과는 변하지 않아야 한다.
CREATE TABLE IF NOT EXISTS public.settlement_closing_partners (
  period             text NOT NULL,
  partner_id         uuid NOT NULL,
  partner_name       text NOT NULL,
  partner_type       text NOT NULL CHECK (partner_type IN ('cofounder', 'partner')),
  commission_percent numeric(5,2) NOT NULL,

  cost_total         bigint NOT NULL DEFAULT 0,
  cost_vat           bigint NOT NULL DEFAULT 0,
  price_total        bigint NOT NULL DEFAULT 0,
  price_vat          bigint NOT NULL DEFAULT 0,

  -- docs §3 산식 결과
  margin             bigint NOT NULL DEFAULT 0,  -- M
  platform_fee       bigint NOT NULL DEFAULT 0,  -- O
  vat_diff           bigint NOT NULL DEFAULT 0,  -- P
  business_deduction bigint NOT NULL DEFAULT 0,  -- Q
  pre_tax            bigint NOT NULL DEFAULT 0,  -- R
  declared           bigint NOT NULL DEFAULT 0,  -- V
  income_tax         bigint NOT NULL DEFAULT 0,  -- S
  local_tax          bigint NOT NULL DEFAULT 0,  -- T
  net_pay            bigint NOT NULL DEFAULT 0,  -- U

  CONSTRAINT settlement_closing_partners_pk PRIMARY KEY (period, partner_id),
  CONSTRAINT settlement_closing_partners_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_closing_partners IS
  '마감 월의 영업자별 산식 결과. 수수료율·유형이 바뀌어도 이 값은 변하지 않는다.';

ALTER TABLE public.settlement_closing_partners ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. updated_at 자동 갱신
-- ============================================================
DROP TRIGGER IF EXISTS trg_settlement_closings_touch ON public.settlement_closings;
CREATE TRIGGER trg_settlement_closings_touch
  BEFORE UPDATE ON public.settlement_closings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;
