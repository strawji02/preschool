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

  // /api/* 외 경로는 통과
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
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

// /api/* 만 적용 (정적 리소스/페이지는 통과)
export const config = {
  matcher: ['/api/:path*'],
}
