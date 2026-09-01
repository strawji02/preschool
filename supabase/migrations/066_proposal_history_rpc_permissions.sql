-- 066_proposal_history_rpc_permissions.sql
-- [비교] SECURITY DEFINER 발행 함수는 service_role만 실행하도록 명시적으로 제한

BEGIN;

REVOKE ALL ON FUNCTION public.record_comparison_proposal_version(
  uuid, text, text, text, text, text, text, jsonb, jsonb, text[], boolean, text, jsonb, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_comparison_proposal_version(
  uuid, text, text, text, text, text, text, jsonb, jsonb, text[], boolean, text, jsonb, uuid, timestamptz
) TO service_role;

COMMIT;
