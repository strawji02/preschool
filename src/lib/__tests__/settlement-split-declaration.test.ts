import { describe, it, expect } from 'vitest'
import { carryOverSplits } from '@/features/settlement/calc/split-declaration'

/**
 * [정산] 지난달 분할 명의 이어받기 (docs §4)
 *
 * ★ **명의는 그대로, 금액은 이번 달 신고액에 맞춰 다시 나눈다.**
 * 매달 같은 사람들에게 나눠 신고하는데 신고액은 달마다 다르다. 지난달 금액을
 * 그대로 가져오면 합계가 안 맞아 마감이 막히고, 사용자가 계산기를 두드려야 한다.
 *
 * ⚠️ **합계는 신고액과 1원도 어긋나면 안 된다.** 반올림 차액은 첫 행에 몰아준다.
 */
describe('carryOverSplits — 지난달 명의 이어받기', () => {
  /** 26년 6월 실제 값 */
  const june = [
    { name: '이동현', amount: 4_490_317 },
    { name: '김인순', amount: 5_000_000 },
    { name: '이유나', amount: 4_000_000 },
  ]

  it('신고액이 같으면 지난달 금액 그대로', () => {
    const out = carryOverSplits(june, 13_490_317)
    expect(out).toEqual(june)
  })

  it('신고액이 다르면 비율대로 나누고 합계를 정확히 맞춘다', () => {
    const out = carryOverSplits(june, 10_000_000)
    expect(out.map((s) => s.name)).toEqual(['이동현', '김인순', '이유나'])
    expect(out.reduce((a, s) => a + s.amount, 0)).toBe(10_000_000)
    // 비율이 유지되는지 — 김인순은 지난달 37.06%
    expect(out[1].amount).toBeGreaterThan(3_600_000)
    expect(out[1].amount).toBeLessThan(3_800_000)
  })

  it('반올림 차액은 첫 행이 흡수한다', () => {
    const out = carryOverSplits(
      [
        { name: 'A', amount: 1 },
        { name: 'B', amount: 1 },
        { name: 'C', amount: 1 },
      ],
      100
    )
    expect(out.reduce((a, s) => a + s.amount, 0)).toBe(100)
    expect(out.map((s) => s.amount)).toEqual([34, 33, 33])
  })

  it('지난달 합계가 0이면 첫 명의에 전액', () => {
    const out = carryOverSplits([{ name: 'A', amount: 0 }, { name: 'B', amount: 0 }], 5000)
    expect(out).toEqual([
      { name: 'A', amount: 5000 },
      { name: 'B', amount: 0 },
    ])
  })

  it('지난달이 없으면 빈 배열', () => {
    expect(carryOverSplits([], 1000)).toEqual([])
  })
})
