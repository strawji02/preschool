import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 화이트리스트 조회 규칙.
 *
 * DB의 `app_user_whitelist.email`은 CHECK 제약으로 소문자만 저장되고,
 * `before_user_created` 훅도 `lower(trim(...))`로 비교한다.
 * 앱이 다른 규칙을 쓰면 "가입은 됐는데 앱에서 거부" 같은 불일치가 생기므로 고정한다.
 */

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const { normalizeEmail, lookupWhitelistEntry } = await import(
  '@/features/shared/auth/whitelist'
)

beforeEach(() => {
  vi.clearAllMocks()
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
})

describe('normalizeEmail', () => {
  it('소문자로 변환한다', () => {
    expect(normalizeEmail('Alan@Planfit.AI')).toBe('alan@planfit.ai')
  })

  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeEmail('  alan@planfit.ai \n')).toBe('alan@planfit.ai')
  })

  it('null/undefined/빈 문자열은 빈 문자열', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
    expect(normalizeEmail('   ')).toBe('')
  })
})

describe('lookupWhitelistEntry', () => {
  it('정규화된 이메일로 조회한다', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { email: 'alan@planfit.ai', role: 'admin', can_access_comparison: true },
      error: null,
    })

    const entry = await lookupWhitelistEntry('  Alan@Planfit.AI ')

    expect(mockFrom).toHaveBeenCalledWith('app_user_whitelist')
    expect(mockEq).toHaveBeenCalledWith('email', 'alan@planfit.ai')
    expect(entry).toEqual({
      email: 'alan@planfit.ai',
      role: 'admin',
      canAccessComparison: true,
    })
  })

  it('can_access_comparison이 null이면 false로 읽는다', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { email: 'a@b.com', role: 'member', can_access_comparison: null },
      error: null,
    })
    const entry = await lookupWhitelistEntry('a@b.com')
    expect(entry!.canAccessComparison).toBe(false)
  })

  it('목록에 없으면 null', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await lookupWhitelistEntry('stranger@example.com')).toBeNull()
  })

  it('이메일이 비어 있으면 DB 조회 없이 null', async () => {
    expect(await lookupWhitelistEntry(null)).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DB 오류 시 fail-closed — 통과시키지 않는다', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection reset' },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await lookupWhitelistEntry('alan@planfit.ai')).toBeNull()

    spy.mockRestore()
  })
})
