-- 046_security_hardening.sql
-- 보안 감사 대응 (Supabase advisor 2026-05-11):
-- 1) RLS Disabled in Public — 6개 public table 모두 RLS 미활성
-- 2) Sensitive Columns Exposed — audit_files.session_id, audit_items.session_id
-- 3) Function Search Path Mutable — 9개 RPC 함수 search_path 미고정 (injection 위험)
--
-- 접근 모델 (확인):
-- - 클라이언트는 직접 Supabase 호출 없음 (browser createClient 사용처 0)
-- - 모든 server route는 createAdminClient (service_role) 사용 — RLS bypass 자동
-- - server.ts (anon key) 사용처 1곳 → admin.ts로 마이그레이션 (별도 코드 변경)
--
-- 결과:
-- - anon/authenticated은 모든 table에 default deny — policy 없으면 SELECT/INSERT 차단
-- - service_role은 RLS bypass — server route는 정상 작동
-- - 함수 search_path 고정으로 schema 변경 injection 차단

BEGIN;

-- 1. 모든 public table RLS enable (policy 없음 = default deny)
ALTER TABLE public.unit_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ocr_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_items ENABLE ROW LEVEL SECURITY;

-- 2. 모든 RPC 함수 search_path 고정 (CVE-2018-1058 방지)
-- SET search_path = public, pg_temp — schema-qualified 강제, public 스키마만 신뢰
DO $$
DECLARE
  fn_oid oid;
  fn_sig text;
  fn_list text[] := ARRAY[
    'public.search_products_vector',
    'public.search_products_bm25',
    'public.search_products_fuzzy',
    'public.search_products_hybrid',
    'public.search_products_hybrid_v2',
    'public.search_products_hybrid_bm25_vector',
    'public.update_session_stats',
    'public.get_embedding_stats',
    'public.char_overlap_ratio'
  ];
  fn_name text;
BEGIN
  FOREACH fn_name IN ARRAY fn_list LOOP
    -- 오버로드된 함수 모두 처리 (같은 이름에 다른 시그니처)
    FOR fn_oid IN
      SELECT p.oid FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = split_part(fn_name, '.', 1)
        AND p.proname = split_part(fn_name, '.', 2)
    LOOP
      SELECT pg_get_function_identity_arguments(fn_oid) INTO fn_sig;
      EXECUTE format('ALTER FUNCTION %s(%s) SET search_path = public, pg_temp', fn_name, fn_sig);
    END LOOP;
  END LOOP;
END $$;

COMMIT;

COMMENT ON TABLE public.audit_sessions IS
  'RLS enabled (default deny). Access only via server route with service_role key.';
COMMENT ON TABLE public.audit_items IS
  'RLS enabled (default deny). Contains session_id (PII). Access via service_role only.';
COMMENT ON TABLE public.audit_files IS
  'RLS enabled (default deny). Contains session_id (PII). Access via service_role only.';
