import { describe, it, expect } from 'vitest'
import {
  buildSettlementSheet,
  venueDisplayName,
  calcSettlement,
  type ReportPartnerBlock,
  type NormalizedVenue,
} from '@/features/settlement'

/**
 * [정산] 영업자별 개별 정산 내역서 (docs §6-2)
 *
 * 담당자가 기존 엑셀과 **1:1로 대조**할 수 있어야 하므로, 근거 파일의
 * `집계표_정산용` 레이아웃을 그대로 재현한다 (2026-07-29 실측).
 *
 * ```
 * 1~2행: 공백
 * 3행:  A 구분 | B 식당명 | C 원가(C~G 병합) | H 단가(H~L) | M 차액 | O 정산(O~U) | V 사업소득
 * 4행:  C 공급가 D 세액 E 금액 F 면세 G 합계 | H 공급가 I 세액 J 금액 K 면세 L 합계
 *       | O 적립금 P 부가세차액 Q 사업자공제 R 지급액(세전) S 사업소득세 T 지방세 U 실지급액 | V 신고액
 * 5행~: 영업자 블록 = 식당 행들(C~M만 채움) + `계` 행(C~M 합계 + O~V 산식)
 * 끝:   `합계` 행
 * ```
 *
 * - **N열은 비어 있다** (원본도 그렇다). 산식 문서의 컬럼 기호와 맞추기 위한 공백.
 * - 식당 행에는 정산 열(O~V)이 없다. 산식은 영업자 단위이므로 `계` 행에만 들어간다.
 * - Q열(사업자공제) 자리에 식당 행에서는 **메모**가 들어갈 수 있다(원본: `커피차`).
 * - 정산 대상이 아닌 블록(본사)은 `계` 행에도 O~V를 비운다.
 */

/** 0-based 열 인덱스 — 엑셀 열문자와 대응 */
const C = {
  division: 0, // A
  venue: 1, // B
  costSupply: 2, // C
  costVat: 3, // D
  costAmount: 4, // E  = 공급가 + 세액
  costExempt: 5, // F
  costTotal: 6, // G  = 금액 + 면세
  priceSupply: 7, // H
  priceVat: 8, // I
  priceAmount: 9, // J
  priceExempt: 10, // K
  priceTotal: 11, // L
  margin: 12, // M
  blank: 13, // N (항상 비어 있음)
  platformFee: 14, // O
  vatDiff: 15, // P
  deduction: 16, // Q
  preTax: 17, // R
  incomeTax: 18, // S
  localTax: 19, // T
  netPay: 20, // U
  declared: 21, // V
} as const

function line(name: string, cost: [number, number, number], price: [number, number, number], memo?: string) {
  const [cs, cv, ce] = cost
  const [ps, pv, pe] = price
  return {
    venueName: name,
    cost: { taxableSupply: cs, vat: cv, exempt: ce, total: cs + cv + ce },
    price: { taxableSupply: ps, vat: pv, exempt: pe, total: ps + pv + pe },
    memo,
  }
}

/** 단순 블록 — 원가 공급가 1,000,000 / 단가 공급가 1,300,000 */
function simpleBlock(overrides: Partial<ReportPartnerBlock> = {}): ReportPartnerBlock {
  const lines = [line('가유치원 급식', [1_000_000, 100_000, 0], [1_300_000, 130_000, 0])]
  return {
    partnerName: '김영수',
    lines,
    settlement: calcSettlement({
      costTotal: 1_100_000,
      costVat: 100_000,
      priceTotal: 1_430_000,
      priceVat: 130_000,
      partnerType: 'partner',
    }),
    ...overrides,
  }
}

describe('buildSettlementSheet — 헤더', () => {
  const { rows } = buildSettlementSheet([simpleBlock()])

  it('1~2행은 비어 있다 (원본과 동일)', () => {
    expect(rows[0]).toEqual([])
    expect(rows[1]).toEqual([])
  })

  it('3행은 그룹 헤더다', () => {
    const r = rows[2]
    expect(r[C.division]).toBe('구분')
    expect(r[C.venue]).toBe('식당명')
    expect(r[C.costSupply]).toBe('원가')
    expect(r[C.priceSupply]).toBe('단가')
    expect(r[C.margin]).toBe('차액')
    expect(r[C.platformFee]).toBe('정산')
    expect(r[C.declared]).toBe('사업소득')
  })

  it('4행은 세부 헤더다', () => {
    const r = rows[3]
    expect(r[C.costSupply]).toBe('공급가')
    expect(r[C.costVat]).toBe('세액')
    expect(r[C.costAmount]).toBe('금액')
    expect(r[C.costExempt]).toBe('면세')
    expect(r[C.costTotal]).toBe('합계')
    expect(r[C.priceTotal]).toBe('합계')
    expect(r[C.platformFee]).toBe('적립금')
    expect(r[C.vatDiff]).toBe('부가세차액')
    expect(r[C.deduction]).toBe('사업자공제')
    expect(r[C.preTax]).toBe('지급액(세전)')
    expect(r[C.incomeTax]).toBe('사업소득세')
    expect(r[C.localTax]).toBe('지방세')
    expect(r[C.netPay]).toBe('실지급액')
    expect(r[C.declared]).toBe('신고액')
  })

  it('N열은 헤더에서도 비어 있다', () => {
    expect(rows[2][C.blank]).toBeUndefined()
    expect(rows[3][C.blank]).toBeUndefined()
  })
})

