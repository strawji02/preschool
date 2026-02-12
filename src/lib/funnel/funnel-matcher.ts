/**
 * 깔때기(Funnel) 알고리즘 5단계: 최종 매칭 로직 통합
 *
 * 4개 모듈을 순차적으로 적용하여 최적의 상품 매칭을 수행합니다:
 * 1. g당 단가 계산 (price-normalizer)
 * 2. 엑셀 파일 파싱 (excel-parser) - 이미 완료된 상태로 가정
 * 3. 가격 군집화 (price-cluster)
 * 4. 속성 소거법 (attribute-filter)
 */

import type { InvoiceItem } from './excel-parser'
import type { DBProduct, ClusterResult } from './price-cluster'
import type { FilterResult } from './attribute-filter'
import { calculatePricePerUnit } from './price-normalizer'
import { clusterByPrice } from './price-cluster'
import { filterByAttributes } from './attribute-filter'

/**
 * 매칭 결과
 */
export interface MatchResult {
  /** 1차 추천 (점수 높은 순) */
  primary: DBProduct[]
  /** 2차 추천 (가격/속성 불일치) */
  secondary: DBProduct[]
  /** 품목별 최종 점수 */
  scores: Map<string, number>
  /** 점수 감점 사유 */
  reasons: Map<string, string[]>
}

/**
 * 깔때기 알고리즘 결과
 */
export interface FunnelResult {
  /** 성공 여부 */
  success: boolean
  /** 매칭 결과 */
  result: MatchResult
  /** 에러 메시지 */
  error?: string
  /** 메타데이터 */
  meta: {
    /** 가격 범위 정보 */
    priceRange?: ClusterResult['priceRange']
    /** 거래명세서 g당 단가 */
    invoicePricePerUnit?: number
    /** 단위 */
    unit?: 'g' | 'ml' | 'ea'
  }
}

/**
 * 최종 점수 계산
 *
 * @param priceScore 가격 점수 (0-100)
 * @param attributeScore 속성 점수 (0-100)
 * @param textScore 텍스트 유사도 점수 (0-100, 선택적)
 * @returns 최종 점수 (0-100)
 *
 * @example
 * calculateFinalScore(90, 100, 80)
 * // 89 (가중 평균: 가격 40%, 속성 40%, 텍스트 20%)
 */
export function calculateFinalScore(
  priceScore: number,
  attributeScore: number,
  textScore: number = 0
): number {
  // 가중치: 가격 40%, 속성 40%, 텍스트 20%
  const weights = {
    price: 0.4,
    attribute: 0.4,
    text: 0.2,
  }

  return (
    priceScore * weights.price +
    attributeScore * weights.attribute +
    textScore * weights.text
  )
}

/**
 * 가격 점수 계산 (가격 범위 내 여부 기반)
 *
 * @param isInRange 가격 범위 내 여부
 * @returns 가격 점수 (범위 내: 100, 범위 외: 50)
 */
function calculatePriceScore(isInRange: boolean): number {
  return isInRange ? 100 : 50
}

/**
 * 깔때기 알고리즘을 적용한 매칭
 *
 * @param invoiceItem 거래명세서 품목
 * @param dbProducts DB 검색 결과 (전체 후보)
 * @returns 매칭 결과 (1차/2차 추천 분리)
 *
 * @example
 * const invoice = {
 *   itemName: '친환경 깻잎(국내산)',
 *   spec: '100g',
 *   unitPrice: 5000,
 *   quantity: 10,
 *   amount: 50000,
 *   rowNumber: 1
 * }
 * const dbProducts = [...] // DB에서 검색한 후보들
 * const result = matchWithFunnel(invoice, dbProducts)
 * // result.primary: Top 3 추천
 * // result.secondary: 나머지 후보들
 */
