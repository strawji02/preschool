import { describe, it, expect } from 'vitest'
import { closingTransition, type ClosingStatus } from '@/features/settlement'

/**
 * [정산] 마감 상태 전이 (docs §8)
 *
 * ```
 * 작성중(draft) ──확정──▶ 확정(confirmed) ──마감──▶ 마감(closed)
 *                          ▲                          │
 *                          └──────── 해제 ────────────┘  (admin만)
 * ```
 *
 * ★ **마감된 달은 저장할 수 없다.** 확정까지는 금액을 고칠 수 있지만, 마감은
 * "이 숫자로 세무·지급이 끝났다"는 선언이다. 조용히 덮어쓰면 이미 나간 문서와
 * 장부가 어긋난다.
 *
 * 그래도 **고쳐야 할 때가 온다** — 세무사가 뒤늦게 오류를 찾는 일은 실제로 생긴다.
 * 그래서 막지 않고 **해제라는 별도 동작**으로 분리한다: admin만, 사유 필수,
 * 이력에 남는다.
 */

const CASES: { current: ClosingStatus | null; label: string }[] = [
  { current: null, label: '저장한 적 없음' },
  { current: 'draft', label: '작성중' },
  { current: 'confirmed', label: '확정' },
]

describe('closingTransition — 확정·마감', () => {
  for (const { current, label } of CASES) {
    it(`${label} 상태에서는 확정할 수 있다`, () => {
      const r = closingTransition(current, 'confirm')
      expect(r.allowed).toBe(true)
      expect(r.nextStatus).toBe('confirmed')
    })

    it(`${label} 상태에서는 마감할 수 있다`, () => {
      const r = closingTransition(current, 'close')
      expect(r.allowed).toBe(true)
      expect(r.nextStatus).toBe('closed')
    })
  }

  it('마감된 달은 다시 확정할 수 없다', () => {
    const r = closingTransition('closed', 'confirm')
    expect(r.allowed).toBe(false)
    expect(r.nextStatus).toBeNull()
    expect(r.reason).toContain('마감')
    expect(r.reason).toContain('해제')
  })

  it('마감된 달은 다시 마감할 수 없다 — 덮어쓰기를 막는다', () => {
    const r = closingTransition('closed', 'close')
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('해제')
  })
})

describe('closingTransition — 해제', () => {
  it('마감된 달만 해제할 수 있고, 확정으로 되돌아간다', () => {
    const r = closingTransition('closed', 'reopen')
    expect(r.allowed).toBe(true)
    expect(r.nextStatus).toBe('confirmed')
  })

  for (const { current, label } of CASES) {
    it(`${label} 상태는 해제할 것이 없다`, () => {
      const r = closingTransition(current, 'reopen')
      expect(r.allowed).toBe(false)
      expect(r.nextStatus).toBeNull()
      expect(r.reason).toContain('마감')
    })
  }
})

describe('closingTransition — 거부 사유는 사용자에게 그대로 보여준다', () => {
  it('마감 저장 거부 사유가 다음 행동을 알려준다', () => {
    const r = closingTransition('closed', 'close')
    // "왜 안 되는지"만 말하면 사용자가 막힌다. "그럼 뭘 해야 하는지"까지 준다.
    expect(r.reason).toMatch(/해제/)
  })

  it('허용된 전이에는 사유가 없다', () => {
    expect(closingTransition('confirmed', 'close').reason).toBeNull()
    expect(closingTransition('closed', 'reopen').reason).toBeNull()
  })
})
