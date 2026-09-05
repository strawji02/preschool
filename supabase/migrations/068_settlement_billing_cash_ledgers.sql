-- 068_settlement_billing_cash_ledgers.sql
-- [정산] 공급사 원본 금액 정책 + CJ 1016 예외 + 공급자 대금/수금조정 원장
--
-- 기존 마감 스냅샷은 수정하지 않는다. 신규 테이블은 모두 RLS default deny이며
-- 앱의 인증된 서버 경로(service_role)로만 접근한다.

BEGIN;

-- 2026-09-05 정책: 모든 일반 거래처는 공급사가 준 원단위 금액을 그대로 쓴다.
-- 과거 스냅샷은 JSON으로 굳어 있어 이 변경의 영향을 받지 않는다.
UPDATE public.settlement_venues SET invoice_round_down = false WHERE invoice_round_down;

CREATE TABLE public.settlement_invoice_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period            text NOT NULL,
  source            text NOT NULL,
  business_code     text NOT NULL,
  tax_kind          text NOT NULL CHECK (tax_kind IN ('taxable', 'exempt')),
  item_name         text NOT NULL CHECK (btrim(item_name) <> ''),
  original_supply   bigint NOT NULL CHECK (original_supply >= 0),
  original_vat      bigint NOT NULL CHECK (original_vat >= 0),
  final_supply      bigint NOT NULL CHECK (final_supply >= 0),
  final_vat         bigint NOT NULL CHECK (final_vat >= 0),
  reason            text NOT NULL CHECK (btrim(reason) <> ''),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'approved', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  approved_at       timestamptz,
  approved_by       text,
  cancelled_at      timestamptz,
  cancelled_by      text,
  cancellation_reason text,
  CONSTRAINT settlement_invoice_overrides_only_cj_1016
    CHECK (source = 'cj' AND business_code = '1016'),
  CONSTRAINT settlement_invoice_overrides_tax_shape
    CHECK (tax_kind = 'taxable' OR (original_vat = 0 AND final_vat = 0)),
  CONSTRAINT settlement_invoice_overrides_approval_audit
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT settlement_invoice_overrides_cancel_audit
    CHECK (status <> 'cancelled' OR
      (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> ''))
);

CREATE UNIQUE INDEX settlement_invoice_overrides_active_key
  ON public.settlement_invoice_overrides(period, source, business_code, tax_kind, item_name)
  WHERE status IN ('draft', 'approved');
ALTER TABLE public.settlement_invoice_overrides ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.settlement_supplier_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period            text NOT NULL,
  source            text NOT NULL CHECK (source IN ('cj', 'shinsegae')),
  closing_revision  integer NOT NULL CHECK (closing_revision >= 1),
  paid_date         date NOT NULL,
  amount            bigint NOT NULL CHECK (amount > 0),
  note              text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  cancelled_at      timestamptz,
  cancelled_by      text,
  cancellation_reason text,
  CONSTRAINT settlement_supplier_payments_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE RESTRICT,
  CONSTRAINT settlement_supplier_payments_cancel_audit
    CHECK (status <> 'cancelled' OR
      (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> ''))
);
CREATE INDEX settlement_supplier_payments_period_idx
  ON public.settlement_supplier_payments(period, source, paid_date);
ALTER TABLE public.settlement_supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.settlement_supplier_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period            text NOT NULL,
  source            text NOT NULL CHECK (source IN ('cj', 'shinsegae')),
  closing_revision  integer NOT NULL CHECK (closing_revision >= 1),
  amount            bigint NOT NULL CHECK (amount <> 0),
  reason            text NOT NULL CHECK (btrim(reason) <> ''),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'approved', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  approved_at       timestamptz,
  approved_by       text,
  cancelled_at      timestamptz,
  cancelled_by      text,
  cancellation_reason text,
  CONSTRAINT settlement_supplier_adjustments_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE RESTRICT,
  CONSTRAINT settlement_supplier_adjustments_approval_audit
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT settlement_supplier_adjustments_cancel_audit
    CHECK (status <> 'cancelled' OR
      (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> ''))
);
CREATE INDEX settlement_supplier_adjustments_period_idx
  ON public.settlement_supplier_adjustments(period, source, status);
ALTER TABLE public.settlement_supplier_adjustments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.settlement_receipt_writeoffs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period            text NOT NULL,
  source            text NOT NULL CHECK (source IN ('cj', 'shinsegae')),
  business_code     text NOT NULL,
  closing_revision  integer NOT NULL CHECK (closing_revision >= 1),
  amount            bigint NOT NULL CHECK (amount > 0),
  reason            text NOT NULL CHECK (btrim(reason) <> ''),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'approved', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text NOT NULL,
  approved_at       timestamptz,
  approved_by       text,
  cancelled_at      timestamptz,
  cancelled_by      text,
  cancellation_reason text,
  CONSTRAINT settlement_receipt_writeoffs_period_fk
    FOREIGN KEY (period) REFERENCES public.settlement_closings(period) ON DELETE RESTRICT,
  CONSTRAINT settlement_receipt_writeoffs_approval_audit
    CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT settlement_receipt_writeoffs_cancel_audit
    CHECK (status <> 'cancelled' OR
      (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> ''))
);
CREATE UNIQUE INDEX settlement_receipt_writeoffs_active_key
  ON public.settlement_receipt_writeoffs(period, source, business_code)
  WHERE status IN ('draft', 'approved');
ALTER TABLE public.settlement_receipt_writeoffs ENABLE ROW LEVEL SECURITY;

-- 확정 리비전을 현금 기록에 함께 남겨 청구 변경 후 재검토 대상을 식별한다.
ALTER TABLE public.settlement_receipts
  ADD COLUMN closing_revision integer CHECK (closing_revision >= 1),
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text,
  ADD COLUMN cancellation_reason text;

UPDATE public.settlement_receipts r
SET closing_revision = c.revision
FROM public.settlement_closings c
WHERE c.period = r.period AND r.closing_revision IS NULL;

ALTER TABLE public.settlement_receipts
  ADD CONSTRAINT settlement_receipts_cancel_audit
  CHECK (status <> 'cancelled' OR
    (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> ''));

COMMIT;
