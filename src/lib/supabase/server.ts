import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase Auth용 SSR client (2026-07-29 재활성화).
 *
 * 2026-05-12에 `@deprecated` 처리했던 이유는 "인증이 없어 anon role이 RLS
 * default deny에 걸린다"였다. Supabase Auth 도입으로 그 전제가 바뀌었다.
 *
 * ⚠️ 용도 구분 — 섞지 말 것:
 * - 이 client: **인증 전용** (`auth.getUser()`, `exchangeCodeForSession()`).
 *   쿠키를 읽어야 세션을 알 수 있으므로 SSR client가 필요하다.
 * - 데이터 접근: 여전히 `createAdminClient()` (service_role). public table은
 *   전부 RLS default deny이고 authenticated용 policy를 만들지 않았다.
 *
 * @see src/lib/supabase/admin.ts
 * @see src/features/shared/auth
 */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서는 쿠키 설정이 안될 수 있음
          }
        },
      },
    }
  )
}
