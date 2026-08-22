-- 063_settlement_manual_items.sql
-- [정산] 외부 사입·임의 청구 및 증빙/감사 이력

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('settlement-manual-evidence', 'settlement-manual-evidence', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.settlement_manual_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  kind text NOT NULL CHECK (kind IN ('billable', 'partner_service', 'hq_service', 'custom')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),

  source text NOT NULL CHECK (source IN ('shinsegae', 'cj')),
  business_code text NOT NULL,
  business_name text NOT NULL,
  restaurant_code text,
  restaurant_name text,
  transaction_date date NOT NULL,
  delivery_date date,

  product_name text NOT NULL,
  invoice_item_name text NOT NULL,
  specification text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '',
  quantity numeric NOT NULL CHECK (quantity > 0),
  vendor_name text NOT NULL DEFAULT '',
  order_number text,

  purchase_tax_kind text NOT NULL CHECK (purchase_tax_kind IN ('taxable', 'exempt')),
  purchase_supply bigint NOT NULL DEFAULT 0 CHECK (purchase_supply >= 0),
  purchase_vat bigint NOT NULL DEFAULT 0 CHECK (purchase_vat >= 0),
  purchase_exempt bigint NOT NULL DEFAULT 0 CHECK (purchase_exempt >= 0),
  purchase_total bigint NOT NULL DEFAULT 0 CHECK (purchase_total >= 0),

  charge_tax_kind text NOT NULL CHECK (charge_tax_kind IN ('taxable', 'exempt')),
  charge_supply bigint NOT NULL DEFAULT 0 CHECK (charge_supply >= 0),
  charge_vat bigint NOT NULL DEFAULT 0 CHECK (charge_vat >= 0),
  charge_exempt bigint NOT NULL DEFAULT 0 CHECK (charge_exempt >= 0),
  charge_total bigint NOT NULL DEFAULT 0 CHECK (charge_total >= 0),

  burden text NOT NULL CHECK (burden IN ('venue', 'partner', 'hq')),
  partner_included boolean NOT NULL DEFAULT true,
  platform_fee_applies boolean NOT NULL DEFAULT true,
  invoice_mode text NOT NULL DEFAULT 'separate' CHECK (invoice_mode IN ('merge', 'separate')),

  reason text NOT NULL,
  requested_by text NOT NULL,
  duplicate_override_reason text,

  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text,

  CONSTRAINT settlement_manual_purchase_sum
    CHECK (purchase_supply + purchase_vat + purchase_exempt = purchase_total),
  CONSTRAINT settlement_manual_charge_sum
    CHECK (charge_supply + charge_vat + charge_exempt = charge_total),
  CONSTRAINT settlement_manual_purchase_kind
    CHECK (
      (purchase_tax_kind = 'taxable' AND purchase_exempt = 0)
      OR (purchase_tax_kind = 'exempt' AND purchase_supply = 0 AND purchase_vat = 0)
    ),
  CONSTRAINT settlement_manual_charge_kind
    CHECK (
      (charge_tax_kind = 'taxable' AND charge_exempt = 0)
      OR (charge_tax_kind = 'exempt' AND charge_supply = 0 AND charge_vat = 0)
    ),
  CONSTRAINT settlement_manual_venue_charge
    CHECK (burden <> 'venue' OR charge_total > 0),
  CONSTRAINT settlement_manual_service_partner_flag
    CHECK (burden = 'venue' OR partner_included = false)
);

CREATE INDEX IF NOT EXISTS settlement_manual_items_period_idx
  ON public.settlement_manual_items (period, status, transaction_date);
CREATE INDEX IF NOT EXISTS settlement_manual_items_duplicate_idx
  ON public.settlement_manual_items
    (period, source, business_code, transaction_date, product_name, purchase_total)
  WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS public.settlement_manual_item_events (
  id bigserial PRIMARY KEY,
  manual_item_id uuid NOT NULL REFERENCES public.settlement_manual_items(id),
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_manual_item_events_item_idx
  ON public.settlement_manual_item_events (manual_item_id, created_at);

CREATE OR REPLACE FUNCTION public.log_settlement_manual_item_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_action := 'created';
  ELSIF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    event_action := 'cancelled';
  ELSIF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    event_action := 'approved';
  ELSE
    event_action := 'updated';
  END IF;

  INSERT INTO public.settlement_manual_item_events
    (manual_item_id, action, before_data, after_data, actor)
  VALUES
    (NEW.id, event_action, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
     to_jsonb(NEW), COALESCE(NEW.updated_by, NEW.created_by));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settlement_manual_item_audit ON public.settlement_manual_items;
CREATE TRIGGER settlement_manual_item_audit
AFTER INSERT OR UPDATE ON public.settlement_manual_items
FOR EACH ROW EXECUTE FUNCTION public.log_settlement_manual_item_event();

CREATE TABLE IF NOT EXISTS public.settlement_manual_item_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_item_id uuid NOT NULL REFERENCES public.settlement_manual_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0),
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_manual_item_evidence_item_idx
  ON public.settlement_manual_item_evidence (manual_item_id, uploaded_at);

COMMENT ON TABLE public.settlement_manual_items IS
  '외부 사입·임의 청구. 승인된 행만 정산·계산서에 반영하며 마감 스냅샷에 굳힌다.';
COMMENT ON TABLE public.settlement_manual_item_events IS
  '외부 사입 변경 이력. 트리거로 같은 트랜잭션에서 append-only 기록한다.';
COMMENT ON TABLE public.settlement_manual_item_evidence IS
  '외부 사입 증빙 메타. 파일은 비공개 settlement-manual-evidence 버킷에 둔다.';

ALTER TABLE public.settlement_manual_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_manual_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_manual_item_evidence ENABLE ROW LEVEL SECURITY;

COMMIT;
