-- 065_comparison_proposal_history.sql
-- [비교] 제안서 발행 버전·거래명세표 변경·제안금액 변경 이력

BEGIN;

CREATE TABLE IF NOT EXISTS public.comparison_kindergartens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (length(trim(canonical_name)) > 0),
  normalized_key text NOT NULL UNIQUE CHECK (length(normalized_key) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comparison_kindergarten_aliases (
  alias_key text PRIMARY KEY,
  alias_name text NOT NULL,
  kindergarten_id uuid NOT NULL REFERENCES public.comparison_kindergartens(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparison_kindergarten_aliases_kindergarten_idx
  ON public.comparison_kindergarten_aliases (kindergarten_id);

CREATE TABLE IF NOT EXISTS public.comparison_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  kindergarten_id uuid NOT NULL REFERENCES public.comparison_kindergartens(id),
  kindergarten_name_snapshot text NOT NULL,
  target_period text,
  first_issued_at timestamptz NOT NULL,
  latest_issued_at timestamptz NOT NULL,
  latest_version_no integer NOT NULL DEFAULT 0 CHECK (latest_version_no >= 0),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparison_proposals_kindergarten_period_idx
  ON public.comparison_proposals (kindergarten_id, target_period, first_issued_at);
CREATE INDEX IF NOT EXISTS comparison_proposals_latest_issued_idx
  ON public.comparison_proposals (latest_issued_at DESC);

CREATE TABLE IF NOT EXISTS public.comparison_proposal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.comparison_proposals(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  idempotency_key text NOT NULL UNIQUE,
  issue_format text NOT NULL CHECK (issue_format IN ('pptx', 'pdf_print', 'historical_estimate')),

  statement_hash text NOT NULL CHECK (statement_hash ~ '^[a-f0-9]{64}$'),
  statement_snapshot jsonb NOT NULL CHECK (jsonb_typeof(statement_snapshot) = 'object'),
  amount_snapshot jsonb NOT NULL CHECK (jsonb_typeof(amount_snapshot) = 'object'),
  statement_changed boolean,
  proposal_amount_changed boolean,
  statement_diff jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(statement_diff) = 'object'),
  amount_diff jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(amount_diff) = 'object'),
  change_reasons text[] NOT NULL DEFAULT '{}'::text[],

  is_estimated boolean NOT NULL DEFAULT false,
  estimate_confidence text CHECK (estimate_confidence IN ('high', 'medium', 'low')),
  estimate_basis jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(estimate_basis) = 'array'),
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (proposal_id, version_no),
  CHECK (
    (is_estimated = false AND estimate_confidence IS NULL)
    OR (is_estimated = true AND estimate_confidence IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS comparison_proposal_versions_month_idx
  ON public.comparison_proposal_versions (issued_at DESC);
CREATE INDEX IF NOT EXISTS comparison_proposal_versions_session_idx
  ON public.comparison_proposal_versions (session_id, version_no);
CREATE INDEX IF NOT EXISTS comparison_proposal_versions_change_idx
  ON public.comparison_proposal_versions (statement_changed, proposal_amount_changed, issued_at DESC)
  WHERE version_no > 1;

CREATE TABLE IF NOT EXISTS public.comparison_monthly_report_runs (
  report_month text PRIMARY KEY CHECK (report_month ~ '^\d{4}-\d{2}$'),
  status text NOT NULL CHECK (status IN ('generated', 'sent', 'error')),
  version_count integer NOT NULL DEFAULT 0 CHECK (version_count >= 0),
  file_name text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.comparison_proposals IS
  '비교 세션별 유치원 제출용 제안서 정본. 다운로드 횟수가 아니라 최초 발행과 최신 버전을 관리한다.';
COMMENT ON TABLE public.comparison_proposal_versions IS
  '제안서 발행 시점별 거래명세표·금액 스냅샷과 이전 버전 대비 변경 여부. 과거 추정치는 신뢰도를 함께 저장한다.';
COMMENT ON TABLE public.comparison_monthly_report_runs IS
  '월말 제안서 보고서 생성·발송 중복 방지 이력.';

CREATE OR REPLACE FUNCTION public.record_comparison_proposal_version(
  p_session_id uuid,
  p_kindergarten_name text,
  p_kindergarten_key text,
  p_target_period text,
  p_issue_format text,
  p_idempotency_key text,
  p_statement_hash text,
  p_statement_snapshot jsonb,
  p_amount_snapshot jsonb,
  p_change_reasons text[] DEFAULT '{}'::text[],
  p_is_estimated boolean DEFAULT false,
  p_estimate_confidence text DEFAULT NULL,
  p_estimate_basis jsonb DEFAULT '[]'::jsonb,
  p_issued_by uuid DEFAULT NULL,
  p_issued_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  version_id uuid,
  proposal_id uuid,
  version_no integer,
  statement_changed boolean,
  proposal_amount_changed boolean,
  duplicate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kindergarten_id uuid;
  v_proposal_id uuid;
  v_version_id uuid;
  v_version_no integer;
  v_previous_statement jsonb;
  v_previous_amount jsonb;
  v_statement_changed boolean;
  v_amount_changed boolean;
  v_statement_diff jsonb := '{}'::jsonb;
  v_amount_diff jsonb := '{}'::jsonb;
BEGIN
  IF p_kindergarten_name IS NULL OR length(trim(p_kindergarten_name)) = 0
     OR p_kindergarten_key IS NULL OR length(trim(p_kindergarten_key)) = 0 THEN
    RAISE EXCEPTION 'kindergarten name is required' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = '22023';
  END IF;

  -- 같은 비교 세션의 동시 발행을 직렬화한다. 버전 번호와 이전 버전 비교가 항상 일치한다.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 65065));

  SELECT v.id, v.proposal_id, v.version_no, v.statement_changed, v.proposal_amount_changed
    INTO v_version_id, v_proposal_id, v_version_no, v_statement_changed, v_amount_changed
    FROM public.comparison_proposal_versions v
   WHERE v.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_version_id, v_proposal_id, v_version_no,
                        v_statement_changed, v_amount_changed, true;
    RETURN;
  END IF;

  INSERT INTO public.comparison_kindergartens (canonical_name, normalized_key)
  VALUES (trim(p_kindergarten_name), trim(p_kindergarten_key))
  ON CONFLICT (normalized_key) DO UPDATE
    SET canonical_name = EXCLUDED.canonical_name,
        updated_at = now()
  RETURNING id INTO v_kindergarten_id;

  INSERT INTO public.comparison_kindergarten_aliases (
    alias_key, alias_name, kindergarten_id
  ) VALUES (
    trim(p_kindergarten_key), trim(p_kindergarten_name), v_kindergarten_id
  )
  ON CONFLICT (alias_key) DO UPDATE
    SET alias_name = EXCLUDED.alias_name,
        kindergarten_id = EXCLUDED.kindergarten_id,
        last_seen_at = now();

  INSERT INTO public.comparison_proposals (
    session_id, kindergarten_id, kindergarten_name_snapshot, target_period,
    first_issued_at, latest_issued_at
  ) VALUES (
    p_session_id, v_kindergarten_id, trim(p_kindergarten_name), nullif(trim(p_target_period), ''),
    p_issued_at, p_issued_at
  )
  ON CONFLICT (session_id) DO UPDATE
    SET kindergarten_id = EXCLUDED.kindergarten_id,
        kindergarten_name_snapshot = EXCLUDED.kindergarten_name_snapshot,
        target_period = EXCLUDED.target_period,
        updated_at = now()
  RETURNING id INTO v_proposal_id;

  SELECT v.statement_snapshot, v.amount_snapshot
    INTO v_previous_statement, v_previous_amount
    FROM public.comparison_proposal_versions v
   WHERE v.proposal_id = v_proposal_id
   ORDER BY v.version_no DESC
   LIMIT 1;

  SELECT p.latest_version_no + 1
    INTO v_version_no
    FROM public.comparison_proposals p
   WHERE p.id = v_proposal_id
   FOR UPDATE;

  IF v_previous_statement IS NULL THEN
    v_statement_changed := NULL;
    v_amount_changed := NULL;
  ELSE
    v_statement_changed := (v_previous_statement->>'hash') IS DISTINCT FROM p_statement_hash;
    v_amount_changed := (v_previous_amount->>'monthlyProposedAmount')::numeric
                           IS DISTINCT FROM (p_amount_snapshot->>'monthlyProposedAmount')::numeric;

    WITH previous_lines AS (
      SELECT line->>'identityKey' AS identity_key,
             line->>'lineKey' AS line_key,
             count(*)::integer AS line_count
        FROM jsonb_array_elements(coalesce(v_previous_statement->'lines', '[]'::jsonb)) line
       GROUP BY 1, 2
    ), current_lines AS (
      SELECT line->>'identityKey' AS identity_key,
             line->>'lineKey' AS line_key,
             count(*)::integer AS line_count
        FROM jsonb_array_elements(coalesce(p_statement_snapshot->'lines', '[]'::jsonb)) line
       GROUP BY 1, 2
    ), identity_totals AS (
      SELECT coalesce(p.identity_key, c.identity_key) AS identity_key,
             sum(coalesce(p.line_count, 0)) AS before_total,
             sum(coalesce(c.line_count, 0)) AS after_total,
             sum(least(coalesce(p.line_count, 0), coalesce(c.line_count, 0))) AS exact_total
        FROM previous_lines p
        FULL JOIN current_lines c
          ON p.identity_key = c.identity_key AND p.line_key = c.line_key
       GROUP BY 1
    ), changes AS (
      SELECT least(before_total - exact_total, after_total - exact_total) AS modified_count,
             greatest(before_total - exact_total - least(before_total - exact_total, after_total - exact_total), 0) AS removed_count,
             greatest(after_total - exact_total - least(before_total - exact_total, after_total - exact_total), 0) AS added_count
        FROM identity_totals
    )
    SELECT jsonb_build_object(
      'addedCount', coalesce(sum(added_count), 0),
      'removedCount', coalesce(sum(removed_count), 0),
      'modifiedCount', coalesce(sum(modified_count), 0),
      'previousTotal', coalesce((v_previous_statement->>'totalAmount')::numeric, 0),
      'currentTotal', coalesce((p_statement_snapshot->>'totalAmount')::numeric, 0),
      'totalDelta', coalesce((p_statement_snapshot->>'totalAmount')::numeric, 0)
                    - coalesce((v_previous_statement->>'totalAmount')::numeric, 0)
    ) INTO v_statement_diff
    FROM changes;

    v_amount_diff := jsonb_build_object(
      'monthlyExistingAmount', coalesce((p_amount_snapshot->>'monthlyExistingAmount')::numeric, 0) - coalesce((v_previous_amount->>'monthlyExistingAmount')::numeric, 0),
      'monthlyProposedAmount', coalesce((p_amount_snapshot->>'monthlyProposedAmount')::numeric, 0) - coalesce((v_previous_amount->>'monthlyProposedAmount')::numeric, 0),
      'monthlySavings', coalesce((p_amount_snapshot->>'monthlySavings')::numeric, 0) - coalesce((v_previous_amount->>'monthlySavings')::numeric, 0),
      'annualExistingAmount', coalesce((p_amount_snapshot->>'annualExistingAmount')::numeric, 0) - coalesce((v_previous_amount->>'annualExistingAmount')::numeric, 0),
      'annualProposedAmount', coalesce((p_amount_snapshot->>'annualProposedAmount')::numeric, 0) - coalesce((v_previous_amount->>'annualProposedAmount')::numeric, 0),
      'annualSavings', coalesce((p_amount_snapshot->>'annualSavings')::numeric, 0) - coalesce((v_previous_amount->>'annualSavings')::numeric, 0),
      'savingsPercent', coalesce((p_amount_snapshot->>'savingsPercent')::numeric, 0) - coalesce((v_previous_amount->>'savingsPercent')::numeric, 0),
      'supplyRate', coalesce((p_amount_snapshot->>'supplyRate')::numeric, 0) - coalesce((v_previous_amount->>'supplyRate')::numeric, 0),
      'totalExtrasAnnual', coalesce((p_amount_snapshot->>'totalExtrasAnnual')::numeric, 0) - coalesce((v_previous_amount->>'totalExtrasAnnual')::numeric, 0)
    );
  END IF;

  INSERT INTO public.comparison_proposal_versions (
    proposal_id, session_id, version_no, idempotency_key, issue_format,
    statement_hash, statement_snapshot, amount_snapshot,
    statement_changed, proposal_amount_changed, statement_diff, amount_diff,
    change_reasons, is_estimated, estimate_confidence, estimate_basis,
    issued_by, issued_at
  ) VALUES (
    v_proposal_id, p_session_id, v_version_no, p_idempotency_key, p_issue_format,
    p_statement_hash, p_statement_snapshot, p_amount_snapshot,
    v_statement_changed, v_amount_changed, v_statement_diff, v_amount_diff,
    coalesce(p_change_reasons, '{}'::text[]), p_is_estimated, p_estimate_confidence,
    coalesce(p_estimate_basis, '[]'::jsonb), p_issued_by, p_issued_at
  )
  RETURNING id INTO v_version_id;

  UPDATE public.comparison_proposals
     SET latest_version_no = v_version_no,
         latest_issued_at = p_issued_at,
         updated_at = now()
   WHERE id = v_proposal_id;

  RETURN QUERY SELECT v_version_id, v_proposal_id, v_version_no,
                      v_statement_changed, v_amount_changed, false;
END;
$$;

REVOKE ALL ON FUNCTION public.record_comparison_proposal_version(
  uuid, text, text, text, text, text, text, jsonb, jsonb, text[], boolean, text, jsonb, uuid, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_comparison_proposal_version(
  uuid, text, text, text, text, text, text, jsonb, jsonb, text[], boolean, text, jsonb, uuid, timestamptz
) TO service_role;

ALTER TABLE public.comparison_kindergartens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_kindergarten_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_monthly_report_runs ENABLE ROW LEVEL SECURITY;

COMMIT;
