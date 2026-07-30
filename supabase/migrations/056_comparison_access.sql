-- 056_comparison_access.sql
-- [공통] 급식 비교 시스템 접근 권한 분리 (2026-07-31)
--
-- 지금까지 `/calc-food`는 **로그인 없이** 열려 있었다 (middleware matcher에 없었고
-- 페이지에도 가드가 없었다). 원천 데이터에 거래처 단가가 들어 있으므로
-- 화이트리스트 안에서도 지정한 사람만 볼 수 있게 좁힌다.
--
-- 두 조건을 **모두** 만족해야 한다:
--   1. 화이트리스트에 있고 `can_access_comparison = true`
--   2. (UX) 런처에서 계정 이름을 3회 클릭해야 카드가 보인다
--
-- ⚠️ 2번은 **보안이 아니라 은폐**다. URL을 직접 쳐도 1번이 없으면 막혀야 한다.
-- 실제 경계는 `/calc-food/layout.tsx`의 서버 가드와 API 가드다.

BEGIN;

ALTER TABLE public.app_user_whitelist
  ADD COLUMN IF NOT EXISTS can_access_comparison boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_user_whitelist.can_access_comparison IS
  '급식 비교 시스템 접근 권한. 기본 false — 정산만 쓰는 사람은 볼 수 없다.';

-- 지정 계정에만 연다 (2026-07-31 사용자 확인)
UPDATE public.app_user_whitelist
   SET can_access_comparison = true
 WHERE email = 'w2940285@gmail.com';

COMMIT;
