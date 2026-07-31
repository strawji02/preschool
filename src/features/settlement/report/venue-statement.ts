import type { AdjustmentRecord } from '../data/adjustment'
import { buildAdjustmentSheet, type AdjustmentSheet } from './adjustment-sheet'

/**
 * 유치원 제공 거래명세표 — docs/systems/settlement/조정.md §19
 *
 * ★ 2026-07-31, 국제유치원이 신세계에서 받고 있는 양식을 실측해 만들었다.
 * 우리 원천(`신세계_전체 일반`)과 대조하니 **품목·규격·단위·수량·단가가 전부
 * 일치**했고 26년 6월 합계도 26,189,271로 원단위 일치했다. 그래서 같은 문서를
 * 우리가 만들어 모든 신세계 유치원에 줄 수 있다.
 *
 * 구성 (국제유치원 양식 그대로):
 * ```
 * 집계표      식당별 공급가(A) / 부가세(B) / 계 / 면세(C) / 합계액(A+B+C) + 계 행
 * <식당명>    일자별 명세 블록 — 품목표 + 그날 합계(과세·면세), 맨 끝 월합계
 * 조정 내역   있을 때만 (§18)
 * ```
 *
 * ⚠️ **금액은 가맹점(단가) 기준**이다 — 유치원에 청구하는 값. 납품가가 아니다.
 *
 * ⚠️ **공급자는 우리(키즈웰에듀푸드)다.** 원본은 신세계푸드가 발행한 문서지만,
 * 유치원에 청구하는 주체는 우리다. `settlement_issuer`에서 가져온다.
 *
 * ⚠️ **원산지 열은 만들지 않는다.** 신세계 원본에는 `원료 국내산, 소금 중국산`처럼
 * 상세 정보가 있는데 우리 원천에는 그 열이 없다. 품목명에 든 `국내산` 정도로
 * 흉내 내면 **틀린 원산지를 유치원에 주는 문서**가 된다. 온도만 뽑는다.
 */

export interface VenueStatementItem {
  /** `YYYY-MM-DD` */
  date: string
  restaurantName: string
  productName: string
  spec: string
  unit: string
  quantity: number
  /** 가맹점 단가 (유치원 청구가) */
  unitPrice: number
  taxable: boolean
  supply: number
  vat: number
  total: number
}

export interface StatementIssuer {
  companyName: string
  bizRegNo: string
  ceoName: string
  address: string
}

export interface VenueStatementInput {
  businessName: string
  /** `YYYY-MM` */
  period: string
  issuer: StatementIssuer
  items: readonly VenueStatementItem[]
  adjustments: readonly AdjustmentRecord[]
  /** 조정별 금액 (산식이 계산한 값) */
  adjustmentAmounts?: Record<string, number>
}

export interface StatementDay {
  date: string
  /** 품목 행 — 번호·온도·품목·규격·단위·수량·단가·공급가액·세액·합계 */
  rows: (string | number)[][]
  taxableSupply: number
  vat: number
  exempt: number
  total: number
}

export interface StatementRestaurantSheet {
  name: string
  days: StatementDay[]
  monthTotal: number
}

export interface VenueStatement {
  businessName: string
  period: string
  summary: { rows: (string | number)[][] }
  restaurants: StatementRestaurantSheet[]
  adjustmentSheet: AdjustmentSheet | null
}

export const ITEM_HEADER = [
  '번호',
  '온도',
  '품목',
  '규격',
  '단위',
  '수량',
  '단가',
  '공급가액',
  '세액',
  '합계',
]

const SUMMARY_HEADER = ['구분', '', '공급가(A)', '부가세(B)', '계', '면세(C)', '합계액(A+B+C)']

/**
 * 품목명 끝에 붙은 보관 온도를 뽑는다.
 *
 * 원천에 온도 열이 없다. 대신 품목명이 `노랑 파프리카 국내산 냉장`,
 * `세척당근 국내산 실온(냉장 권장)`처럼 **온도로 끝난다** (26년 6월 실측).
 * 못 찾으면 빈칸으로 둔다 — 틀린 값을 채우는 것보다 낫다.
 */
export function extractTemperature(productName: string): string {
  const m = productName.match(/(실온\(냉장 권장\)|실온|냉장|냉동)\s*$/)
  return m ? m[1] : ''
}

export function buildVenueStatement(input: VenueStatementInput): VenueStatement {
  // ── 식당 → 일자 → 품목 ──
  const byRestaurant = new Map<string, Map<string, VenueStatementItem[]>>()
  for (const it of input.items) {
    let days = byRestaurant.get(it.restaurantName)
    if (!days) {
      days = new Map()
      byRestaurant.set(it.restaurantName, days)
    }
    const list = days.get(it.date)
    if (list) list.push(it)
    else days.set(it.date, [it])
  }

  const restaurantNames = [...byRestaurant.keys()].sort()

  const restaurants: StatementRestaurantSheet[] = restaurantNames.map((name) => {
    const days = [...byRestaurant.get(name)!.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => buildDay(date, items))
    return {
      name,
      days,
      monthTotal: days.reduce((s, d) => s + d.total, 0),
    }
  })

  // ── 집계표 ──
  const summaryRows: (string | number)[][] = [
    [`${input.businessName} ${input.period} 급식 청구`],
    [],
    ['◆ 집계표'],
    SUMMARY_HEADER,
  ]

  let tA = 0
  let tB = 0
  let tC = 0
  restaurantNames.forEach((name, i) => {
    const sheet = restaurants[i]
    const a = sheet.days.reduce((s, d) => s + d.taxableSupply, 0)
    const b = sheet.days.reduce((s, d) => s + d.vat, 0)
    const c = sheet.days.reduce((s, d) => s + d.exempt, 0)
    tA += a
    tB += b
    tC += c
    summaryRows.push([i + 1, name, a, b, a + b, c, a + b + c])
  })
  summaryRows.push(['계', '', tA, tB, tA + tB, tC, tA + tB + tC])

  return {
    businessName: input.businessName,
    period: input.period,
    summary: { rows: summaryRows },
    restaurants,
    adjustmentSheet: buildAdjustmentSheet(input.adjustments, input.adjustmentAmounts ?? {}),
  }
}

function buildDay(date: string, items: readonly VenueStatementItem[]): StatementDay {
  const rows: (string | number)[][] = []
  let taxableSupply = 0
  let vat = 0
  let exempt = 0

  items.forEach((it, i) => {
    if (it.taxable) {
      taxableSupply += it.supply
      vat += it.vat
    } else {
      exempt += it.supply
    }
    rows.push([
      i + 1,
      extractTemperature(it.productName),
      it.productName,
      it.spec,
      it.unit,
      it.quantity,
      it.unitPrice,
      it.supply,
      it.vat,
      it.total,
    ])
  })

  return { date, rows, taxableSupply, vat, exempt, total: taxableSupply + vat + exempt }
}
