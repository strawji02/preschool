import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * [정산] Phase 1 인증 도입에 대한 회귀 방어 테스트.
 *
 * 최우선 목적은 **운영 중인 비교 시스템(/api/*)의 동작이 바뀌지 않았음**을 고정하는 것.
 * 그 다음이 신규 /app/* 가드 동작 검증.
 */

// --- 외부 의존성 mock (네트워크 차단) ---
const mockCheckRateLimit = vi.fn()
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  tierForPath: () => 'default',
}))

const mockUpdateSession = vi.fn()
vi.mock('@/lib/supabase/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/middleware')>(
    '@/lib/supabase/middleware'
  )
  return {
    ...actual,
    updateSession: (...args: unknown[]) => mockUpdateSession(...args),
  }
})

const mockLookup = vi.fn()
vi.mock('@/features/shared/auth', () => ({
  lookupWhitelistEntry: (...args: unknown[]) => mockLookup(...args),
}))

const { middleware, config } = await import('@/middleware')

const FAKE_USER = { id: 'u1', email: 'alan@planfit.ai' }

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://firstconsulting.site${path}`), {
    headers: new Headers({ host: 'firstconsulting.site', ...headers }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue({
    success: true,
    limit: 100,
    remaining: 99,
    reset: Date.now() + 1000,
  })
  mockUpdateSession.mockResolvedValue({
    response: NextResponse.next(),
    user: null,
  })
  mockLookup.mockResolvedValue({
    email: 'alan@planfit.ai',
    role: 'admin',
    canAccessComparison: true,
  })
})

/** 로그인 + 비교 권한이 있는 상태로 만든다 */
function loginWithComparison(canAccessComparison = true) {
  mockUpdateSession.mockResolvedValue({ response: NextResponse.next(), user: FAKE_USER })
  mockLookup.mockResolvedValue({
    email: FAKE_USER.email,
    role: 'admin',
    canAccessComparison,
  })
}

/**
 * 비교 시스템 접근 정책 (2026-07-31 변경).
 *
 * ⚠️ **이전 정책을 의도적으로 뒤집었다.** 2026-07-30까지는 `/calc-food`와 비교 API가
 * 로그인 없이 열려 있었고, 이 파일에도 "세션 조회를 하지 않는다"는 회귀 방어가
 * 있었다. 거래처 단가가 담긴 데이터라 화이트리스트 안에서도 지정한 사람만 보도록
 * 좁혔다 (migration 056, 사용자 확인).
 */
describe('비교 시스템 접근 정책', () => {
  it('Origin/Secret 없는 요청은 여전히 401 (기존 방어 유지)', async () => {
    const res = await middleware(req('/api/sessions'))
    expect(res.status).toBe(401)
  })

  it('미로그인 same-origin 요청은 401 — 이제 로그인이 필요하다', async () => {
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).toBe(401)
  })

  it('로그인했지만 비교 권한이 없으면 403', async () => {
    loginWithComparison(false)
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).toBe(403)
  })

  it('권한이 있으면 통과한다', async () => {
    loginWithComparison()
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('X-App-Secret 서버 간 호출은 세션 없이도 통과한다 (내부 작업 보호)', async () => {
    vi.stubEnv('APP_SHARED_SECRET', 's3cret')
    const res = await middleware(req('/api/products', { 'x-app-secret': 's3cret' }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    // 세션 조회를 하지 않아야 배치가 느려지지 않는다
    expect(mockUpdateSession).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('rate limit 초과 시 여전히 429', async () => {
    loginWithComparison()
    mockCheckRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 5000,
    })
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).toBe(429)
  })

  it('정산 API는 비교 권한과 무관하다 — 화이트리스트면 쓴다', async () => {
    loginWithComparison(false)
    const res = await middleware(
      req('/api/settlement/closing', { 'sec-fetch-site': 'same-origin' })
    )
    expect(res.status).not.toBe(403)
  })

  it('/calc-food 미로그인은 /login으로 보낸다', async () => {
    const res = await middleware(req('/calc-food'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/calc-food')
  })

  it('matcher에 /calc-food가 포함된다', () => {
    expect(config.matcher).toEqual([
      '/api/:path*',
      '/app/:path*',
      '/calc-food',
      '/calc-food/:path*',
    ])
  })
})

describe('/app/* 가드', () => {
  it('미로그인은 /login으로 리다이렉트하고 next를 보존한다', async () => {
    const res = await middleware(req('/app/settlement'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/app/settlement')
  })

  it('로그인 사용자는 통과한다', async () => {
    mockUpdateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: FAKE_USER,
    })
    const res = await middleware(req('/app'))
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
  })

  it('갱신된 세션 쿠키가 리다이렉트 응답으로 옮겨진다 (세션 유실 방지)', async () => {
    const withCookie = NextResponse.next()
    withCookie.cookies.set('sb-access-token', 'refreshed')
    mockUpdateSession.mockResolvedValue({ response: withCookie, user: null })

    const res = await middleware(req('/app'))
    expect(res.cookies.get('sb-access-token')?.value).toBe('refreshed')
  })

  it('/app 요청은 origin 검사 401을 받지 않는다 (일반 페이지 내비게이션)', async () => {
    mockUpdateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: FAKE_USER,
    })
    const res = await middleware(req('/app'))
    expect(res.status).not.toBe(401)
  })
})

describe('/api/settlement/* 가드', () => {
  it('미로그인은 same-origin이어도 401', async () => {
    const res = await middleware(
      req('/api/settlement/close', { 'sec-fetch-site': 'same-origin' })
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('로그인')
  })

  it('로그인 상태면 기존 origin 검사로 넘어간다', async () => {
    mockUpdateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: FAKE_USER,
    })
    const res = await middleware(
      req('/api/settlement/close', { 'sec-fetch-site': 'same-origin' })
    )
    expect(res.status).not.toBe(401)
  })
})
