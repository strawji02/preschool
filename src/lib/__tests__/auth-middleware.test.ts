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
})

describe('비교 시스템 /api/* 회귀 방어', () => {
  it('same-origin 브라우저 요청은 그대로 통과한다', async () => {
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).not.toBe(401)
  })

  it('허용 도메인 Origin 요청은 통과한다', async () => {
    const res = await middleware(
      req('/api/sessions', { origin: 'https://firstconsulting.site' })
    )
    expect(res.status).not.toBe(401)
  })

  it('Origin/Secret 없는 요청은 여전히 401', async () => {
    const res = await middleware(req('/api/sessions'))
    expect(res.status).toBe(401)
  })

  it('rate limit 초과 시 여전히 429', async () => {
    mockCheckRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 5000,
    })
    const res = await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(res.status).toBe(429)
  })

  it('비교 API에서는 Supabase 세션 조회를 하지 않는다 (지연·비용 회귀 방지)', async () => {
    await middleware(req('/api/analyze', { 'sec-fetch-site': 'same-origin' }))
    expect(mockUpdateSession).not.toHaveBeenCalled()
  })

  it('공개 페이지(/, /calc-food)는 matcher 대상이 아니다', () => {
    expect(config.matcher).toEqual(['/api/:path*', '/app/:path*'])
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
