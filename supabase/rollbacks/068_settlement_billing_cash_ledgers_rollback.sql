-- 앱을 이전 Vercel 배포로 되돌리는 것이 1차 롤백이다.
-- 아래 SQL은 신규 원장에 실데이터가 없을 때만 사용하는 파괴적 역마이그레이션이다.
BEGIN;

DROP TABLE IF EXISTS public.settlement_receipt_writeoffs;
DROP TABLE IF EXISTS public.settlement_supplier_adjustments;
DROP TABLE IF EXISTS public.settlement_supplier_payments;
DROP TABLE IF EXISTS public.settlement_invoice_overrides;

ALTER TABLE public.settlement_receipts
  DROP CONSTRAINT IF EXISTS settlement_receipts_cancel_audit,
  DROP COLUMN IF EXISTS cancellation_reason,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS closing_revision;

-- 058 정책 복원값. 운영 DB 실측 기준이다.
UPDATE public.settlement_venues
SET invoice_round_down = (source = 'cj' AND business_code = '1005')
  OR (source = 'shinsegae' AND business_code = '89912');

COMMIT;