describe('buildSettlementSheet — 식당 행', () => {
  const { rows } = buildSettlementSheet([simpleBlock()])
  const venueRow = rows[4]

  it('블록 첫 행에 영업자명이 들어간다', () => {
    expect(venueRow[C.division]).toBe('김영수')
  })

  it('금액(E)은 공급가 + 세액이다', () => {
    expect(venueRow[C.costAmount]).toBe(1_100_000)
    expect(venueRow[C.priceAmount]).toBe(1_430_000)
  })

  it('합계(G/L)는 금액 + 면세다', () => {
    expect(venueRow[C.costTotal]).toBe(1_100_000)
    expect(venueRow[C.priceTotal]).toBe(1_430_000)
  })

  it('차액(M)은 단가합계 − 원가합계다', () => {
    expect(venueRow[C.margin]).toBe(330_000)
  })

  it('식당 행에는 정산 열(O~V)이 없다 — 산식은 영업자 단위다', () => {
    for (const c of [C.platformFee, C.vatDiff, C.preTax, C.incomeTax, C.localTax, C.netPay, C.declared]) {
      expect(venueRow[c]).toBeUndefined()
    }
  })

  it('두 번째 식당 행부터는 영업자명이 비어 있다 (병합 대상)', () => {
    const block = simpleBlock({
      lines: [
        line('가유치원 급식', [100, 10, 0], [200, 20, 0]),
        line('가유치원 간식', [50, 5, 0], [80, 8, 0]),
      ],
    })
    const { rows } = buildSettlementSheet([block])
    expect(rows[4][C.division]).toBe('김영수')
    expect(rows[5][C.division]).toBeUndefined()
    expect(rows[5][C.venue]).toBe('가유치원 간식')
  })

  it('메모는 Q열(사업자공제 자리)에 들어간다 — 원본의 커피차 표기', () => {
    const block = simpleBlock({
      lines: [line('나래유치원 오전간식', [0, 0, 10_830], [0, 0, 18_050], '커피차')],
    })
    const { rows } = buildSettlementSheet([block])
    expect(rows[4][C.deduction]).toBe('커피차')
    expect(rows[4][C.costExempt]).toBe(10_830)
    expect(rows[4][C.margin]).toBe(7_220)
  })
})

describe('buildSettlementSheet — 계 행', () => {
  const block = simpleBlock({
    lines: [
      line('가유치원 급식', [1_000_000, 100_000, 0], [1_300_000, 130_000, 0]),
      line('가유치원 간식', [0, 0, 500_000], [0, 0, 700_000]),
    ],
    settlement: calcSettlement({
      costTotal: 1_600_000,
      costVat: 100_000,
      priceTotal: 2_130_000,
      priceVat: 130_000,
      partnerType: 'cofounder',
      businessDeduction: 20_000,
    }),
  })
  const { rows } = buildSettlementSheet([block])
  const totalRow = rows[6] // 헤더 4 + 식당 2

  it('구분에 계라고 쓰고 식당명은 비운다', () => {
    expect(totalRow[C.division]).toBe('계')
    expect(totalRow[C.venue]).toBeUndefined()
  })

  it('원가·단가·차액은 식당 행의 합이다', () => {
    expect(totalRow[C.costSupply]).toBe(1_000_000)
    expect(totalRow[C.costVat]).toBe(100_000)
    expect(totalRow[C.costExempt]).toBe(500_000)
    expect(totalRow[C.costTotal]).toBe(1_600_000)
    expect(totalRow[C.priceTotal]).toBe(2_130_000)
    expect(totalRow[C.margin]).toBe(530_000)
  })

  it('정산 열에 산식 결과가 들어간다', () => {
    const s = block.settlement!
    expect(totalRow[C.platformFee]).toBe(s.platformFee)
    expect(totalRow[C.vatDiff]).toBe(s.vatDiff)
    expect(totalRow[C.deduction]).toBe(s.businessDeduction)
    expect(totalRow[C.preTax]).toBe(s.preTax)
    expect(totalRow[C.incomeTax]).toBe(s.incomeTax)
    expect(totalRow[C.localTax]).toBe(s.localTax)
    expect(totalRow[C.netPay]).toBe(s.netPay)
    expect(totalRow[C.declared]).toBe(s.declared)
  })

  it('계 행의 차액은 산식의 margin과 같아야 한다 (집계 정합성)', () => {
    expect(totalRow[C.margin]).toBe(block.settlement!.margin)
  })
})

