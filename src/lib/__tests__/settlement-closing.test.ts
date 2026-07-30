import { describe, it, expect } from 'vitest'
import {
  closingTotals,
  isValidPeriod,
  type ClosingPartnerRow,
  type ClosingVenueRow,
} from '@/features/settlement'

/**
 * [정산] 월 마감 합계 (docs §8, §13)
 *
 * 경영 보고서의 헤드라인 숫자를 만드는 산식이다. 26년 6월 실값으로 고정한다.
 *
 * ```
 * 매출        102,346,907   ← 계산서 발행분 (정산제외 사업장 제외)
 * 매출원가     73,999,061   ← 전체 매입 − 제외 사업장 원가
 * 총마진 M     28,347,846   = 영업자 4명 차액 합계
 * − 영업자 R   21,542,074
 * = 본사 몫     6,805,772   = 적립금 + 부가세차액 + 공제
 * − 마케팅비        9,955
 * = 영업이익    6,795,817
 * ```
 *
 * ⚠️ **부가세는 기준이 다르다.**
 * 매출세액은 계산서를 발행한 것만(제외 사업장 빼고), 매입세액은 **전부** 센다 —
 * 본사 마케팅비의 매입세액도 공제받기 때문이다. 그래서 회수액(P)과 납부액이
 * 905원 다르고, 그건 정상이다 (docs §13-4).
 */

const zero = { taxableSupply: 0, vat: 0, exempt: 0, total: 0 }

function venue(over: Partial<ClosingVenueRow> = {}): ClosingVenueRow {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: '1000',
    restaurantName: '키즈웰에듀푸드(해밀유치원)',
    partnerId: 'p-kim',
    partnerName: '김중영',
    isExcluded: false,
    exclusionReason: null,
    cost: { ...zero },
    price: { ...zero },
    ...over,
  }
}

function partner(over: Partial<ClosingPartnerRow> = {}): ClosingPartnerRow {
  return {
    partnerId: 'p-kim',
    partnerName: '김중영',
    partnerType: 'cofounder',
    commissionPercent: 5,
    costTotal: 0,
    costVat: 0,
    priceTotal: 0,
    priceVat: 0,
    margin: 0,
    platformFee: 0,
    vatDiff: 0,
    businessDeduction: 0,
    preTax: 0,
    declared: 0,
    incomeTax: 0,
    localTax: 0,
    netPay: 0,
    ...over,
  }
}

/** 26년 6월 영업자 4명 확정값 (docs §3 역검증 표 — 김중영 원천징수 적용) */
const JUNE_PARTNERS: ClosingPartnerRow[] = [
  partner({
    partnerId: 'p-kim',
    partnerName: '김중영',
    partnerType: 'cofounder',
    margin: 9_628_033,
    platformFee: 1_194_000,
    vatDiff: 288_396,
    businessDeduction: 624_000,
    preTax: 7_521_637,
    declared: 8_715_637,
    incomeTax: 261_460,
    localTax: 26_140,
    netPay: 7_234_037,
  }),
  partner({
    partnerId: 'p-lee',
    partnerName: '이동현',
    partnerType: 'cofounder',
    margin: 15_717_313,
    platformFee: 1_897_750,
    vatDiff: 530_496,
    businessDeduction: 1_696_500,
    preTax: 11_592_567,
    declared: 13_490_317,
    incomeTax: 404_700,
    localTax: 40_470,
    netPay: 11_147_397,
  }),
  partner({
    partnerId: 'p-cho',
    partnerName: '조성곤',
    partnerType: 'cofounder',
    margin: 1_244_511,
    platformFee: 202_740,
    vatDiff: 30_496,
    businessDeduction: 0,
    preTax: 1_011_275,
    declared: 1_214_015,
    incomeTax: 36_420,
    localTax: 3_640,
    netPay: 971_215,
  }),
  partner({
    partnerId: 'p-you',
    partnerName: '김영수',
    partnerType: 'partner',
    margin: 1_757_989,
    platformFee: 284_870,
    vatDiff: 56_524,
    businessDeduction: 0,
    preTax: 1_416_595,
    declared: 1_416_595,
    incomeTax: 42_490,
    localTax: 4_240,
    netPay: 1_369_865,
  }),
]

/**
 * 26년 6월 식당 합계를 두 줄로 압축한 것.
 * 사업장 단위 상세는 파이프라인 테스트가 이미 검증하므로 여기서는 합계 규칙만 본다.
 */
const JUNE_VENUES: ClosingVenueRow[] = [
  // 정산 대상 전체 (16개 유치원 합계)
  venue({
    cost: { taxableSupply: 0, vat: 2_412_330, exempt: 0, total: 73_999_061 },
    price: { taxableSupply: 33_182_420, vat: 3_318_242, exempt: 65_846_245, total: 102_346_907 },
  }),
  // 본사 — 정산 제외 (마케팅비)
  venue({
    source: 'shinsegae',
    businessCode: '88689',
    businessName: '키즈웰에듀푸드(본사)',
    restaurantCode: '01',
    restaurantName: '본사',
    partnerId: null,
    partnerName: null,
    isExcluded: true,
    exclusionReason: '마케팅비 — 본사 자체 소비분',
    cost: { taxableSupply: 9_050, vat: 905, exempt: 0, total: 9_955 },
    price: { taxableSupply: 11_750, vat: 1_175, exempt: 0, total: 12_925 },
  }),
]

