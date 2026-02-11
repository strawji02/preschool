/**
 * 깔때기(Funnel) 알고리즘 4단계: 속성 소거법 (Attribute Elimination)
 *
 * 프리미엄 속성 및 원산지 정보를 비교하여 후보 품목의 우선순위를 조정합니다.
 */

import type { InvoiceItem } from './excel-parser'

/**
 * DB 상품 정보 (간단한 타입 정의)
 */
export interface DBProduct {
  /** 상품 ID */
  id: string
  /** 상품명 */
  name: string
  /** 규격 */
  spec?: string
  /** 단가 */
  price: number
  /** 기타 속성 */
  [key: string]: any
}

/**
 * 속성 비교 결과
 */
export interface AttributeComparisonResult {
  /** 기본 점수에서 차감된 최종 점수 (100점 만점) */
  score: number
  /** 불일치 속성 목록 */
  mismatches: string[]
  /** 상세 로그 */
  details: {
    invoiceAttrs: string[]
    dbAttrs: string[]
    premiumMismatches: string[]
    originMismatches: string[]
  }
}

/**
 * 필터링 결과
 */
export interface FilterResult {
  /** 1차 후보 (고점수) */
  primary: Array<DBProduct & { attributeScore: number }>
  /** 2차 후보 (저점수) */
  secondary: Array<DBProduct & { attributeScore: number }>
}

/**
 * 프리미엄 속성 목록 (긴 패턴을 먼저 검사하도록 정렬)
 */
const PREMIUM_ATTRIBUTES = [
  '1++', // 1+보다 먼저 체크
  '1+',
  '친환경',
  '유기농',
  '무농약',
  '무항생제',
  'GAP',
  'HACCP',
  '한우',
  '프리미엄',
] as const

/**
 * 원산지 관련 키워드 (정확한 매칭을 위해 긴 패턴부터)
 */
const ORIGIN_KEYWORDS = {
  domestic: ['국내산', '한국산', '국산'], // 국산은 마지막에
  imported: ['외국산', '수입산', '수입'], // 수입은 마지막에
} as const

/**
 * 품명에서 프리미엄 속성을 추출합니다
 *
 * @param itemName 품명
 * @returns 추출된 속성 배열
 *
 * @example
 * extractAttributes('친환경 깻잎(국내산)')
 * // ['친환경', '국내산']
 *
 * extractAttributes('한우 1++ 등심')
 * // ['한우', '1++']
 */
export function extractAttributes(itemName: string): string[] {
  const attributes: string[] = []
  let remaining = itemName.trim()

  // 원산지 추출 (긴 패턴부터 검사)
  const allOriginKeywords = [
    ...ORIGIN_KEYWORDS.imported.map(k => ({ keyword: k, type: '수입산' as const })),
    ...ORIGIN_KEYWORDS.domestic.map(k => ({ keyword: k, type: '국내산' as const })),
  ].sort((a, b) => b.keyword.length - a.keyword.length) // 긴 것부터

  let hasOrigin = false
  for (const { keyword, type } of allOriginKeywords) {
    if (remaining.includes(keyword)) {
      attributes.push(type)
      remaining = remaining.replace(keyword, '') // 매칭된 부분 제거
      hasOrigin = true
      break
    }
  }

  // 프리미엄 속성 추출 (긴 패턴부터 검사하고 제거)
  for (const attr of PREMIUM_ATTRIBUTES) {
    if (remaining.includes(attr)) {
      attributes.push(attr)
      // 이미 추출된 속성은 제거하여 중복 매칭 방지
      // 예: '1++'를 추출했으면 '1+'가 다시 매칭되지 않도록
      remaining = remaining.replace(attr, '')
    }
  }

  return [...new Set(attributes)] // 중복 제거 (안전 장치)
}

/**
 * 두 속성 배열을 비교하여 점수를 계산합니다
 *
 * @param invoiceAttrs 거래명세서 품명에서 추출한 속성
 * @param dbAttrs DB 품목에서 추출한 속성
 * @returns 비교 결과 (점수 및 불일치 목록)
 *
 * @example
 * compareAttributes(['친환경', '국내산'], ['친환경'])
 * // { score: 100, mismatches: [], details: {...} }
 *
 * compareAttributes(['국내산'], ['친환경', '국내산'])
 * // { score: 85, mismatches: ['친환경'], details: {...} }
 *
 * compareAttributes(['국내산'], ['수입산'])
 * // { score: 80, mismatches: ['원산지 불일치'], details: {...} }
 */
