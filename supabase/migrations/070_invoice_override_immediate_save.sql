-- 070_invoice_override_immediate_save.sql
-- [정산] CJ 1016 담당자 즉시 반영
--
-- 기존 승인값을 덮어쓰지 않는다. 같은 품목을 다시 저장하면 이전 활성 행을
-- cancelled 이력으로 남기고 새 approved 행을 한 트랜잭션에서 만든다.

BEGIN;

CREATE OR REPLACE FUNCTION public.settlement_save_invoice_overrides(
  p_period text,
  p_items jsonb,
  p_actor text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_tax_kind text;
  v_item_name text;
  v_reason text;
  v_original_supply bigint;
  v_original_vat bigint;
  v_final_supply bigint;
  v_final_vat bigint;
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '정산월이 올바르지 않습니다.';
  END IF;
  IF btrim(coalesce(p_actor, '')) = '' THEN
    RAISE EXCEPTION '처리 담당자를 확인할 수 없습니다.';
  END IF;
  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) < 1
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION '원단위 조정은 한 번에 1~100건까지 저장할 수 있습니다.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY item->>'taxKind', btrim(item->>'itemName')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '같은 과세구분과 품목이 중복되었습니다.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_tax_kind := v_item->>'taxKind';
    v_item_name := btrim(coalesce(v_item->>'itemName', ''));
    v_reason := btrim(coalesce(v_item->>'reason', ''));
    BEGIN
      v_original_supply := (v_item->>'originalSupply')::bigint;
      v_original_vat := (v_item->>'originalVat')::bigint;
      v_final_supply := (v_item->>'finalSupply')::bigint;
      v_final_vat := (v_item->>'finalVat')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '공급가·부가세는 원 단위 정수로 입력해 주세요.';
    END;

    IF v_tax_kind NOT IN ('taxable', 'exempt') OR v_item_name = '' OR v_reason = '' THEN
      RAISE EXCEPTION '과세구분·품목명·조정 사유를 확인해 주세요.';
    END IF;
    IF v_original_supply < 0 OR v_original_vat < 0
       OR v_final_supply < 0 OR v_final_vat < 0 THEN
      RAISE EXCEPTION '공급가·부가세는 0 이상이어야 합니다.';
    END IF;
    IF v_tax_kind = 'exempt' AND (v_original_vat <> 0 OR v_final_vat <> 0) THEN
      RAISE EXCEPTION '면세 계산서에는 부가세를 입력할 수 없습니다.';
    END IF;

    UPDATE public.settlement_invoice_overrides
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = p_actor,
        cancellation_reason = '담당자 즉시 반영으로 대체'
    WHERE period = p_period
      AND source = 'cj'
      AND business_code = '1016'
      AND tax_kind = v_tax_kind
      AND item_name = v_item_name
      AND status IN ('draft', 'approved');

    INSERT INTO public.settlement_invoice_overrides (
      period, source, business_code, tax_kind, item_name,
      original_supply, original_vat, final_supply, final_vat,
      reason, status, created_by, approved_at, approved_by
    ) VALUES (
      p_period, 'cj', '1016', v_tax_kind, v_item_name,
      v_original_supply, v_original_vat, v_final_supply, v_final_vat,
      v_reason, 'approved', p_actor, now(), p_actor
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.settlement_save_invoice_overrides(text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_save_invoice_overrides(text, jsonb, text)
  TO service_role;

COMMIT;
