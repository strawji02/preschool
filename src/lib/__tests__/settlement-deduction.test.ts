import { describe, it, expect } from 'vitest'
import {
  DEDUCTION_CATEGORIES,
  sumDeductionItems,
  normalizeDeductionItems,
  buildDeductionSheet,
  type DeductionItem,
} from '@/features/settlement'

/**
 * [정산] 사업자공제(Q) 상세 — docs §3의 "매월 수기 입력 (커피차 등 부가서비스 비용)"
 *
 * 기존 엑셀은 `집계표_정산용` Q열에 `커피차`라고만 적어 뒀고 금액 내역은 남지 않았다.
 * 항목을 구조화해 **무엇 때문에 얼마가 공제됐는지** 남긴다.
 *
 * 합계가 곧 산식의 Q이므로 돈 계산이다 — 반올림·누락 없이 정확히 더해져야 한다.
 */

describe('DEDUCTION_CATEGORIES', () => {
  it('운영에서 쓰는 5개 항목을 제공한다', () => {
    expect(DEDUCTION_CATEGORIES).toEqual([
      '커피차',
      '원아 간식',
      '요리실습 재료',
      '대형매트',
      '조리사 대체인력',
    ])
  })
})

describe('sumDeductionItems', () => {
  it('항목 금액을 그대로 더한다', () => {
    const items: DeductionItem[] = [
      { category: '커피차', amount: 400_000 },
      { category: '원아 간식', amount: 224_000 },
    ]
    expect(sumDeductionItems(items)).toBe(624_000)
  })

  it('빈 목록은 0이다', () => {
    expect(sumDeductionItems([])).toBe(0)
  })

  it('26년 6월 실제 공제액을 재현할 수 있다 (김중영 624,000 / 이동현 1,696,500)', () => {
    expect(
      sumDeductionItems([
        { category: '커피차', amount: 624_000 },
      ])
    ).toBe(624_000)
    expect(
      sumDeductionItems([
        { category: '커피차', amount: 1_200_000 },
        { category: '요리실습 재료', amount: 496_500 },
      ])
    ).toBe(1_696_500)
  })

  it('음수 금액도 그대로 더한다 (환입 처리 여지를 막지 않는다)', () => {
    expect(
      sumDeductionItems([
        { category: '커피차', amount: 500_000 },
        { category: '커피차', amount: -100_000 },
      ])
    ).toBe(400_000)
  })
})

describe('normalizeDeductionItems — 외부 입력 정리', () => {
  it('금액이 숫자로 해석되지 않는 항목은 버린다', () => {
    const raw = [
      { category: '커피차', amount: 100 },
      { category: '원아 간식', amount: 'abc' },
      { category: '대형매트', amount: null },
    ]
    expect(normalizeDeductionItems(raw)).toEqual([{ category: '커피차', amount: 100 }])
  })

  it('금액 0인 항목은 버린다 (입력만 하고 안 채운 줄)', () => {
    const raw = [
      { category: '커피차', amount: 0 },
      { category: '대형매트', amount: 50_000 },
    ]
    expect(normalizeDeductionItems(raw)).toEqual([{ category: '대형매트', amount: 50_000 }])
  })

  it('항목명이 없으면 버린다', () => {
    expect(normalizeDeductionItems([{ category: '', amount: 100 }])).toEqual([])
    expect(normalizeDeductionItems([{ amount: 100 }])).toEqual([])
  })

  it('비고는 보존하고 앞뒤 공백을 없앤다', () => {
    expect(
      normalizeDeductionItems([{ category: '커피차', amount: 100, note: '  6월 2회  ' }])
    ).toEqual([{ category: '커피차', amount: 100, note: '6월 2회' }])
  })

  it('배열이 아니면 빈 목록으로 본다', () => {
    expect(normalizeDeductionItems(null)).toEqual([])
    expect(normalizeDeductionItems('x')).toEqual([])
    expect(normalizeDeductionItems(undefined)).toEqual([])
  })

  it('문자열 숫자는 받아들인다 (폼 입력이 문자열로 올 수 있다)', () => {
    expect(normalizeDeductionItems([{ category: '커피차', amount: '624000' }])).toEqual([
      { category: '커피차', amount: 624_000 },
    ])
  })
})

describe('buildDeductionSheet — 내역서에 붙일 공제 상세 시트', () => {
  const input = [
    {
      partnerName: '김중영',
      items: [
        { category: '커피차', amount: 400_000, note: '6월 2회' },
        { category: '원아 간식', amount: 224_000 },
      ],
    },
    {
      partnerName: '이동현',
      items: [{ category: '요리실습 재료', amount: 1_696_500 }],
    },
  ]

  it('헤더는 영업자·항목·금액·비고다', () => {
    const { rows } = buildDeductionSheet(input)
    expect(rows[0]).toEqual(['영업자', '항목', '금액', '비고'])
  })

  it('항목을 한 줄씩 쓰고 영업자명은 첫 줄에만 넣는다', () => {
    const { rows } = buildDeductionSheet(input)
    expect(rows[1]).toEqual(['김중영', '커피차', 400_000, '6월 2회'])
    expect(rows[2]).toEqual([undefined, '원아 간식', 224_000, undefined])
  })

  it('영업자마다 계 행을 넣는다', () => {
    const { rows } = buildDeductionSheet(input)
    expect(rows[3]).toEqual([undefined, '계', 624_000, undefined])
  })

  it('마지막에 전체 합계를 넣는다', () => {
    const { rows } = buildDeductionSheet(input)
    expect(rows[rows.length - 1]).toEqual(['합계', undefined, 2_320_500, undefined])
  })

  it('26년 6월 실제 공제 합계(2,320,500)와 일치한다', () => {
    // 엑셀 집계표_정산용 합계행 Q = 2,320,500
    const { rows } = buildDeductionSheet(input)
    expect(rows[rows.length - 1][2]).toBe(2_320_500)
  })

  it('공제가 없는 영업자는 아예 넣지 않는다', () => {
    const { rows } = buildDeductionSheet([
      { partnerName: '조성곤', items: [] },
      { partnerName: '김영수', items: [{ category: '대형매트', amount: 10_000 }] },
    ])
    expect(rows.some((r) => r[0] === '조성곤')).toBe(false)
    expect(rows.some((r) => r[0] === '김영수')).toBe(true)
  })

  it('공제가 전혀 없으면 헤더와 합계만 남는다', () => {
    const { rows } = buildDeductionSheet([{ partnerName: '김영수', items: [] }])
    expect(rows).toHaveLength(2)
    expect(rows[1][2]).toBe(0)
  })
})
