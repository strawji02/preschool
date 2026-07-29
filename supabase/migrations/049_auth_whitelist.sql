-- 049_auth_whitelist.sql
-- [정산] Phase 1 — Supabase Auth 화이트리스트
--
-- 목적: 승인된 이메일만 가입 가능. Before User Created Hook으로 **가입 자체를 차단**한다.
--       (가입 후 권한 체크가 아니라 auth.users INSERT 이전에 거부 → 계정이 생기지 않음)
--
-- 2단 방어:
--   1) before_user_created 훅 — 신규 가입 차단 (이 마이그레이션)
--   2) 매 요청 서버 가드 — 이미 만들어진 계정의 화이트리스트 이탈(회수) 처리
--      → src/features/shared/auth/require-user.ts
--
-- 접근 모델: 앱 서버는 service_role(RLS bypass)로 읽는다.
--            supabase_auth_admin은 훅 실행을 위해 SELECT만 허용.
--            anon/authenticated는 default deny (이메일 목록 = 개인정보).

BEGIN;

-- ============================================================
-- 1. 화이트리스트 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_user_whitelist (
  email       text PRIMARY KEY,
  role        text NOT NULL DEFAULT 'member',
  note        text,
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- 이메일은 항상 소문자 정규화해서 저장 (훅에서 lower() 비교하므로 필수)
  CONSTRAINT app_user_whitelist_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT app_user_whitelist_email_format CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT app_user_whitelist_role_valid CHECK (role IN ('admin', 'member'))
);

COMMENT ON TABLE public.app_user_whitelist IS
  '가입 승인 이메일 목록. before_user_created 훅이 참조. RLS default deny — service_role/supabase_auth_admin만 접근.';
COMMENT ON COLUMN public.app_user_whitelist.role IS
  'admin = 화이트리스트/마스터 관리 가능, member = 일반 사용자';

ALTER TABLE public.app_user_whitelist ENABLE ROW LEVEL SECURITY;

-- 훅 실행 주체(supabase_auth_admin)만 SELECT 허용. 앱은 service_role로 RLS bypass.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON TABLE public.app_user_whitelist TO supabase_auth_admin;
REVOKE ALL ON TABLE public.app_user_whitelist FROM authenticated, anon, public;

DROP POLICY IF EXISTS "auth admin reads whitelist" ON public.app_user_whitelist;
CREATE POLICY "auth admin reads whitelist"
  ON public.app_user_whitelist
  AS PERMISSIVE FOR SELECT
  TO supabase_auth_admin
  USING (true);

-- ============================================================
-- 2. Before User Created Hook
-- ============================================================
-- 반환 규약:
--   허용 → event 를 그대로 반환
--   거부 → {"error": {"http_code": 403, "message": "..."}}
-- 주의: Postgres 훅은 2초 타임아웃, 에러는 retry 되지 않는다.
CREATE OR REPLACE FUNCTION public.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  incoming_email text;
BEGIN
  incoming_email := lower(trim(event -> 'user' ->> 'email'));

  -- 이메일 없는 가입(전화/익명 등)은 이 앱에서 허용하지 않는다.
  IF incoming_email IS NULL OR incoming_email = '' THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '이메일 기반 가입만 허용됩니다.'
      )
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.app_user_whitelist w
    WHERE w.email = incoming_email
  ) THEN
    RETURN event;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '승인되지 않은 계정입니다. 관리자에게 접근 권한을 요청하세요.'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.before_user_created(jsonb) IS
  'Supabase Before User Created Hook. app_user_whitelist에 없는 이메일의 가입을 403으로 거부.';

GRANT EXECUTE ON FUNCTION public.before_user_created(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.before_user_created(jsonb) FROM authenticated, anon, public;

-- ============================================================
-- 3. 최초 관리자 시드
-- ============================================================
INSERT INTO public.app_user_whitelist (email, role, note)
VALUES ('alan@planfit.ai', 'admin', '최초 관리자 (Phase 1 시드)')
ON CONFLICT (email) DO NOTHING;

COMMIT;