describe('isValidPeriod', () => {
  it('YYYY-MM만 받는다', () => {
    expect(isValidPeriod('2026-06')).toBe(true)
    expect(isValidPeriod('2026-12')).toBe(true)
  })

  it('월 범위를 검사한다', () => {
    expect(isValidPeriod('2026-00')).toBe(false)
    expect(isValidPeriod('2026-13')).toBe(false)
  })

  it('형식이 다르면 거절한다 — 26년6월 같은 표기는 연도가 애매하다', () => {
    expect(isValidPeriod('26년6월')).toBe(false)
    expect(isValidPeriod('2026-6')).toBe(false)
    expect(isValidPeriod('202606')).toBe(false)
    expect(isValidPeriod('')).toBe(false)
  })
})

describe('closingTotals — 26년 6월 실값', () => {
  const t = closingTotals(JUNE_VENUES, JUNE_PARTNERS)

  it('매출은 정산제외 사업장을 뺀 단가합계다', () => {
    // 본사 12,925는 계산서를 발행하지 않으므로 매출이 아니다
    expect(t.revenue).toBe(102_346_907)
  })

  it('매출원가는 제외 사업장 원가를 뺀 값이다', () => {
    expect(t.costOfSales).toBe(73_999_061)
  })

  it('제외 사업장 원가는 마케팅비로 따로 잡는다', () => {
    expect(t.marketingCost).toBe(9_955)
  })

  it('총마진은 영업자 차액 합계와 같다 (매출 − 매출원가)', () => {
    expect(t.grossMargin).toBe(28_347_846)
    expect(t.revenue - t.costOfSales).toBe(t.grossMargin)
  })

  it('본사 몫 = 적립금 + 부가세차액 + 공제', () => {
    expect(t.platformFee).toBe(3_579_360)
    expect(t.vatDiff).toBe(905_912)
    expect(t.businessDeduction).toBe(2_320_500)
    expect(t.hqShare).toBe(6_805_772)
    expect(t.platformFee + t.vatDiff + t.businessDeduction).toBe(t.hqShare)
  })

  it('총마진 − 영업자 세전 = 본사 몫 (항등식이 닫힌다)', () => {
    expect(t.partnerPreTax).toBe(21_542_074)
    expect(t.grossMargin - t.partnerPreTax).toBe(t.hqShare)
  })

  it('영업이익 = 본사 몫 − 마케팅비', () => {
    expect(t.operatingProfit).toBe(6_795_817)
  })

  it('원천세는 소득세 + 지방세 합계다 (김중영 포함)', () => {
    // 원본 엑셀은 김중영이 누락돼 531,960이었다. 확정 규칙대로면 819,560이다.
    expect(t.withholding).toBe(819_560)
  })

  it('영업자 실지급 = 세전 − 원천세', () => {
    expect(t.partnerNetPay).toBe(20_722_514)
    expect(t.partnerPreTax - t.withholding).toBe(t.partnerNetPay)
  })

  it('사업소득 신고액 합계', () => {
    expect(t.declared).toBe(24_836_564)
  })
})

describe('closingTotals — 부가세는 기준이 다르다', () => {
  const t = closingTotals(JUNE_VENUES, JUNE_PARTNERS)

  it('매출세액은 계산서 발행분만 센다 (제외 사업장 빼고)', () => {
    expect(t.salesVat).toBe(3_318_242)
  })

  it('매입세액은 제외 사업장까지 전부 센다 — 마케팅비도 공제받는다', () => {
    expect(t.purchaseVat).toBe(2_413_235)
  })

  it('납부할 부가세 = 매출세액 − 매입세액', () => {
    expect(t.vatPayable).toBe(905_007)
  })

  it('영업자에게 회수한 부가세차액과 납부액 차이를 알려준다', () => {
    // 905원 = 본사 마케팅비의 매입세액. 이상 항목이 아니라 정상 공제분이다.
    expect(t.vatDiffGap).toBe(905)
    expect(t.vatDiff - t.vatPayable).toBe(t.vatDiffGap)
  })
})

describe('closingTotals — 경계', () => {
  it('빈 입력은 전부 0이다', () => {
    const t = closingTotals([], [])
    expect(t.revenue).toBe(0)
    expect(t.grossMargin).toBe(0)
    expect(t.hqShare).toBe(0)
    expect(t.operatingProfit).toBe(0)
    expect(t.vatPayable).toBe(0)
  })

  it('제외 사업장만 있으면 매출이 0이고 마케팅비만 남는다', () => {
    const t = closingTotals([JUNE_VENUES[1]!], [])
    expect(t.revenue).toBe(0)
    expect(t.marketingCost).toBe(9_955)
    expect(t.costOfSales).toBe(0)
    // 매출세액 0 − 매입세액 905 = −905 (환급)
    expect(t.vatPayable).toBe(-905)
  })

  it('미배정 사업장도 매출에 넣는다 — 담당자가 없을 뿐 청구는 한다', () => {
    // 마감은 차단되지만 금액을 빼면 매출이 조용히 줄어든다
    const t = closingTotals(
      [
        venue({
          partnerId: null,
          partnerName: null,
          isExcluded: false,
          cost: { taxableSupply: 0, vat: 100, exempt: 0, total: 1_000 },
          price: { taxableSupply: 0, vat: 200, exempt: 0, total: 2_000 },
        }),
      ],
      []
    )
    expect(t.revenue).toBe(2_000)
    expect(t.costOfSales).toBe(1_000)
  })
})
