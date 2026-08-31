import type { SettlementSource } from '../parse/types'
import type { InvoiceTaxKind } from '../report/invoice-sheet'

/** 품목명 후보를 만들 때 필요한 마스터의 최소 형태. */
export interface VenueItemNameHistory {
  source: SettlementSource
  businessCode: string
  taxKind: InvoiceTaxKind
  invoiceItemName: string
}

/**
 * 원본 식당명에서 담당자가 확인할 계산서 품목명을 제안한다.
 *
 * CJ는 `회사(유치원_주방소모품)` 형태가 많아서 마지막 접미사가 실제 품목명이다.
 * 접미사를 확실히 분리할 수 없으면 원본을 그대로 돌려준다. 추천은 화면을 채울 뿐,
 * 사용자가 저장하기 전에는 마스터에 반영하지 않는다.
 */
export function suggestInvoiceItemName(restaurantName: string, businessName: string): string {
  const original = restaurantName.trim().replace(/\s+/g, ' ')
  if (original === '') return ''

  const parenthesized = original.match(/\(([^()]*)\)\s*$/)?.[1]?.trim()
  if (parenthesized?.includes('_')) {
    const suffix = parenthesized.split('_').at(-1)?.trim()
    if (suffix) return suffix
  }

  // 신세계 원천에 붙는 표준 접두사는 계산서 품목명이 아니다.
  const withoutSourcePrefix = original.replace(/^EDU\)키즈[_\s-]*/i, '').trim()
  if (withoutSourcePrefix !== original && withoutSourcePrefix !== '') return withoutSourcePrefix

  // 사업장명과 식당명이 같으면 유치원명만 억지로 추출하지 않고 원본을 제안한다.
  // 신규 유치원은 기존 후보가 없을 수 있으므로 빈 값보다 원문 확인이 안전하다.
  if (compact(original) === compact(businessName)) return original

  return parenthesized || original
}

/**
 * 같은 공급사·같은 유치원에 이미 저장된 품목명만 드롭다운 후보로 만든다.
 * 같은 과세구분을 먼저 보여주고, 각 그룹 안에서는 사용 빈도순으로 정렬한다.
 */
export function venueItemNameOptions(
  history: readonly VenueItemNameHistory[],
  source: SettlementSource,
  businessCode: string,
  taxKind: InvoiceTaxKind
): string[] {
  const sameTax = new Map<string, number>()
  const otherTax = new Map<string, number>()

  for (const item of history) {
    if (item.source !== source || item.businessCode !== businessCode) continue
    const name = item.invoiceItemName.trim()
    if (name === '') continue
    const counts = item.taxKind === taxKind ? sameTax : otherTax
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const ordered = [...sortCounts(sameTax), ...sortCounts(otherTax)]
  return [...new Set(ordered)]
}

function sortCounts(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([name]) => name)
}

function compact(value: string): string {
  return value.replace(/\s/g, '')
}
