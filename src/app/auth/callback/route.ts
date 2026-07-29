import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lookupWhitelistEntry } from '@/features/shared/auth'

/**
 * Google OAuth 콜백. `?code=`를 세션으로 교환한다.
 *
 * 화이트리스트 미승인자는 애초에 `before_user_created` 훅이 계정 생성을 막으므로
 * 보통 여기까지 오지 않고 `?error=`로 돌아온다. 그래도 한 번 더 확인하는 이유는
 * **권한 회수된 기존 계정**은 훅을 타지 않고 로그인에 성공하기 때문이다.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  // Supabase/Google이 거부한 경우 (훅 403 포함)
  const oauthError = searchParams.get('error')
  if (oauthError) {
    const description =
      searchParams.get('error_description') ?? '로그인에 실패했습니다.'
    return NextResponse.redirect(
      `${origin}/login?error=oauth&message=${encodeURIComponent(description)}`
    )
  }

  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // open redirect 방지 — 내부 경로만 허용
  const nextParam = searchParams.get('next')
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
    ? nextParam
    : '/app'

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=exchange&message=${encodeURIComponent(error.message)}`
    )
  }

  const entry = await lookupWhitelistEntry(data.user?.email)
  if (!entry) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=revoked`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
