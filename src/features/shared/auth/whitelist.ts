import { createAdminClient } from '@/lib/supabase/admin'

export type AppRole = 'admin' | 'member'

export interface WhitelistEntry {
  email: string
  role: AppRole
}

/**
 * 이메일 정규화. DB의 `app_user_whitelist.email`은 소문자로만 저장되며
 * (CHECK 제약), 훅 함수도 `lower(trim(...))`로 비교한다. 앱에서도 **같은 규칙**을
 * 써야 훅 통과 / 앱 거부 같은 불일치가 생기지 않는다.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * 화이트리스트 조회. 못 찾으면 null.
 *
 * 왜 필요한가: `before_user_created` 훅은 **가입 시점 1회**만 막는다.
 * 이미 계정이 있는 사용자를 화이트리스트에서 제거해도 세션은 살아있으므로,
 * 매 요청마다 이 함수로 다시 확인해야 권한 회수가 실제로 동작한다.
 */
export async function lookupWhitelistEntry(
  email: string | null | undefined
): Promise<WhitelistEntry | null> {
  const normalized = normalizeEmail(email)
  if (!normalized) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_user_whitelist')
    .select('email, role')
    .eq('email', normalized)
    .maybeSingle()

  if (error) {
    // fail-closed: 조회 실패 시 접근 허용하지 않는다 (돈 다루는 시스템).
    console.error('[auth] whitelist lookup failed', error)
    return null
  }
  if (!data) return null

  return { email: data.email, role: data.role as AppRole }
}
