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
 * ## 픽스처 출처 (2026-07-29 실측)
 *
 * `정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx` → 시트 **`집계표_정산용`**
 * 영업자별 `계` 행: 김중영 24행 · 이동현 47행 · 조성곤 57행 · 김영수 60행
 *
 * 엑셀 컬럼 → 이 코드의 이름:
 *   D 원가세액 → costVat   · G 원가합계 → costTotal
 *   I 단가세액 → priceVat  · L 단가합계 → priceTotal
 *   M 차액 → margin · O 적립금 → platformFee · P 부가세차액 → vatDiff
 *   Q 사업자공제 → businessDeduction · R 지급액(세전) → preTax
 *   V 신고액 → declared · S 사업소득세 → incomeTax · T 지방세 → localTax
 *   U 실지급액 → netPay
 *
 * 엑셀 내부 정합성도 확인했다: 금액 = 공급가 + 세액, 합계 = 금액 + 면세 (4명 전원).
 *
 * ## 반올림 시맨틱
 *
 * 산식이 실제 엑셀 수식에서 추출됐으므로 **Excel과 동일**해야 한다.
 * Excel ROUNDDOWN/ROUNDUP은 0 방향 절단 / 0 반대방향 확대다.
 * JS `Math.floor`/`Math.ceil`은 음수에서 다르게 동작하므로 그대로 쓸 수 없다.
 */

interface Fixture {
  name: string
  partnerType: 'cofounder' | 'partner'
  /** 원천 입력 (엑셀 D·G·I·L·Q) */
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
  businessDeduction: number
  /** 기대 산출 (엑셀 M·O·P·R) */
  margin: number
  platformFee: number
  vatDiff: number
  preTax: number
  /** 기대 산출 (V·S·T·U) — 김중영만 엑셀과 다름, 아래 주석 참고 */
  declared: number
  incomeTax: number
  localTax: number
  netPay: number
}

const JUNE_2026: Fixture[] = [
  {
    name: '이동현',
    partnerType: 'cofounder',
    costTotal: 39_311_775,
    costVat: 1_356_855,
    priceTotal: 55_029_088,
    priceVat: 1_887_351,
    businessDeduction: 1_696_500,
    margin: 15_717_313,
    platformFee: 1_897_750,
    vatDiff: 530_496,
    preTax: 11_592_567,
    declared: 13_490_317,
    incomeTax: 404_700,
    localTax: 40_470,
    netPay: 11_147_397,
  },
  {
    name: '조성곤',
    partnerType: 'cofounder',
    costTotal: 4_156_582,
    costVat: 101_972,
    priceTotal: 5_401_093,
    priceVat: 132_468,
    businessDeduction: 0,
    margin: 1_244_511,
    platformFee: 202_740,
    vatDiff: 30_496,
    preTax: 1_011_275,
    declared: 1_214_015,
    incomeTax: 36_420,
    localTax: 3_640,
    netPay: 971_215,
  },
  {
    name: '김영수',
    partnerType: 'partner',
    costTotal: 5_887_888,
    costVat: 190_613,
    priceTotal: 7_645_877,
    priceVat: 247_137,
    businessDeduction: 0,
    margin: 1_757_989,
    platformFee: 284_870,
    vatDiff: 56_524,
    preTax: 1_416_595,
    declared: 1_416_595, // 일반 파트너 → V = R
    incomeTax: 42_490,
    localTax: 4_240,
    netPay: 1_369_865,
  },
  {
    // ⚠️ 원본 엑셀에는 V=0, S=0, T=0, U=R(7,521,637) 으로 **원천징수가 누락**돼 있다.
    // docs §3의 확정 규칙에 따라 시스템은 다른 영업자와 동일하게 원천징수를 적용한다.
    // 즉 이 4명 중 유일하게 시스템 산출값이 엑셀과 의도적으로 다르다.
    name: '김중영',
    partnerType: 'cofounder',
    costTotal: 24_642_816,
    costVat: 762_890,
    priceTotal: 34_270_849,
    priceVat: 1_051_286,
    businessDeduction: 624_000,
    margin: 9_628_033,
    platformFee: 1_194_000,
    vatDiff: 288_396,
    preTax: 7_521_637,
    declared: 8_715_637,
    incomeTax: 261_460,
    localTax: 26_140,
    netPay: 7_234_037,
  },
]

