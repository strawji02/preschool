import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { lookupWhitelistEntry, type AppRole } from './whitelist'

export interface AppUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  role: AppRole
  /** 급식 비교 시스템 접근 권한 (migration 056) */
  canAccessComparison: boolean
}

/**
 * 현재 로그인 사용자를 반환. 비로그인 또는 **화이트리스트 이탈** 시 null.
 *
 * `getUser()`를 쓰는 이유: `getSession()`은 쿠키를 그대로 신뢰하지만
 * `getUser()`는 Auth 서버에 검증을 요청한다. 서버 가드에서는 항상 `getUser()`.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) return null

  const entry = await lookupWhitelistEntry(user.email)
  if (!entry) return null

  const meta = user.user_metadata ?? {}
  return {
    id: user.id,
    email: entry.email,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
    role: entry.role,
    canAccessComparison: entry.canAccessComparison,
  }
}

/**
 * `/app/*` 서버 컴포넌트용 가드. 통과 못 하면 렌더링 자체를 중단하고 /login으로 보낸다.
 *
 * middleware의 세션 체크는 UX(빠른 리다이렉트)용이고, **보안 경계는 여기**다.
 * 페이지/레이아웃에서 반드시 이 함수를 거칠 것.
 */
export async function requireUser(nextPath?: string): Promise<AppUser> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect(loginUrl({ next: nextPath }))
  }

  const entry = await lookupWhitelistEntry(user.email)
  if (!entry) {
    // 계정은 살아있는데 화이트리스트에서 빠진 경우 = 권한 회수.
    // 세션을 끊어야 다음 요청에서 무한 리다이렉트가 생기지 않는다.
    await supabase.auth.signOut()
    redirect(loginUrl({ error: 'revoked' }))
  }

  const meta = user.user_metadata ?? {}
  return {
    id: user.id,
    email: entry.email,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
    role: entry.role,
    canAccessComparison: entry.canAccessComparison,
  }
}

/**
 * 급식 비교 시스템 가드 (migration 056).
 *
 * 화이트리스트 통과만으로는 부족하다 — `can_access_comparison`이 있어야 한다.
 * 런처에서 카드를 숨기는 3클릭은 UX 장치일 뿐이고, **URL을 직접 쳐도 여기서 막힌다.**
 */
export async function requireComparisonAccess(nextPath?: string): Promise<AppUser> {
  const user = await requireUser(nextPath)
  if (!user.canAccessComparison) {
    redirect('/app?error=comparison-forbidden')
  }
  return user
}

/** 관리자 전용 화면 가드 */
export async function requireAdmin(nextPath?: string): Promise<AppUser> {
  const user = await requireUser(nextPath)
  if (user.role !== 'admin') {
    redirect('/app?error=forbidden')
  }
  return user
}

function loginUrl(params: { next?: string; error?: string }): string {
  const search = new URLSearchParams()
  if (params.next) search.set('next', params.next)
  if (params.error) search.set('error', params.error)
  const qs = search.toString()
  return qs ? `/login?${qs}` : '/login'
}
