import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * @deprecated (2026-05-12) anon key 기반 SSR client.
 *
 * 모든 public table에 RLS가 활성화되어 anon role은 default deny.
 * server-side에서 DB 접근 시 반드시 createAdminClient (service_role) 사용.
 * 향후 Supabase Auth 도입 시점에 재활성화 검토.
 *
 * @see src/lib/supabase/admin.ts
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
