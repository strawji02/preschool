-- 054_closing_venue_company_name.sql
-- [정산] 마감 스냅샷에 계산서 상호 추가 (docs §13-2)
--
-- 경영 보고서는 유치원을 `해밀유치원`으로 보여줘야 한다. 원천 사업장명
-- `키즈웰에듀푸드(해밀유치원)`은 읽기 어렵다.
--
-- **그때의 상호를 굳히는 것**이 목적이다 — 나중에 상호가 바뀌어도 마감된 달의
-- 보고서는 그대로여야 한다. 그래서 마스터를 조인하지 않고 스냅샷에 복사한다.

BEGIN;

ALTER TABLE public.settlement_closing_venues
  ADD COLUMN IF NOT EXISTS company_name text;

COMMENT ON COLUMN public.settlement_closing_venues.company_name IS
  '그때의 계산서 상호. 마스터를 조인하지 않는다 — 상호가 바뀌어도 마감 문서는 그대로여야 한다.';

COMMIT;
