-- 신세계 월별 단가표 (docs/systems/settlement/단가표.md §21)
--
-- 신세계가 **매달 10일 전에** 보내는 품목 카탈로그. 26년 6월 7,798개.
--
-- ★ 왜 파일이 아니라 테이블인가 (원천보관 §20과 다르다)
--   원천은 정산이 통째로 읽어서 파일 + 매번 파싱이 맞았다 (1~2ms).
--   단가표는 **품목코드로 단건 조회**하고 **어느 달이 있는지** 알아야 한다.
--   읽기가 0.24~0.41초라 매 요청마다 파싱하기엔 아깝다.
--   연 12개월 × 7,800행 = 9만 4천 행 — 작다.
--
-- ★ 무엇에 쓰나
--   1. 원산지 — 우리 원천에 없어 거래명세표 열을 비워 뒀다 (§19). 이제 채운다.
--   2. 결정단가 = 우리 원가. 26년 6월 실측에서 원천 납품단가와 523/523 일치.
--      원천이 이상한지 교차검증할 수 있다.

CREATE TABLE IF NOT EXISTS public.shinsegae_price_book (
  id bigserial PRIMARY KEY,
  -- 어느 달 단가표인가 (`YYYY-MM`)
  period text NOT NULL,
  -- 6자리 0채움. ⚠️ 엑셀이 `017392`를 숫자로 주는 일이 있어 저장 전에 맞춘다
  product_code text NOT NULL,
  product_name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  item_group text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '',
  -- ★ 거래명세표의 원산지 열을 채우는 값
  origin text NOT NULL DEFAULT '',
  spec text NOT NULL DEFAULT '',
  -- 지난달 결정단가. 연월 오선택을 잡는 근거다
  previous_price numeric NOT NULL DEFAULT 0,
  -- 이번 달 확정 원가
  price numeric NOT NULL DEFAULT 0,
  delta_rate numeric NOT NULL DEFAULT 0,
  tax_kind text NOT NULL DEFAULT 'exempt',
  supplier text NOT NULL DEFAULT '',
  order_cutoff text NOT NULL DEFAULT '',
  uploaded_by text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shinsegae_price_book
  DROP CONSTRAINT IF EXISTS shinsegae_price_book_tax_valid;
ALTER TABLE public.shinsegae_price_book
  ADD CONSTRAINT shinsegae_price_book_tax_valid
    CHECK (tax_kind IN ('taxable', 'exempt'));

-- 한 달에 같은 품목이 둘일 수 없다. 다시 올리면 그 달을 통째로 갈아끼운다.
CREATE UNIQUE INDEX IF NOT EXISTS shinsegae_price_book_uniq
  ON public.shinsegae_price_book (period, product_code);

-- 거래명세표를 만들 때 `그 달 × 품목코드`로 찾는다
CREATE INDEX IF NOT EXISTS shinsegae_price_book_lookup
  ON public.shinsegae_price_book (period, product_code)
  INCLUDE (origin, price);

-- 화면이 "어느 달이 있나"를 물어본다
CREATE INDEX IF NOT EXISTS shinsegae_price_book_period
  ON public.shinsegae_price_book (period);

ALTER TABLE public.shinsegae_price_book ENABLE ROW LEVEL SECURITY;

-- service_role만 읽고 쓴다. 화면은 API를 거친다 (docs/SECURITY.md)
DROP POLICY IF EXISTS shinsegae_price_book_service ON public.shinsegae_price_book;
CREATE POLICY shinsegae_price_book_service
  ON public.shinsegae_price_book
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 화면은 "어느 달이 있고 몇 건인가"만 묻는다.
-- 이걸 앱에서 세면 9만 행을 통째로 읽어야 한다 — 집계는 DB가 한다.
CREATE OR REPLACE VIEW public.shinsegae_price_book_periods AS
SELECT
  period,
  count(*)::bigint                                   AS item_count,
  count(*) FILTER (WHERE origin <> '')::bigint       AS origin_count,
  max(uploaded_at)                                   AS uploaded_at,
  max(uploaded_by)                                   AS uploaded_by
FROM public.shinsegae_price_book
GROUP BY period;
