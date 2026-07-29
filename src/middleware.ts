/**
 * API 인증 middleware (2026-05-12)
 *
 * 익명 앱 (인증 없음)이지만 mutation API가 노출되어
 * 누구나 curl/script로 `DELETE /api/sessions/<id>` 등 호출 가능했던 문제 fix.
 *
 * 방식 (옵션 A — shared secret + origin guard):
 * 1) 브라우저 요청: Sec-Fetch-Site === 'same-origin' OR Origin/Referer가
 *    허용 도메인이면 통과 (사용자 영향 0)
 * 2) 서버-서버 요청 (internal job, curl 테스트 등): X-App-Secret 헤더가
 *    APP_SHARED_SECRET env와 일치하면 통과
 * 3) 둘 다 실패하면 401
 *
 * 차단 효과:
 * - 자동화 봇/스크래퍼: Origin 헤더 누락 → 401
 * - curl/직접 호출: X-App-Secret 없으면 401
 * - 일반 브라우저 사용자: 자동으로 same-origin → 통과 (UX 영향 0)
 *
 * @see docs/SECURITY.md
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRateLimit, tierForPath } from '@/lib/ratelimit'
import { updateSession, copyCookies } from '@/lib/supabase/middleware'

// 허용 도메인 — production + Vercel preview
// 환경변수로 추가 도메인 허용 가능 (콤마 구분)
const DEFAULT_ALLOWED_HOSTS = [
  'firstconsulting.site',
  'www.firstconsulting.site',
]

function getAllowedHosts(): string[] {
  const extra = (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...DEFAULT_ALLOWED_HOSTS, ...extra]
}

function isAllowedOrigin(originOrReferer: string | null, currentHost: string | null): boolean {
  if (!originOrReferer) return false
  try {
    const url = new URL(originOrReferer)
    const allowed = getAllowedHosts()
    // 현재 host와 동일 → same-origin
    if (currentHost && url.host === currentHost) return true
    // 허용 도메인 매칭
    if (allowed.includes(url.host)) return true
    // Vercel preview (*.vercel.app) — host suffix 매칭
    if (url.host.endsWith('.vercel.app')) return true
    return false
  } catch {
    return false
  }
}

function getClientIp(request: NextRequest): string {
  // Vercel/Cloudflare: x-forwarded-for의 첫 IP
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /app/* — Supabase 세션 갱신 + 미로그인 리다이렉트 (2026-07-29 추가)
  // 보안 경계는 여기가 아니라 /app/layout.tsx의 requireUser()다.
  if (pathname.startsWith('/app')) {
    return appGuard(request)
  }

  // /api/* 외 경로는 통과
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // 정산 API는 세션 필수 (미로그인 401). 라우트 핸들러에서 requireApiUser()로 재확인한다.
  if (pathname.startsWith('/api/settlement')) {
    const denied = await settlementApiGuard(request)
    if (denied) return denied
  }

  // === Origin/Secret 검증 ===
  const secret = process.env.APP_SHARED_SECRET
  let authPassed = false

  // 1) Server-to-server: X-App-Secret 헤더 일치
  if (secret) {
    const headerSecret = request.headers.get('x-app-secret')
    if (headerSecret && headerSecret === secret) {
      authPassed = true
    }
  }

  if (!authPassed) {
    // 2) Browser: same-origin or 허용 도메인
    const secFetchSite = request.headers.get('sec-fetch-site')
    if (secFetchSite === 'same-origin') {
      authPassed = true
    } else {
      const currentHost = request.headers.get('host')
      const origin = request.headers.get('origin')
      const referer = request.headers.get('referer')
      if (isAllowedOrigin(origin, currentHost) || isAllowedOrigin(referer, currentHost)) {
        authPassed = true
      }
    }
  }

  if (!authPassed) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized — missing or invalid origin' },
      { status: 401 },
    )
  }

  // === Rate limit 검사 ===
  // X-App-Secret으로 통과한 server-server 호출은 ratelimit 면제 (internal job)
  const isServerCall = secret && request.headers.get('x-app-secret') === secret
  if (!isServerCall) {
    const ip = getClientIp(request)
    const tier = tierForPath(pathname)
    try {
      const result = await checkRateLimit(ip, tier)
      if (!result.success) {
        const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
        return NextResponse.json(
          {
            success: false,
            error: `Too many requests. Retry after ${retryAfter}s`,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(result.limit),
              'X-RateLimit-Remaining': String(result.remaining),
              'X-RateLimit-Reset': String(result.reset),
            },
          },
        )
      }
    } catch (err) {
      // Ratelimit 실패 시 fail-open (서비스 가용성 우선)
      console.error('[ratelimit]', err)
    }
  }

  return NextResponse.next()
}

/**
 * /app/* 가드 — 세션 쿠키를 갱신하고, 미로그인 사용자를 /login으로 보낸다.
 *
 * 화이트리스트 회수 확인은 여기서 하지 않는다 (middleware는 요청마다 도는 hot path).
 * 그건 /app/layout.tsx의 requireUser()가 담당한다.
 */
async function appGuard(request: NextRequest): Promise<NextResponse> {
  const { response, user } = await updateSession(request)

  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    // 갱신된 쿠키를 리다이렉트 응답에 옮기지 않으면 세션이 어긋난다.
    return copyCookies(response, NextResponse.redirect(loginUrl))
  }

  return response
}

/** 정산 API 세션 가드. 통과면 null, 미로그인이면 401 응답. */
async function settlementApiGuard(
  request: NextRequest
): Promise<NextResponse | null> {
  const { response, user } = await updateSession(request)
  if (user) return null

  return copyCookies(
    response,
    NextResponse.json(
      { success: false, error: '로그인이 필요합니다.' },
      { status: 401 }
    )
  )
}

// /api/* + /app/* 적용 (정적 리소스/공개 페이지는 통과)
export const config = {
  matcher: ['/api/:path*', '/app/:path*'],
}