describe('buildSettlementSheet — 정산 제외 블록 (본사)', () => {
  const hq: ReportPartnerBlock = {
    partnerName: '본사',
    lines: [line('키즈웰에듀푸드(본사) 본사', [9_050, 905, 0], [11_750, 1_175, 0])],
    settlement: null, // 정산 대상 아님
  }
  const { rows } = buildSettlementSheet([hq])

  it('식당 행과 계 행은 그대로 나온다', () => {
    expect(rows[4][C.division]).toBe('본사')
    expect(rows[5][C.division]).toBe('계')
    expect(rows[5][C.costTotal]).toBe(9_955)
    expect(rows[5][C.margin]).toBe(2_970)
  })

  it('계 행의 정산 열(O~V)은 비어 있다', () => {
    for (const c of [C.platformFee, C.vatDiff, C.deduction, C.preTax, C.incomeTax, C.localTax, C.netPay, C.declared]) {
      expect(rows[5][c]).toBeUndefined()
    }
  })
})

describe('buildSettlementSheet — 합계 행', () => {
  const blocks: ReportPartnerBlock[] = [
    {
      partnerName: '본사',
      lines: [line('본사', [9_050, 905, 0], [11_750, 1_175, 0])],
      settlement: null,
    },
    simpleBlock(),
  ]
  const { rows } = buildSettlementSheet(blocks)
  const last = rows[rows.length - 1]

  it('마지막 행은 합계다', () => {
    expect(last[C.division]).toBe('합계')
  })

  it('정산 제외 블록의 원가·단가도 합계에 포함한다 (원본과 동일)', () => {
    expect(last[C.costTotal]).toBe(9_955 + 1_100_000)
    expect(last[C.priceTotal]).toBe(12_925 + 1_430_000)
  })

  it('정산 열 합계는 정산 대상 블록만 더한다', () => {
    const s = blocks[1].settlement!
    expect(last[C.platformFee]).toBe(s.platformFee)
    expect(last[C.preTax]).toBe(s.preTax)
    expect(last[C.netPay]).toBe(s.netPay)
  })
})

describe('buildSettlementSheet — 병합', () => {
  it('헤더 병합을 원본과 동일하게 만든다', () => {
    const { merges } = buildSettlementSheet([simpleBlock()])
    const asText = merges.map((m) => `${m.s.r},${m.s.c}-${m.e.r},${m.e.c}`)
    expect(asText).toContain('2,0-3,0') // A3:A4 구분
    expect(asText).toContain('2,1-3,1') // B3:B4 식당명
    expect(asText).toContain('2,2-2,6') // C3:G3 원가
    expect(asText).toContain('2,7-2,11') // H3:L3 단가
    expect(asText).toContain('2,12-3,12') // M3:M4 차액
    expect(asText).toContain('2,14-2,20') // O3:U3 정산
  })

  it('식당이 2개 이상이면 구분 열을 블록 높이만큼 병합한다', () => {
    const block = simpleBlock({
      lines: [
        line('가', [1, 0, 0], [2, 0, 0]),
        line('나', [1, 0, 0], [2, 0, 0]),
        line('다', [1, 0, 0], [2, 0, 0]),
      ],
    })
    const { merges } = buildSettlementSheet([block])
    const asText = merges.map((m) => `${m.s.r},${m.s.c}-${m.e.r},${m.e.c}`)
    expect(asText).toContain('4,0-6,0') // 5~7행 구분 병합
  })

  it('식당이 1개면 구분 열을 병합하지 않는다', () => {
    const { merges } = buildSettlementSheet([simpleBlock()])
    const asText = merges.map((m) => `${m.s.r},${m.s.c}-${m.e.r},${m.e.c}`)
    expect(asText).not.toContain('4,0-4,0')
  })

  it('계 행은 A:B를 병합한다', () => {
    const { merges } = buildSettlementSheet([simpleBlock()])
    const asText = merges.map((m) => `${m.s.r},${m.s.c}-${m.e.r},${m.e.c}`)
    expect(asText).toContain('5,0-5,1') // 계 행
  })
})

describe('venueDisplayName — 원본 B열 표기 재현', () => {
  function venue(over: Partial<NormalizedVenue>): NormalizedVenue {
    return {
      source: 'cj',
      businessCode: '1008',
      businessName: '키즈웰에듀푸드(선경유치원)',
      restaurantCode: '1000',
      restaurantName: '키즈웰에듀푸드(선경유치원)',
      cost: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
      price: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
      ...over,
    }
  }

  it('CJ는 식당명을 그대로 쓴다', () => {
    expect(venueDisplayName(venue({ restaurantName: '키즈웰에듀푸드(선경유치원_방과후간식)' }))).toBe(
      '키즈웰에듀푸드(선경유치원_방과후간식)'
    )
  })

  it('신세계는 "사업장명 식당명"으로 합치고 EDU)키즈_ 접두를 뗀다', () => {
    expect(
      venueDisplayName(
        venue({
          source: 'shinsegae',
          businessName: 'EDU)키즈_국제유치원(키즈웰)',
          restaurantName: '급식재료',
        })
      )
    ).toBe('국제유치원(키즈웰) 급식재료')
  })

  it('본사도 같은 규칙이 적용된다', () => {
    expect(
      venueDisplayName(
        venue({
          source: 'shinsegae',
          businessName: 'EDU)키즈_키즈웰에듀푸드(본사)',
          restaurantName: '본사',
        })
      )
    ).toBe('키즈웰에듀푸드(본사) 본사')
  })
})
