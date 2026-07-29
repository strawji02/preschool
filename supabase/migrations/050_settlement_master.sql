-- 050_settlement_master.sql
-- [정산] 마스터 데이터 — 영업자 / 유치원(사업장)
--
-- docs/systems/settlement.md §10
--
-- 개인정보 방침 (§7): **주민번호는 저장하지 않는다.** 지급명세서에 빈칸으로 출력하고
-- 사용자가 직접 채운다. 저장 대상은 세금계산서 발행에 필요한 상호·주소·대표자·
-- 이메일·사업자등록번호까지다. 계좌정보는 미결이라 컬럼을 두지 않는다.
--
-- 접근 모델: 기존 테이블과 동일하게 RLS default deny. 앱 서버가 service_role로만 접근.

BEGIN;

-- ============================================================
-- 1. 영업자
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settlement_partners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,

  -- 코파운더는 적립금(O)을 사업소득 신고액에 포함한다 (docs §3)
  partner_type       text NOT NULL CHECK (partner_type IN ('cofounder', 'partner')),

  -- 개인/사업자 구분. 현재 산식은 분기하지 않고 전원 원천징수한다.
  -- 사업자는 원천징수 대신 세금계산서로 가는 게 통상이므로, 실제 분기가
  -- 필요해지는 시점에 산식 쪽을 함께 고쳐야 한다 (지금은 기록 목적).
  taxpayer_type      text NOT NULL DEFAULT 'individual'
                       CHECK (taxpayer_type IN ('individual', 'business')),

  -- 플랫폼 수수료율 %. 기본 5, 영업자별 조정 가능 (docs §10).
  -- 월별 이력 관리 필요 여부는 미결 — 필요해지면 별도 테이블로 분리한다.
  commission_percent numeric(5,2) NOT NULL DEFAULT 5
                       CHECK (commission_percent >= 0 AND commission_percent <= 100),

  phone              text,
  email              text,
  is_active          boolean NOT NULL DEFAULT true,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT settlement_partners_name_unique UNIQUE (name)
);

COMMENT ON TABLE public.settlement_partners IS
  '급식 정산 영업자. RLS default deny — service_role만 접근.';
COMMENT ON COLUMN public.settlement_partners.partner_type IS
  'cofounder = 신고액 V에 적립금 O 포함, partner = V = R (신규 등록자는 전부 partner)';
COMMENT ON COLUMN public.settlement_partners.taxpayer_type IS
  '현재 산식은 분기하지 않음. 분기가 필요해지면 calcWithholding을 함께 수정할 것.';

ALTER TABLE public.settlement_partners ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 유치원(사업장)
-- ============================================================
-- 매핑 키가 (원천, 사업장코드)인 이유: 신세계와 CJ의 코드 체계가 완전히 다르다
-- (신세계 88689 / CJ 1008). 2026-07-29 실측 결과 담당 유치원도 겹치지 않는다.
CREATE TABLE IF NOT EXISTS public.settlement_venues (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source         text NOT NULL CHECK (source IN ('shinsegae', 'cj')),
  business_code  text NOT NULL,
  business_name  text NOT NULL,

  partner_id     uuid REFERENCES public.settlement_partners(id) ON DELETE RESTRICT,

  -- 정산 대상이 아닌 사업장 (예: 키즈웰에듀푸드(본사)).
  -- **매핑 누락과 반드시 구분**해야 한다 — 누락은 마감 차단 사유이고 제외는 정상이다.
  is_excluded    boolean NOT NULL DEFAULT false,

  -- 세금계산서/계산서 발행용 (docs §7). 주민번호는 없다.
  biz_reg_no     text,
  ceo_name       text,
  address        text,
  email          text,

  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT settlement_venues_source_code_unique UNIQUE (source, business_code),

  -- 제외된 사업장에 담당 영업자가 붙어 있으면 의도가 모순된다.
  -- (is_excluded = false, partner_id = null) 은 **미배정**으로 허용한다 —
  -- 원천에 새 사업장이 나타났을 때의 정상적인 중간 상태이고, 마감 전 검증에서 걸린다.
  CONSTRAINT settlement_venues_excluded_has_no_partner
    CHECK (NOT is_excluded OR partner_id IS NULL)
);

COMMENT ON TABLE public.settlement_venues IS
  '유치원(사업장). 매핑 키 = (source, business_code). RLS default deny.';
