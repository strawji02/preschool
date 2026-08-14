-- 비교 세션의 신세계 단가 기준월 (docs/systems/comparison.md §9)
--
-- 세션을 시작할 때 "몇 월 신세계 단가로 비교할지" 고른다. 매칭 후보 검색은
-- `products`(달과 무관한 품목 마스터)로 하고, **단가만** 그 달
-- `shinsegae_price_book`에서 가져온다.
--
-- ★ 왜 products를 월별로 만들지 않았나
--   임베딩·search_vector는 품목명에서 나오고 품목명은 달마다 안 바뀐다.
--   가격만 바뀐다. 월별로 복제하면 8,000행 × 12개월 + 임베딩 96,000개가 된다.
--
-- ⚠️ NULL은 **기존 동작**이다 (2026-08-14 결정).
--   지금까지의 세션 18개는 products.standard_price를 그대로 쓴다. 이미 제출한
--   제안서의 절감액이 나중에 바뀌면 안 된다 — 정산의 마감 스냅샷과 같은 원리다.

ALTER TABLE public.audit_sessions
  ADD COLUMN IF NOT EXISTS price_book_period text;

-- `YYYY-MM`만 허용. 형식이 틀리면 조회가 조용히 0건이 되어 단가가 통째로 빈다.
ALTER TABLE public.audit_sessions
  DROP CONSTRAINT IF EXISTS audit_sessions_price_book_period_valid;
ALTER TABLE public.audit_sessions
  ADD CONSTRAINT audit_sessions_price_book_period_valid
    CHECK (price_book_period IS NULL OR price_book_period ~ '^\d{4}-\d{2}$');

COMMENT ON COLUMN public.audit_sessions.price_book_period IS
  '신세계 단가 기준월(YYYY-MM). NULL이면 products.standard_price를 쓰는 기존 동작 (comparison.md §9)';