export function compareAttributes(
  invoiceAttrs: string[],
  dbAttrs: string[]
): AttributeComparisonResult {
  let score = 100
  const mismatches: string[] = []
  const premiumMismatches: string[] = []
  const originMismatches: string[] = []

  // 원산지 불일치 체크 (최우선)
  const invoiceHasDomestic = invoiceAttrs.includes('국내산')
  const invoiceHasImported = invoiceAttrs.includes('수입산')
  const dbHasDomestic = dbAttrs.includes('국내산')
  const dbHasImported = dbAttrs.includes('수입산')

  // 원산지가 서로 반대인 경우 (국내산 vs 수입산): -20점
  if (
    (invoiceHasDomestic && dbHasImported) ||
    (invoiceHasImported && dbHasDomestic)
  ) {
    score -= 20
    mismatches.push('원산지 불일치')
    originMismatches.push('원산지 불일치 (국내산 vs 수입산)')
  }
  // 원산지가 한쪽에만 있는 경우: -15점
  else if (
    (invoiceHasDomestic && !dbHasDomestic && !dbHasImported) ||
    (invoiceHasImported && !dbHasImported && !dbHasDomestic)
  ) {
    score -= 15
    const origin = invoiceHasDomestic ? '국내산' : '수입산'
    mismatches.push(`${origin} 누락 (거래명세서에는 있으나 DB에 없음)`)
    originMismatches.push(origin)
  } else if (
    (!invoiceHasDomestic && !invoiceHasImported && dbHasDomestic) ||
    (!invoiceHasDomestic && !invoiceHasImported && dbHasImported)
  ) {
    score -= 15
    const origin = dbHasDomestic ? '국내산' : '수입산'
    mismatches.push(`${origin} 불일치 (DB에는 있으나 거래명세서에 없음)`)
    originMismatches.push(origin)
  }

  // 프리미엄 속성 불일치 체크
  for (const attr of PREMIUM_ATTRIBUTES) {
    const invoiceHas = invoiceAttrs.includes(attr)
    const dbHas = dbAttrs.includes(attr)

    if (invoiceHas !== dbHas) {
      score -= 15
      if (invoiceHas && !dbHas) {
        mismatches.push(`${attr} 누락 (거래명세서에는 있으나 DB에 없음)`)
        premiumMismatches.push(attr)
      } else {
        mismatches.push(`${attr} 불일치 (DB에는 있으나 거래명세서에 없음)`)
        premiumMismatches.push(attr)
      }
    }
  }

  return {
    score,
    mismatches,
    details: {
      invoiceAttrs,
      dbAttrs,
      premiumMismatches,
      originMismatches,
    },
  }
}

/**
 * 후보 품목들을 속성 기준으로 필터링하여 우선순위를 나눕니다
 *
 * @param invoiceItem 거래명세서 항목
 * @param candidates DB 후보 품목 목록
 * @param scoreThreshold 1차/2차 후보를 나누는 점수 기준 (기본값: 90)
 * @returns 1차 후보와 2차 후보로 분류된 결과
 *
 * @example
 * const invoice = { itemName: '친환경 깻잎(국내산)', ... }
 * const candidates = [
 *   { id: '1', name: '친환경 깻잎', price: 5000 },
 *   { id: '2', name: '깻잎', price: 4000 },
 *   { id: '3', name: '깻잎(친환경,유기농)', price: 6000 }
 * ]
 * const result = filterByAttributes(invoice, candidates)
 * // result.primary: [{ id: '1', name: '친환경 깻잎', attributeScore: 100 }]
 * // result.secondary: [{ id: '2', name: '깻잎', attributeScore: 85 }, ...]
 */
export function filterByAttributes(
  invoiceItem: InvoiceItem,
  candidates: DBProduct[],
  scoreThreshold = 90
): FilterResult {
  const invoiceAttrs = extractAttributes(invoiceItem.itemName)

  const scoredCandidates = candidates.map(candidate => {
    const dbAttrs = extractAttributes(candidate.name)
    const comparison = compareAttributes(invoiceAttrs, dbAttrs)

    return {
      ...candidate,
      attributeScore: comparison.score,
      _comparison: comparison, // 디버깅용
    }
  })

  // 점수 기준으로 1차/2차 분류
  const primary = scoredCandidates
    .filter(c => c.attributeScore >= scoreThreshold)
    .sort((a, b) => b.attributeScore - a.attributeScore)

  const secondary = scoredCandidates
    .filter(c => c.attributeScore < scoreThreshold)
    .sort((a, b) => b.attributeScore - a.attributeScore)

  return {
    primary: primary.map(({ _comparison, ...rest }) => rest),
    secondary: secondary.map(({ _comparison, ...rest }) => rest),
  }
}