COMMENT ON COLUMN public.settlement_venues.is_excluded IS
  '정산 대상 제외(본사 등). 매핑 누락(partner_id IS NULL AND NOT is_excluded)과 구분할 것.';

CREATE INDEX IF NOT EXISTS idx_settlement_venues_partner
  ON public.settlement_venues(partner_id) WHERE partner_id IS NOT NULL;

ALTER TABLE public.settlement_venues ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. updated_at 자동 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_partners_touch ON public.settlement_partners;
CREATE TRIGGER trg_settlement_partners_touch
  BEFORE UPDATE ON public.settlement_partners
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_settlement_venues_touch ON public.settlement_venues;
CREATE TRIGGER trg_settlement_venues_touch
  BEFORE UPDATE ON public.settlement_venues
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 4. 26년 6월 실데이터 시드
-- ============================================================
-- 출처: 정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx
-- `집계표_정산용`의 영업자 그룹을 식당명으로 원천 시트와 대조해 사업장코드를 역추적했다.
-- 51개 식당행 전부 매칭에 성공했고, 이 매핑으로 집계한 영업자별 원가·단가 합계가
-- 엑셀 `계` 행과 원단위 일치함을 확인했다 (src/lib/__tests__/settlement-pipeline.test.ts).
--
-- 코파운더 3명: 김중영·이동현·조성곤 (docs §3). 김영수는 일반 파트너.

INSERT INTO public.settlement_partners (name, partner_type, note) VALUES
  ('김중영', 'cofounder', '26년 6월 실데이터 시드. 과거 엑셀에서 원천징수 누락 → 시스템은 동일 적용'),
  ('이동현', 'cofounder', '26년 6월 실데이터 시드. 분할 신고 사례 있음(김인순·이유나)'),
  ('조성곤', 'cofounder', '26년 6월 실데이터 시드'),
  ('김영수', 'partner',   '26년 6월 실데이터 시드')
ON CONFLICT (name) DO NOTHING;

-- 정산 제외 — 본사
INSERT INTO public.settlement_venues (source, business_code, business_name, is_excluded, note) VALUES
  ('shinsegae', '88689', '키즈웰에듀푸드(본사)', true, '본사 — 정산 대상 아님(엑셀 계 행에도 지급액 없음)')
ON CONFLICT (source, business_code) DO NOTHING;

-- 영업자별 담당 사업장
INSERT INTO public.settlement_venues (source, business_code, business_name, partner_id)
SELECT v.source, v.business_code, v.business_name, p.id
FROM (VALUES
  -- 김중영 (6)
  ('shinsegae', '89912', '나래유치원(키즈웰)',            '김중영'),
  ('cj',        '1003',  '키즈웰에듀푸드(재능유치원)',      '김중영'),
  ('cj',        '1005',  '키즈웰에듀푸드(해밀유치원)',      '김중영'),
  ('cj',        '1008',  '키즈웰에듀푸드(선경유치원)',      '김중영'),
  ('cj',        '1014',  '키즈웰에듀푸드(율화유치원)',      '김중영'),
  ('cj',        '1015',  '키즈웰에듀푸드(미래샘유치원)',    '김중영'),
  -- 이동현 (7)
  ('shinsegae', '89890', '국제유치원(키즈웰)',            '이동현'),
  ('cj',        '1002',  '키즈웰에듀푸드(젬마유치원)',      '이동현'),
  ('cj',        '1004',  '키즈웰에듀푸드(천안_복자유치원)',  '이동현'),
  ('cj',        '1006',  '키즈웰에듀푸드(우현유치원)',      '이동현'),
  ('cj',        '1007',  '키즈웰에듀푸드(부산_복자유치원)',  '이동현'),
  ('cj',        '1011',  '키즈웰에듀푸드(부산_해성유치원)',  '이동현'),
  ('cj',        '1016',  '키즈웰에듀푸드(복자유치원)',      '이동현'),
  -- 조성곤 (2)
  ('shinsegae', '90223', '수원복자유치원(키즈웰)',         '조성곤'),
  ('cj',        '1010',  '키즈웰에듀푸드(우성유치원)',      '조성곤'),
  -- 김영수 (1)
  ('cj',        '1013',  '키즈웰에듀푸드(아름솔유치원)',    '김영수')
) AS v(source, business_code, business_name, partner_name)
JOIN public.settlement_partners p ON p.name = v.partner_name
ON CONFLICT (source, business_code) DO NOTHING;

COMMIT;
