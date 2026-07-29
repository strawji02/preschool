import { describe, it, expect } from 'vitest'
import {
  roundUpTo10,
  roundDownTo10,
  calcPlatformFee,
  calcWithholding,
  calcSettlement,
  validateSplitDeclaration,
} from '@/features/settlement'

/**
 * [정산] 정산 산식 TDD — docs/systems/settlement.md §3
 *
 * ```
 * 차액(총마진)  M = 단가합계 − 원가합계            ← 총액(세액 포함) 기준
 * 적립금(플랫폼) O = ROUNDUP((원가합계 − 원가세액) × 5%, -1)
 * 부가세차액     P = 단가세액 − 원가세액
 * 사업자공제     Q = 매월 수기 입력
 * 지급액(세전)   R = M − O − P − Q
 * 신고액         V = 코파운더 → R + O / 일반 → R
 * 소득세         S = ROUNDDOWN(V × 3%, -1)
 * 지방소득세     T = ROUNDDOWN(S × 10%, -1)
 * 실지급         U = R − S − T
 * ```
 *
 * 반올림 시맨틱은 **Excel과 동일**해야 한다 (산식이 실제 엑셀 수식에서 추출됐으므로).
 * Excel의 ROUNDDOWN/ROUNDUP은 0 방향 절단 / 0 반대방향 확대다.
 * JS `Math.floor`/`Math.ceil`은 음수에서 다르게 동작하므로 그대로 쓰면 안 된다.
 */

// ============================================================
// 1. 26년 6월 실제 데이터 역검증 (docs §3 표) — 절대 깨지면 안 되는 고정 픽스처
// ============================================================
interface Fixture {
  name: string
  partnerType: 'cofounder' | 'partner'
  preTax: number // R
  platformFee: number // O
  declared: number // V
  incomeTax: number // S
  localTax: number // T
  netPay: number // U
}

const JUNE_2026: Fixture[] = [
  {
    name: '이동현',
    partnerType: 'cofounder',
    preTax: 11_592_567,
    platformFee: 1_897_750,
    declared: 13_490_317,
    incomeTax: 404_700,
    localTax: 40_470,
    netPay: 11_147_397,
  },
  {
    name: '조성곤',
    partnerType: 'cofounder',
    preTax: 1_011_275,
    platformFee: 202_740,
    declared: 1_214_015,
    incomeTax: 36_420,
    localTax: 3_640,
    netPay: 971_215,
  },
  {
    name: '김영수',
    partnerType: 'partner',
    preTax: 1_416_595,
    platformFee: 284_870,
    declared: 1_416_595,
    incomeTax: 42_490,
    localTax: 4_240,
    netPay: 1_369_865,
  },
  {
    // 과거 엑셀에서는 원천징수가 누락됐으나 시스템에서는 동일하게 적용한다 (docs §3)
    name: '김중영',
    partnerType: 'cofounder',
    preTax: 7_521_637,
    platformFee: 1_194_000,
    declared: 8_715_637,
    incomeTax: 261_460,
    localTax: 26_140,
    netPay: 7_234_037,
  },
]

describe('26년 6월 역검증 픽스처 (원단위 일치 필수)', () => {
  for (const f of JUNE_2026) {
    describe(`${f.name} (${f.partnerType})`, () => {
      const got = () =>
        calcWithholding({
          preTax: f.preTax,
          platformFee: f.platformFee,
          partnerType: f.partnerType,
        })

      it(`신고액 V = ${f.declared.toLocaleString()}`, () => {
        expect(got().declared).toBe(f.declared)
      })
      it(`소득세 S = ${f.incomeTax.toLocaleString()}`, () => {
        expect(got().incomeTax).toBe(f.incomeTax)
      })
      it(`지방소득세 T = ${f.localTax.toLocaleString()}`, () => {
        expect(got().localTax).toBe(f.localTax)
      })
      it(`실지급 U = ${f.netPay.toLocaleString()}`, () => {
        expect(got().netPay).toBe(f.netPay)
      })
    })
  }

  it('실지급은 세전에서 두 세금을 뺀 값과 항상 일치한다 (합계 정합성)', () => {
    for (const f of JUNE_2026) {
      const r = calcWithholding({
        preTax: f.preTax,
        platformFee: f.platformFee,
        partnerType: f.partnerType,
      })
      expect(r.netPay).toBe(f.preTax - r.incomeTax - r.localTax)
    }
  })
})