function run(f: Fixture) {
  return calcSettlement({
    costTotal: f.costTotal,
    costVat: f.costVat,
    priceTotal: f.priceTotal,
    priceVat: f.priceVat,
    businessDeduction: f.businessDeduction,
    partnerType: f.partnerType,
  })
}

// ============================================================
// 1. 26년 6월 실제 데이터 — 원천 합계에서 실지급까지 전 구간 역검증
// ============================================================
describe('26년 6월 역검증 (엑셀 집계표_정산용 실측값, 원단위 일치 필수)', () => {
  for (const f of JUNE_2026) {
    describe(`${f.name} (${f.partnerType})`, () => {
      it(`차액 M = ${f.margin.toLocaleString()}`, () => {
        expect(run(f).margin).toBe(f.margin)
      })
      it(`적립금 O = ${f.platformFee.toLocaleString()}`, () => {
        expect(run(f).platformFee).toBe(f.platformFee)
      })
      it(`부가세차액 P = ${f.vatDiff.toLocaleString()}`, () => {
        expect(run(f).vatDiff).toBe(f.vatDiff)
      })
      it(`세전 R = ${f.preTax.toLocaleString()}`, () => {
        expect(run(f).preTax).toBe(f.preTax)
      })
      it(`신고액 V = ${f.declared.toLocaleString()}`, () => {
        expect(run(f).declared).toBe(f.declared)
      })
      it(`소득세 S = ${f.incomeTax.toLocaleString()}`, () => {
        expect(run(f).incomeTax).toBe(f.incomeTax)
      })
      it(`지방소득세 T = ${f.localTax.toLocaleString()}`, () => {
        expect(run(f).localTax).toBe(f.localTax)
      })
      it(`실지급 U = ${f.netPay.toLocaleString()}`, () => {
        expect(run(f).netPay).toBe(f.netPay)
      })
    })
  }

  it('세전 합계가 엑셀 합계행(21,542,074)과 일치한다', () => {
    const total = JUNE_2026.reduce((s, f) => s + run(f).preTax, 0)
    expect(total).toBe(21_542_074)
  })

  it('실지급은 항상 세전 − 소득세 − 지방세다 (합계 정합성)', () => {
    for (const f of JUNE_2026) {
      const r = run(f)
      expect(r.netPay).toBe(r.preTax - r.incomeTax - r.localTax)
    }
  })

  it('김중영은 엑셀의 누락된 값(S=0,T=0,U=R)을 그대로 재현하지 않는다', () => {
    const kim = JUNE_2026.find((f) => f.name === '김중영')!
    const r = run(kim)
    // 엑셀 원본은 원천징수가 빠져 U가 세전과 같았다. 시스템은 징수한다.
    expect(r.incomeTax).toBeGreaterThan(0)
    expect(r.netPay).toBeLessThan(r.preTax)
    expect(r.netPay).toBe(7_234_037)
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

  it('유형이 달라도 실지급(U)은 세전(R)에서만 차감한다 — 적립금은 U에 더해지지 않는다', () => {
    const co = calcWithholding({ ...base, partnerType: 'cofounder' })
    const pt = calcWithholding({ ...base, partnerType: 'partner' })
    expect(co.incomeTax).toBeGreaterThan(pt.incomeTax)
    expect(co.netPay).toBeLessThan(pt.netPay)
    expect(co.netPay).toBe(base.preTax - co.incomeTax - co.localTax)
    expect(pt.netPay).toBe(base.preTax - pt.incomeTax - pt.localTax)
  })

  it('김영수를 코파운더로 바꾸면 세금이 늘어난다 (분기가 실제로 작동하는지)', () => {
    const kim = JUNE_2026.find((f) => f.name === '김영수')!
    const asPartner = run(kim)
    const asCofounder = run({ ...kim, partnerType: 'cofounder' })
    expect(asCofounder.declared).toBe(asPartner.preTax + asPartner.platformFee)
    expect(asCofounder.incomeTax).toBeGreaterThan(asPartner.incomeTax)
    expect(asCofounder.preTax).toBe(asPartner.preTax) // 세전은 유형과 무관
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
  it('세액을 제외한 공급가를 기준으로 한다 (총액이 아님)', () => {
    // 이동현 실데이터: 원가합계 39,311,775 − 세액 1,356,855 = 37,954,920 → ×5% = 1,897,746 → 1,897,750
    expect(
      calcPlatformFee({ costTotal: 39_311_775, costVat: 1_356_855 })
    ).toBe(1_897_750)
    // 총액에 곱했다면 1,965,590이 나와 실제와 달라진다
    expect(calcPlatformFee({ costTotal: 39_311_775, costVat: 0 })).not.toBe(1_897_750)
  })

  it('10원 단위로 올린다', () => {
    // 공급가 1,000,001 → 5% = 50,000.05 → 50,010
    expect(calcPlatformFee({ costTotal: 1_000_001, costVat: 0 })).toBe(50_010)
    // 공급가 999,999 → 5% = 49,999.95 → 50,000
    expect(calcPlatformFee({ costTotal: 999_999, costVat: 0 })).toBe(50_000)
    // 조성곤 실데이터: 4,054,610 × 5% = 202,730.5 → 202,740 (올림이 실제로 발동)
    expect(calcPlatformFee({ costTotal: 4_156_582, costVat: 101_972 })).toBe(202_740)
  })

  it('나눠떨어지면 올리지 않는다', () => {
    expect(calcPlatformFee({ costTotal: 1_100_000, costVat: 100_000 })).toBe(50_000)
  })

  it('수수료율은 영업자별로 바꿀 수 있다 (기본 5%)', () => {
    expect(calcPlatformFee({ costTotal: 1_000_000, costVat: 0, commissionPercent: 3 })).toBe(30_000)
    expect(calcPlatformFee({ costTotal: 1_000_000, costVat: 0 })).toBe(50_000)
  })
})

// ============================================================
// 5. 파이프라인 구조 검증
// ============================================================
describe('calcSettlement 파이프라인', () => {
  const totals = {
    costTotal: 1_100_000, // 공급가 1,000,000 + 세액 100,000
    costVat: 100_000,
    priceTotal: 1_430_000, // 공급가 1,300,000 + 세액 130,000
    priceVat: 130_000,
  }

  it('사업자공제(Q)는 기본 0이다 (매월 수기 입력)', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner' })
    expect(r.businessDeduction).toBe(0)
    expect(r.preTax).toBe(250_000) // 330,000 − 50,000 − 30,000 − 0
  })

  it('사업자공제는 세전에서 그대로 차감된다', () => {
    const r = calcSettlement({ ...totals, partnerType: 'partner', businessDeduction: 20_000 })
    expect(r.preTax).toBe(230_000)
  })

  it('총액차액 − 부가세차액 = 공급가 기준 차액 (docs §3 주석의 수학적 동일성)', () => {
    for (const f of JUNE_2026) {
      const r = run(f)
      const supplyMargin =
        f.priceTotal - f.priceVat - (f.costTotal - f.costVat)
      expect(r.margin - r.vatDiff).toBe(supplyMargin)
    }
  })

  it('파이프라인 결과는 calcWithholding 단독 호출과 일치한다', () => {
    for (const f of JUNE_2026) {
      const full = run(f)
      const wh = calcWithholding({
        preTax: full.preTax,
        platformFee: full.platformFee,
        partnerType: f.partnerType,
      })
      expect(full.declared).toBe(wh.declared)
      expect(full.incomeTax).toBe(wh.incomeTax)
      expect(full.localTax).toBe(wh.localTax)
      expect(full.netPay).toBe(wh.netPay)
    }
  })
})

// ============================================================
// 6. 세전이 0 이하일 때 — docs §11 미결 사항. 현재 동작을 명시적으로 고정
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
    expect(r.incomeTax).toBe(12_000)
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

  it('분할 대상 신고액은 산식이 만든 V와 같아야 한다 (연결 검증)', () => {
    const lee = JUNE_2026.find((f) => f.name === '이동현')!
    const declared = run(lee).declared
    const r = validateSplitDeclaration(declared, [
      { name: '이동현', amount: 4_490_317 },
      { name: '김인순', amount: 5_000_000 },
      { name: '이유나', amount: 4_000_000 },
    ])
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
