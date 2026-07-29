import { numCell, textCell } from './cell'
import type { NormalizedVenue, ParseResult } from './types'

/**
 * CJ `CJ_전체 집계표` 파서 — **이미 사업장×식당 집계된 시트**
 *
 * 시트 구조 (2026-07-29 실측, 40행):
 * ```
 * 1행: 번호 | 사업장코드 | 사업장 | 식당코드 | 식당명 | 사업부 | 팀
 *      | 원가: 과세공급가 과세부가세 과세금액 면세 합계(a)
 *      | 단가: 과세공급가 과세부가세 과세금액 면세 합계(b) | 차액(b−a)
 * 2행: ★ 총계 행 (사업장코드 비어 있음)
 * 3행~: 데이터 (37행)
 * ```
 *
 * ⚠️ **2행이 총계다.** 데이터로 읽으면 전체 금액이 정확히 두 배가 된다.
 * 사업장코드가 비어 있는 것으로 걸러낸다 (행 번호에 의존하지 않는 편이 안전하다).
 *
 * 시트에 적힌 `합계` 열은 신뢰하지 않고 **재계산**한다. 대신 값이 다르면 경고한다 —
 * 원천 파일 자체가 틀렸을 때 조용히 넘어가지 않도록.
 */

/** 0-based 열 인덱스 (엑셀 열문자 주석) */
const COL = {
  businessCode: 1, // B
  businessName: 2, // C
  restaurantCode: 3, // D
  restaurantName: 4, // E
  costSupply: 7, // H 원가/과세/공급가
  costVat: 8, // I 원가/과세/부가세
  costExempt: 10, // K 원가/면세
  costTotal: 11, // L 원가/합계(a)
  priceSupply: 12, // M 단가/과세/공급가
  priceVat: 13, // N 단가/과세/부가세
  priceExempt: 15, // P 단가/면세
  priceTotal: 16, // Q 단가/합계(b)
} as const

/** 1행 헤더 + 2행 총계 → 데이터는 3행(인덱스 2)부터. 단, 코드 유무로 한 번 더 검증한다. */
const DATA_START_INDEX = 2

export function parseCjSheet(rows: readonly unknown[][]): ParseResult {
  const warnings: string[] = []
  const venues: NormalizedVenue[] = []

  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const businessCode = textCell(row, COL.businessCode)
    if (!businessCode) continue // 총계 행 / 빈 행

    const cost = {
      taxableSupply: numCell(row, COL.costSupply),
      vat: numCell(row, COL.costVat),
      exempt: numCell(row, COL.costExempt),
      total: 0,
    }
    const price = {
      taxableSupply: numCell(row, COL.priceSupply),
      vat: numCell(row, COL.priceVat),
      exempt: numCell(row, COL.priceExempt),
      total: 0,
    }
    cost.total = cost.taxableSupply + cost.vat + cost.exempt
    price.total = price.taxableSupply + price.vat + price.exempt

    // 원천 파일의 합계와 대조 — 어긋나면 원천이 잘못됐다는 신호다
    const statedCost = numCell(row, COL.costTotal)
    const statedPrice = numCell(row, COL.priceTotal)
    if (statedCost !== cost.total) {
      warnings.push(
        `${i + 1}행: 원가 합계 불일치 — 시트 ${statedCost.toLocaleString()} vs 재계산 ${cost.total.toLocaleString()} (사업장 ${businessCode})`
      )
    }
    if (statedPrice !== price.total) {
      warnings.push(
        `${i + 1}행: 단가 합계 불일치 — 시트 ${statedPrice.toLocaleString()} vs 재계산 ${price.total.toLocaleString()} (사업장 ${businessCode})`
      )
    }

    venues.push({
      source: 'cj',
      businessCode,
      businessName: textCell(row, COL.businessName),
      restaurantCode: textCell(row, COL.restaurantCode),
      restaurantName: textCell(row, COL.restaurantName),
      cost,
      price,
    })
  }

  return { venues, warnings }
}