// ============================================================
// 2. 영업자 유형 분기 — 적립금을 신고액에 포함하는지
// ============================================================
describe('영업자 유형별 신고액(V) 분기', () => {
  const base = { preTax: 1_000_000, platformFee: 200_000 }

  it('코파운더는 적립금(O)을 신고액에 포함한다 → V = R + O', () => {
    expect(calcWithholding({ ...base, partnerType: 'cofounder' }).declared).toBe(1_200_000)
  })

  it('일반 파트너는 적립금을 포함하지 않는다 → V = R', () => {
    expect(calcWithholding({ ...base, partnerType: 'partner' }).declared).toBe(1_000_000)
  })

  it('유형이 달라도 실지급(U)은 세전(R)에서만 차감한다 — 적립금은 U에 영향 없음', () => {
    const co = calcWithholding({ ...base, partnerType: 'cofounder' })
    const pt = calcWithholding({ ...base, partnerType: 'partner' })
    // 코파운더는 신고액이 커서 세금이 더 크고, 그만큼 실지급이 작다
    expect(co.incomeTax).toBeGreaterThan(pt.incomeTax)
    expect(co.netPay).toBeLessThan(pt.netPay)
    expect(co.netPay).toBe(base.preTax - co.incomeTax - co.localTax)
    expect(pt.netPay).toBe(base.preTax - pt.incomeTax - pt.localTax)
  })
})

// ============================================================
// 3. 반올림 규칙 — 돈이므로 경계값을 못 박는다
// ============================================================
describe('roundUpTo10 (Excel ROUNDUP(x, -1))', () => {
  it('10원 미만 잔액은 올린다', () => {
    expect(roundUpTo10(1)).toBe(10)
    expect(roundUpTo10(11)).toBe(20)
    expect(roundUpTo10(1_897_741)).toBe(1_897_750)
  })
  it('이미 10원 단위면 그대로', () => {
    expect(roundUpTo10(0)).toBe(0)
    expect(roundUpTo10(10)).toBe(10)
    expect(roundUpTo10(1_897_750)).toBe(1_897_750)
  })
  it('음수는 0 반대방향으로 확대한다 (Excel과 동일)', () => {
    expect(roundUpTo10(-1)).toBe(-10)
    expect(roundUpTo10(-11)).toBe(-20)
  })
})

describe('roundDownTo10 (Excel ROUNDDOWN(x, -1))', () => {
  it('10원 미만 잔액은 버린다', () => {
    expect(roundDownTo10(19)).toBe(10)
    expect(roundDownTo10(404_709.51)).toBe(404_700)
    expect(roundDownTo10(3_642)).toBe(3_640)
  })
  it('이미 10원 단위면 그대로', () => {
    expect(roundDownTo10(0)).toBe(0)
    expect(roundDownTo10(40_470)).toBe(40_470)
  })
  it('음수는 0 방향으로 절단한다 (Excel ROUNDDOWN — Math.floor와 다름)', () => {
    expect(roundDownTo10(-3_642)).toBe(-3_640)
    expect(roundDownTo10(-19)).toBe(-10)
  })
})

// ============================================================
// 4. 적립금(O) — 공급가 기준 × 5%, 10원 올림
// ============================================================
describe('적립금(O) = ROUNDUP((원가합계 − 원가세액) × 5%, -1)', () => {
  it('세액을 제외한 공급가를 기준으로 계산한다', () => {
    // 공급가 1,000,000 → 5% = 50,000
    expect(calcPlatformFee({ costTotal: 1_100_000, costVat: 100_000 })).toBe(50_000)
  })

  it('10원 단위로 올린다', () => {
    // 공급가 1,000,001 → 5% = 50,000.05 → 50,010
    expect(calcPlatformFee({ costTotal: 1_000_001, costVat: 0 })).toBe(50_010)
    // 공급가 999,999 → 5% = 49,999.95 → 50,000
    expect(calcPlatformFee({ costTotal: 999_999, costVat: 0 })).toBe(50_000)
  })

  it('수수료율은 영업자별로 바꿀 수 있다 (기본 5%)', () => {
    expect(calcPlatformFee({ costTotal: 1_000_000, costVat: 0, commissionPercent: 3 })).toBe(30_000)
    expect(calcPlatformFee({ costTotal: 1_000_000, costVat: 0 })).toBe(50_000)
  })

  it('이동현 적립금 1,897,750을 재현하는 공급가 구간에서 일치한다', () => {
    // O = 1,897,750 이려면 공급가 × 5% ∈ (1,897,740, 1,897,750]
    // → 공급가 ∈ (37,954,800, 37,955,000]
    expect(calcPlatformFee({ costTotal: 37_955_000, costVat: 0 })).toBe(1_897_750)
    expect(calcPlatformFee({ costTotal: 37_954_801, costVat: 0 })).toBe(1_897_750)
    // 구간을 벗어나면 달라져야 한다 (경계 확인)
    expect(calcPlatformFee({ costTotal: 37_954_800, costVat: 0 })).toBe(1_897_740)
  })
})

