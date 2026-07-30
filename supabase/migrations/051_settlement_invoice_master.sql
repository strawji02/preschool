-- 051_settlement_invoice_master.sql
-- [정산] 홈택스 계산서 발행 마스터 (docs/systems/settlement.md §6-1, §14-8)
--
-- 세금계산서/계산서를 만들려면 두 가지가 더 필요하다:
--   1. 유치원의 사업자 정보 (상호·대표자·주소·업태·종목·이메일)
--   2. 식당 × 과세구분 → **품목명**
--
-- 왜 품목명을 저장해야 하나: 식당명에서 기계적으로 나오지 않는다.
--   `키즈웰에듀푸드(젬마유치원_수익자)` → `급식재료(수익자)`
--   `국제유치원(키즈웰) 행사`          → `행사용`
--   `키즈웰에듀푸드(선경유치원)`        → `급식재료` (접미사가 아예 없다)
--
-- 개인정보 방침(§7) 그대로: **주민번호는 저장하지 않는다.** 계산서 발행에 필요한
-- 항목까지만 둔다.

BEGIN;

-- ============================================================
-- 1. 유치원(사업장) — 계산서 발행 정보 보강
-- ============================================================
-- 050에 biz_reg_no / ceo_name / address / email 이 이미 있고, 홈택스 양식이
-- 요구하는 나머지를 채운다.
ALTER TABLE public.settlement_venues
  -- ⚠️ 원천의 `business_name`(예: `키즈웰에듀푸드(해밀유치원)`)과 계산서 상호
  -- (`해밀유치원`)는 **다르다.** 계산서에 찍히는 것은 이 컬럼이다.
  ADD COLUMN IF NOT EXISTS company_name     text,
  ADD COLUMN IF NOT EXISTS biz_type         text,
  ADD COLUMN IF NOT EXISTS biz_item         text,
  ADD COLUMN IF NOT EXISTS email2           text,
  -- 왜 제외했는지 남긴다. 26년 6월 본사 = 마케팅비 (§13-4).
  -- 사유 없이 제외만 되어 있으면 다음 담당자가 실수로 되살린다.
  ADD COLUMN IF NOT EXISTS exclusion_reason text;

COMMENT ON COLUMN public.settlement_venues.company_name IS
  '계산서에 찍히는 상호. 원천 business_name과 다르다 (해밀유치원 vs 키즈웰에듀푸드(해밀유치원)).';
COMMENT ON COLUMN public.settlement_venues.biz_reg_no IS
  '사업자등록번호 10자리(하이픈 없음). 체크섬 검증은 앱에서 한다 — isValidBizRegNo.';
COMMENT ON COLUMN public.settlement_venues.exclusion_reason IS
  'is_excluded = true인 이유. 예: 마케팅비(본사).';

-- 하이픈·공백이 섞여 들어오면 홈택스 업로드가 실패한다. 형식은 DB에서 막고,
-- 체크섬은 앱에서 검증한다 (SQL로 옮기면 유지보수가 어렵다).
ALTER TABLE public.settlement_venues
  DROP CONSTRAINT IF EXISTS settlement_venues_biz_reg_no_format;
ALTER TABLE public.settlement_venues
  ADD CONSTRAINT settlement_venues_biz_reg_no_format
    CHECK (biz_reg_no IS NULL OR biz_reg_no ~ '^[0-9]{10}$');

-- ============================================================
-- 2. 계산서 공급자(본사) — 단일 행
-- ============================================================
-- 공급자는 항상 우리 회사다. `settlement_venues`의 본사 행을 재활용하지 않는 이유:
-- 그쪽은 **매입처(공급받는자)** 를 담는 테이블이라 의미가 섞인다.
CREATE TABLE IF NOT EXISTS public.settlement_issuer (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  biz_reg_no   text NOT NULL CHECK (biz_reg_no ~ '^[0-9]{10}$'),
  company_name text NOT NULL,
  ceo_name     text NOT NULL,
  address      text NOT NULL,
  biz_type     text NOT NULL,
  biz_item     text NOT NULL,
  email        text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.settlement_issuer IS
  '계산서 공급자(본사). id = 1 단일 행. RLS default deny.';

ALTER TABLE public.settlement_issuer ENABLE ROW LEVEL SECURITY;

INSERT INTO public.settlement_issuer
  (id, biz_reg_no, company_name, ceo_name, address, biz_type, biz_item, email)
VALUES (
  1,
  '8310503575',
  '키즈웰에듀푸드',
  '김중영',
  '서울특별시 송파구 충민로66, 8층F8101호',
  '도매 및 소매업',
  '교재',
  'kidswellfood@naver.com'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. 식당 × 과세구분 → 품목명
-- ============================================================
-- ⚠️ **tax_kind가 키에 들어가는 이유**: 같은 식당이 과세·면세에서 품목명이 다를 수 있다.
-- 26년 6월 실측 — 나래유치원 식당 `원아급간식`:
--   과세 663,300 → 품목 `원아급간식`
--   면세 2,678,031 → 품목 `급식재료`
-- 하나로 합치면 계산서 품목명이 틀린다.
CREATE TABLE IF NOT EXISTS public.settlement_venue_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source            text NOT NULL CHECK (source IN ('shinsegae', 'cj')),
  business_code     text NOT NULL,
  restaurant_code   text NOT NULL,
  -- 원천의 식당명. 매칭 키가 아니라 사람이 확인하는 용도다
  -- (원천에서 이름이 바뀌어도 코드가 같으면 같은 식당으로 본다).
  restaurant_name   text NOT NULL,

  tax_kind          text NOT NULL CHECK (tax_kind IN ('taxable', 'exempt')),

  -- 홈택스 `품목1`에 그대로 들어간다. 빈 문자열은 허용하지 않는다 —
  -- 미지정은 행이 없는 것으로 표현하고, 그게 마감 차단 사유가 된다 (§14-2).
  invoice_item_name text NOT NULL CHECK (btrim(invoice_item_name) <> ''),

  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT settlement_venue_items_key_unique
    UNIQUE (source, business_code, restaurant_code, tax_kind),

  CONSTRAINT settlement_venue_items_venue_fk
    FOREIGN KEY (source, business_code)
    REFERENCES public.settlement_venues(source, business_code)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.settlement_venue_items IS
  '식당×과세구분 → 홈택스 품목명. 행이 없으면 미지정 = 마감 차단 (docs §14-2).';
COMMENT ON COLUMN public.settlement_venue_items.tax_kind IS
  '같은 식당이 과세·면세에서 품목명이 다를 수 있어 키에 포함한다 (나래유치원 사례).';

CREATE INDEX IF NOT EXISTS idx_settlement_venue_items_venue
  ON public.settlement_venue_items(source, business_code);

ALTER TABLE public.settlement_venue_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_settlement_venue_items_touch ON public.settlement_venue_items;
CREATE TRIGGER trg_settlement_venue_items_touch
  BEFORE UPDATE ON public.settlement_venue_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_settlement_issuer_touch ON public.settlement_issuer;
CREATE TRIGGER trg_settlement_issuer_touch
  BEFORE UPDATE ON public.settlement_issuer
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 4. 시드는 052에서 (자동 생성)
-- ============================================================
-- 유치원 사업자 정보와 식당 품목명은 손으로 옮기지 않는다.
-- 주소·식당코드를 사람이 베끼면 틀린다 (실제로 틀렸다 — 주소 9곳, 식당코드 다수).
-- `scripts/generate-invoice-seed.ts`가 052 파일을 직접 생성한다.

COMMIT;
