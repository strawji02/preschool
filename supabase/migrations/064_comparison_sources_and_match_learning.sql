-- 064_comparison_sources_and_match_learning.sql
-- [비교] 다중 원본 공급사 + 사용자 확정 매핑 학습 기반

BEGIN;

CREATE OR REPLACE FUNCTION public.comparison_normalize_match_key(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(coalesce(input, ''), '[[:space:]_/,()\[\]{}*×xX.\-]+', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.comparison_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  supplier_name text NOT NULL CHECK (length(trim(supplier_name)) > 0),
  supplier_key text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('excel', 'pdf', 'image', 'mixed')),
  display_name text NOT NULL,
  file_names jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(file_names) = 'array'),
  file_hash text,
  is_append boolean NOT NULL DEFAULT false,
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  source_total numeric(14, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT comparison_sources_file_hash_format
    CHECK (file_hash IS NULL OR file_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS comparison_sources_session_hash_unique
  ON public.comparison_sources (session_id, file_hash)
  WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS comparison_sources_session_created_idx
  ON public.comparison_sources (session_id, created_at);
CREATE INDEX IF NOT EXISTS comparison_sources_supplier_idx
  ON public.comparison_sources (supplier_key);

ALTER TABLE public.audit_items
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.comparison_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initial_matched_product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS recommendation_source text NOT NULL DEFAULT 'algorithm'
    CHECK (recommendation_source IN ('algorithm', 'session_exact', 'history_supplier', 'history_global')),
  ADD COLUMN IF NOT EXISTS learning_evidence_count integer NOT NULL DEFAULT 0
    CHECK (learning_evidence_count >= 0);

CREATE INDEX IF NOT EXISTS audit_items_source_idx
  ON public.audit_items (source_id, row_index);
CREATE INDEX IF NOT EXISTS audit_items_initial_match_idx
  ON public.audit_items (initial_matched_product_id);

CREATE TABLE IF NOT EXISTS public.comparison_match_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_supplier_key text NOT NULL DEFAULT '*',
  name_key text NOT NULL,
  spec_key text NOT NULL DEFAULT '',
  origin_key text NOT NULL DEFAULT '',
  unit_key text NOT NULL DEFAULT '',
  product_id uuid NOT NULL REFERENCES public.products(id),
  confirmation_count integer NOT NULL DEFAULT 1 CHECK (confirmation_count > 0),
  first_confirmed_at timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id)
);

CREATE INDEX IF NOT EXISTS comparison_match_memory_lookup_idx
  ON public.comparison_match_memory
    (name_key, spec_key, origin_key, unit_key, source_supplier_key);

