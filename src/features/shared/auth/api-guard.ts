import { NextResponse } from 'next/server'
import { getCurrentUser, type AppUser } from './current-user'

/**
 * 정산 API 라우트용 가드.
 *
 * 사용법 — 통과하면 user, 아니면 그대로 반환할 401/403 응답이 온다:
 * ```ts
 * const guard = await requireApiUser()
 * if ('response' in guard) return guard.response
 * const { user } = guard
 * ```
 *
 * middleware도 `/api/settlement/*`를 막지만, 라우트 핸들러에서 한 번 더 확인한다.
 * middleware matcher는 실수로 빠지기 쉬운 설정이라 보안 경계로 삼지 않는다.
 */
export async function requireApiUser(): Promise<
  { user: AppUser } | { response: NextResponse }
> {
  const user = await getCurrentUser()
  if (!user) {
    return {
      response: NextResponse.json(
        { success: false, error: '로그인이 필요합니다.' },
        { status: 401 }
      ),
    }
  }
  return { user }
}

/** 관리자 전용 API 가드 */
export async function requireApiAdmin(): Promise<
  { user: AppUser } | { response: NextResponse }
> {
  const guard = await requireApiUser()
  if ('response' in guard) return guard
  if (guard.user.role !== 'admin') {
    return {
      response: NextResponse.json(
        { success: false, error: '관리자 권한이 필요합니다.' },
        { status: 403 }
      ),
    }
  }
  return guard
}