export function matchWithFunnel(
  invoiceItem: InvoiceItem,
  dbProducts: DBProduct[]
): MatchResult {
  const scores = new Map<string, number>()
  const reasons = new Map<string, string[]>()

  // 0. 거래명세서 품목의 g당 단가 계산
  const invoicePricePerUnit = calculatePricePerUnit(
    invoiceItem.unitPrice,
    invoiceItem.spec
  )

  // 1. 가격 군집화 적용
  const clusterResult = clusterByPrice(invoiceItem, dbProducts)

  // 2. 속성 소거법 적용 (가격 범위 내 후보에 대해)
  const inRangeFiltered = filterByAttributes(
    invoiceItem,
    clusterResult.inRange,
    90 // 점수 기준 90점 이상
  )

  // 3. 속성 소거법 적용 (가격 범위 외 후보에 대해)
  const outRangeFiltered = filterByAttributes(
    invoiceItem,
    clusterResult.outRange,
    90
  )

  // 4. 최종 점수 계산 및 정렬
  const calculateAndStoreScore = (
    product: DBProduct & { attributeScore: number },
    isInRange: boolean
  ) => {
    const priceScore = calculatePriceScore(isInRange)
    const attributeScore = product.attributeScore
    const finalScore = calculateFinalScore(priceScore, attributeScore, 0)

    scores.set(product.id, finalScore)

    // 감점 사유 수집 (완벽 일치가 아닌 경우만)
    const productReasons: string[] = []

    if (!isInRange) {
      productReasons.push('가격 범위 외')
    }

    if (attributeScore < 100) {
      productReasons.push(`속성 불일치 (${100 - attributeScore}점 감점)`)
    }

    // 감점 사유가 있는 경우에만 reasons에 추가
    if (productReasons.length > 0) {
      reasons.set(product.id, productReasons)
    }
  }

  // 가격 범위 내 1차 후보들 점수 계산
  inRangeFiltered.primary.forEach(p => calculateAndStoreScore(p, true))
  inRangeFiltered.secondary.forEach(p => calculateAndStoreScore(p, true))

  // 가격 범위 외 2차 후보들 점수 계산
  outRangeFiltered.primary.forEach(p => calculateAndStoreScore(p, false))
  outRangeFiltered.secondary.forEach(p => calculateAndStoreScore(p, false))

  // 5. 1차/2차 추천 분류
  // 1차: 가격 범위 내 && 속성 점수 90점 이상
  const primary = [
    ...inRangeFiltered.primary.map(p => ({
      ...p,
      _finalScore: scores.get(p.id) || 0,
    })),
  ]
    .sort((a, b) => b._finalScore - a._finalScore)
    .slice(0, 3) // Top 3만
    .map(({ attributeScore, _finalScore, ...rest }) => rest)

  // 2차: 나머지 모두 (가격 범위 외 또는 속성 불일치)
  const secondary = [
    ...inRangeFiltered.secondary.map(p => ({
      ...p,
      _finalScore: scores.get(p.id) || 0,
    })),
    ...outRangeFiltered.primary.map(p => ({
      ...p,
      _finalScore: scores.get(p.id) || 0,
    })),
    ...outRangeFiltered.secondary.map(p => ({
      ...p,
      _finalScore: scores.get(p.id) || 0,
    })),
  ]
    .sort((a, b) => b._finalScore - a._finalScore)
    .map(({ attributeScore, _finalScore, ...rest }) => rest)

  return {
    primary,
    secondary,
    scores,
    reasons,
  }
}

/**
 * 깔때기 알고리즘 추천 (비동기 버전)
 *
 * DB 검색까지 포함한 완전한 추천 함수입니다.
 *
 * @param invoiceItem 거래명세서 품목
 * @param searchFn DB 검색 함수 (품명 → 후보 목록)
 * @returns 깔때기 알고리즘 결과
 *
 * @example
 * const result = await getFunnelRecommendations(
 *   { itemName: '양파', spec: '1kg', unitPrice: 5000, ... },
 *   async (itemName) => {
 *     // Supabase에서 품명으로 검색
 *     return await searchProductsByName(itemName)
 *   }
 * )
 */
export async function getFunnelRecommendations(
  invoiceItem: InvoiceItem,
  searchFn: (itemName: string) => Promise<DBProduct[]>
): Promise<FunnelResult> {
  try {
    // 1. DB 검색
    const candidates = await searchFn(invoiceItem.itemName)

    if (candidates.length === 0) {
      return {
        success: false,
        result: {
          primary: [],
          secondary: [],
          scores: new Map(),
          reasons: new Map(),
        },
        error: '검색 결과가 없습니다',
        meta: {},
      }
    }

    // 2. 깔때기 알고리즘 적용
    const matchResult = matchWithFunnel(invoiceItem, candidates)

    // 3. 메타데이터 생성
    const clusterResult = clusterByPrice(invoiceItem, candidates)
    const invoicePricePerUnit = calculatePricePerUnit(
      invoiceItem.unitPrice,
      invoiceItem.spec
    )

    return {
      success: true,
      result: matchResult,
      meta: {
        priceRange: clusterResult.priceRange,
        invoicePricePerUnit: invoicePricePerUnit?.pricePerUnit,
        unit: invoicePricePerUnit?.unit,
      },
    }
  } catch (error) {
    return {
      success: false,
      result: {
        primary: [],
        secondary: [],
        scores: new Map(),
        reasons: new Map(),
      },
      error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다',
      meta: {},
    }
  }
}