// ============================================================
// 5. 전체 파이프라인 — 원천 합계에서 실지급까지
// ============================================================
describe('calcSettlement 전체 파이프라인', () => {
  // 원가: 공급가 1,000,000 + 세액 100,000 = 총액 1,100,000
  // 단가: 공급가 1,300,000 + 세액 130,000 = 총액 1,430,000
  const totals = {
    costTotal: 1_100_000,
    costVat: 100_000,
    priceTotal: 1_430_000,
    priceVat: 130_000,
  }

  it('총마진(M)은 총액 기준 차액이다', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner' })
    expect(r.margin).toBe(330_000) // 1,430,000 − 1,100,000
  })

  it('부가세차액(P)은 단가세액 − 원가세액이다', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner' })
    expect(r.vatDiff).toBe(30_000)
  })

  it('세전(R) = M − O − P − Q', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner', businessDeduction: 20_000 })
    expect(r.platformFee).toBe(50_000) // 공급가 1,000,000 × 5%
    expect(r.preTax).toBe(330_000 - 50_000 - 30_000 - 20_000) // 230,000
  })

  it('사업자공제(Q)는 기본 0이다 (매월 수기 입력)', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner' })
    expect(r.businessDeduction).toBe(0)
    expect(r.preTax).toBe(250_000)
  })

  it('총액차액 − 부가세차액 = 공급가 기준 차액 (docs §3 주석의 수학적 동일성)', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner' })
    const supplyMargin =
      totals.priceTotal - totals.priceVat - (totals.costTotal - totals.costVat)
    expect(r.margin - r.vatDiff).toBe(supplyMargin)
  })

  it('파이프라인 결과는 calcWithholding 단독 호출과 일치한다', () => {
    const full = calcSettlement({ ...totals, partnerType: 'cofounder', businessDeduction: 20_000 })
    const wh = calcWithholding({
      preTax: full.preTax,
      platformFee: full.platformFee,
      partnerType: 'cofounder',
    })
    expect(full.declared).toBe(wh.declared)
    expect(full.incomeTax).toBe(wh.incomeTax)
    expect(full.localTax).toBe(wh.localTax)
    expect(full.netPay).toBe(wh.netPay)
  })
})

// ============================================================
// 6. 세전이 0 이하일 때 — docs §11 미결 사항. 현재 동작을 명시적으로 고정한다
// ============================================================
describe('세전(R)이 0 이하인 경우 (docs §11 미결 — 잠정 규칙)', () => {
  it('신고액이 0 이하면 원천징수하지 않는다 (음수 세금 방지)', () => {
    const r = calcWithholding({ preTax: -500_000, platformFee: 0, partnerType: 'partner' })
    expect(r.declared).toBe(-500_000)
    expect(r.incomeTax).toBe(0)
    expect(r.localTax).toBe(0)
    expect(r.netPay).toBe(-500_000)
  })

  it('신고액이 정확히 0이면 세금은 0이다', () => {
    const r = calcWithholding({ preTax: 0, platformFee: 0, partnerType: 'partner' })
    expect(r.incomeTax).toBe(0)
    expect(r.localTax).toBe(0)
    expect(r.netPay).toBe(0)
  })

  it('세전이 음수여도 코파운더 적립금이 크면 신고액은 양수가 될 수 있다', () => {
    const r = calcWithholding({ preTax: -100_000, platformFee: 500_000, partnerType: 'cofounder' })
    expect(r.declared).toBe(400_000)
    expect(r.incomeTax).toBe(12_000) // 400,000 × 3%
    expect(r.localTax).toBe(1_200)
    expect(r.netPay).toBe(-113_200) // 세전(음수)에서 차감
  })
})

// ============================================================
// 7. 분할 신고 검증 (docs §4) — 불일치 시 마감 차단
// ============================================================
describe('분할 신고 합계 검증', () => {
  it('26년 6월 이동현 실제 사례: 분할 합계가 신고액과 일치한다', () => {
    const r = validateSplitDeclaration(13_490_317, [
      { name: '이동현', amount: 4_490_317 },
      { name: '김인순', amount: 5_000_000 },
      { name: '이유나', amount: 4_000_000 },
    ])
    expect(r.total).toBe(13_490_317)
    expect(r.diff).toBe(0)
    expect(r.valid).toBe(true)
  })

  it('1원이라도 모자라면 불일치로 잡는다', () => {
    const r = validateSplitDeclaration(13_490_317, [
      { name: '이동현', amount: 4_490_316 },
      { name: '김인순', amount: 5_000_000 },
      { name: '이유나', amount: 4_000_000 },
    ])
    expect(r.valid).toBe(false)
    expect(r.diff).toBe(-1)
  })

  it('초과분도 불일치로 잡는다', () => {
    const r = validateSplitDeclaration(1_000_000, [
      { name: 'A', amount: 600_000 },
      { name: 'B', amount: 500_000 },
    ])
    expect(r.valid).toBe(false)
    expect(r.diff).toBe(100_000)
  })

  it('분할이 없으면(빈 배열) 불일치다 — 신고액이 0이 아닌 한', () => {
    expect(validateSplitDeclaration(1_000_000, []).valid).toBe(false)
    expect(validateSplitDeclaration(0, []).valid).toBe(true)
  })

  it('분할 1건이 전액이면 일치다', () => {
    const r = validateSplitDeclaration(1_000_000, [{ name: 'A', amount: 1_000_000 }])
    expect(r.valid).toBe(true)
  })
})
