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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // /api/* 외 경로는 통과
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const secret = process.env.APP_SHARED_SECRET

  // 1) Server-to-server: X-App-Secret 헤더 일치
  if (secret) {
    const headerSecret = request.headers.get('x-app-secret')
    if (headerSecret && headerSecret === secret) {
      return NextResponse.next()
    }
  }

  // 2) Browser: same-origin or 허용 도메인
  const secFetchSite = request.headers.get('sec-fetch-site')
  if (secFetchSite === 'same-origin') {
    return NextResponse.next()
  }

  // Sec-Fetch-Site가 없는 (older browser) 또는 cross-site일 때 Origin/Referer 검증
  const currentHost = request.headers.get('host')
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  if (isAllowedOrigin(origin, currentHost) || isAllowedOrigin(referer, currentHost)) {
    return NextResponse.next()
  }

  // 3) 모두 실패 → 401
  return NextResponse.json(
    { success: false, error: 'Unauthorized — missing or invalid origin' },
    { status: 401 },
  )
}

// /api/* 만 적용 (정적 리소스/페이지는 통과)
export const config = {
  matcher: ['/api/:path*'],
}