-- 같은 품목을 여러 번 확정해도 학습 횟수가 부풀지 않도록 품목별 최종 근거를 1건만 보존한다.
CREATE TABLE IF NOT EXISTS public.comparison_match_evidence (
  item_id uuid PRIMARY KEY REFERENCES public.audit_items(id) ON DELETE CASCADE,
  source_supplier_key text NOT NULL DEFAULT '*',
  name_key text NOT NULL,
  spec_key text NOT NULL DEFAULT '',
  origin_key text NOT NULL DEFAULT '',
  unit_key text NOT NULL DEFAULT '',
  product_id uuid NOT NULL REFERENCES public.products(id),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comparison_match_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.audit_sessions(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.audit_items(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.comparison_sources(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('recommended', 'selected', 'confirmed', 'propagated', 'excluded', 'cleared')
  ),
  from_product_id uuid REFERENCES public.products(id),
  to_product_id uuid REFERENCES public.products(id),
  recommendation_source text,
  algorithm_version text NOT NULL DEFAULT 'comparison-v1',
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparison_match_events_session_idx
  ON public.comparison_match_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS comparison_match_events_item_idx
  ON public.comparison_match_events (item_id, created_at);

-- 앞으로 발생하는 확정 이벤트는 감사 이력과 학습 집계를 같은 트랜잭션에 기록한다.
CREATE OR REPLACE FUNCTION public.record_comparison_match_decision(
  p_item_id uuid,
  p_event_type text,
  p_from_product_id uuid DEFAULT NULL,
  p_to_product_id uuid DEFAULT NULL,
  p_algorithm_version text DEFAULT 'comparison-v1'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.audit_items%ROWTYPE;
  source_supplier_key text := '*';
  previous_evidence public.comparison_match_evidence%ROWTYPE;
  evidence_exists boolean := false;
  evidence_changed boolean := false;
BEGIN
  IF p_event_type NOT IN ('selected', 'confirmed', 'propagated', 'excluded', 'cleared') THEN
    RAISE EXCEPTION 'invalid comparison match event type: %', p_event_type;
  END IF;

  SELECT * INTO target FROM public.audit_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit item not found: %', p_item_id;
  END IF;

  IF target.source_id IS NOT NULL THEN
    SELECT supplier_key INTO source_supplier_key
    FROM public.comparison_sources
    WHERE id = target.source_id;
    source_supplier_key := coalesce(source_supplier_key, '*');
  END IF;

  INSERT INTO public.comparison_match_events (
    session_id, item_id, source_id, event_type, from_product_id, to_product_id,
    recommendation_source, algorithm_version, item_snapshot
  ) VALUES (
    target.session_id, target.id, target.source_id, p_event_type,
    p_from_product_id, p_to_product_id, target.recommendation_source,
    p_algorithm_version,
    jsonb_build_object(
      'name', target.extracted_name,
      'spec', target.extracted_spec,
      'origin', target.extracted_origin,
      'unit', target.extracted_unit
    )
  );

  SELECT * INTO previous_evidence
  FROM public.comparison_match_evidence
  WHERE item_id = target.id
  FOR UPDATE;
  evidence_exists := FOUND;

  -- 확정을 취소하거나 비교불가로 바꾸면 기존 학습 근거도 제거한다.
  IF p_event_type IN ('excluded', 'cleared') AND evidence_exists THEN
    UPDATE public.comparison_match_memory
    SET confirmation_count = confirmation_count - 1,
        last_confirmed_at = now()
    WHERE source_supplier_key = previous_evidence.source_supplier_key
      AND name_key = previous_evidence.name_key
      AND spec_key = previous_evidence.spec_key
      AND origin_key = previous_evidence.origin_key
      AND unit_key = previous_evidence.unit_key
      AND product_id = previous_evidence.product_id;

    DELETE FROM public.comparison_match_memory WHERE confirmation_count <= 0;
    DELETE FROM public.comparison_match_evidence WHERE item_id = target.id;
    RETURN;
  END IF;

  IF p_event_type IN ('confirmed', 'propagated') AND p_to_product_id IS NOT NULL THEN
    evidence_changed := NOT evidence_exists
      OR previous_evidence.source_supplier_key IS DISTINCT FROM source_supplier_key
      OR previous_evidence.name_key IS DISTINCT FROM public.comparison_normalize_match_key(target.extracted_name)
      OR previous_evidence.spec_key IS DISTINCT FROM public.comparison_normalize_match_key(target.extracted_spec)
      OR previous_evidence.origin_key IS DISTINCT FROM public.comparison_normalize_match_key(target.extracted_origin)
      OR previous_evidence.unit_key IS DISTINCT FROM public.comparison_normalize_match_key(target.extracted_unit)
      OR previous_evidence.product_id IS DISTINCT FROM p_to_product_id;

    IF evidence_exists AND evidence_changed THEN
      UPDATE public.comparison_match_memory
      SET confirmation_count = confirmation_count - 1,
          last_confirmed_at = now()
      WHERE source_supplier_key = previous_evidence.source_supplier_key
        AND name_key = previous_evidence.name_key
        AND spec_key = previous_evidence.spec_key
        AND origin_key = previous_evidence.origin_key
        AND unit_key = previous_evidence.unit_key
        AND product_id = previous_evidence.product_id;
      DELETE FROM public.comparison_match_memory WHERE confirmation_count <= 0;
    END IF;

    INSERT INTO public.comparison_match_evidence (
      item_id, source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id, confirmed_at
    ) VALUES (
      target.id,
      source_supplier_key,
      public.comparison_normalize_match_key(target.extracted_name),
      public.comparison_normalize_match_key(target.extracted_spec),
      public.comparison_normalize_match_key(target.extracted_origin),
      public.comparison_normalize_match_key(target.extracted_unit),
      p_to_product_id,
      now()
    )
    ON CONFLICT (item_id) DO UPDATE SET
      source_supplier_key = EXCLUDED.source_supplier_key,
      name_key = EXCLUDED.name_key,
      spec_key = EXCLUDED.spec_key,
      origin_key = EXCLUDED.origin_key,
      unit_key = EXCLUDED.unit_key,
      product_id = EXCLUDED.product_id,
      confirmed_at = EXCLUDED.confirmed_at;

    IF NOT evidence_changed THEN
      RETURN;
    END IF;

    INSERT INTO public.comparison_match_memory (
      source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id
    ) VALUES (
      source_supplier_key,
      public.comparison_normalize_match_key(target.extracted_name),
      public.comparison_normalize_match_key(target.extracted_spec),
      public.comparison_normalize_match_key(target.extracted_origin),
      public.comparison_normalize_match_key(target.extracted_unit),
      p_to_product_id
    )
    ON CONFLICT (source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id)
    DO UPDATE SET
      confirmation_count = public.comparison_match_memory.confirmation_count + 1,
      last_confirmed_at = now();
  END IF;
END;
$$;

-- 기존 확정 결과를 전역 기억으로 보수적으로 이관한다. 동일 서명이 여러 상품으로
-- 갈린 경우에도 각각 남겨 추천 계층이 충돌로 판단하도록 한다.
INSERT INTO public.comparison_match_memory (
  source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id,
  confirmation_count, first_confirmed_at, last_confirmed_at
)
SELECT
  '*',
  public.comparison_normalize_match_key(ai.extracted_name),
  public.comparison_normalize_match_key(ai.extracted_spec),
  public.comparison_normalize_match_key(ai.extracted_origin),
  public.comparison_normalize_match_key(ai.extracted_unit),
  ai.matched_product_id,
  count(*)::integer,
  min(ai.updated_at),
  max(ai.updated_at)
FROM public.audit_items ai
WHERE ai.match_status = 'manual_matched'
  AND ai.matched_product_id IS NOT NULL
  AND coalesce(ai.is_excluded, false) = false
GROUP BY 2, 3, 4, 5, 6
ON CONFLICT (source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id)
DO NOTHING;

INSERT INTO public.comparison_match_evidence (
  item_id, source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id, confirmed_at
)
SELECT
  ai.id,
  '*',
  public.comparison_normalize_match_key(ai.extracted_name),
  public.comparison_normalize_match_key(ai.extracted_spec),
  public.comparison_normalize_match_key(ai.extracted_origin),
  public.comparison_normalize_match_key(ai.extracted_unit),
  ai.matched_product_id,
  ai.updated_at
FROM public.audit_items ai
WHERE ai.match_status = 'manual_matched'
  AND ai.matched_product_id IS NOT NULL
  AND coalesce(ai.is_excluded, false) = false
ON CONFLICT (item_id) DO NOTHING;

COMMENT ON TABLE public.comparison_sources IS
  '비교 세션에 누적된 원본 거래명세표 묶음. 기관과 원본 공급사를 분리하고 파일 중복을 통제한다.';
COMMENT ON TABLE public.comparison_match_memory IS
  '사용자가 확정한 원본 품목 서명과 신세계 상품의 집계. 충돌을 삭제하지 않고 추천 안전장치로 사용한다.';
COMMENT ON TABLE public.comparison_match_evidence IS
  '품목별 최종 확정 매핑 1건. 반복 확정으로 학습 횟수가 부풀지 않도록 하는 정본이다.';
COMMENT ON TABLE public.comparison_match_events IS
  '추천·선택·확정·제외 이벤트 감사 이력. 추천 품질 지표의 정본이다.';

ALTER TABLE public.comparison_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_match_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_match_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_match_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.record_comparison_match_decision(uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_comparison_match_decision(uuid, text, uuid, uuid, text)
  TO service_role;

COMMIT;
