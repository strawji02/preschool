/**
 * 깔때기(Funnel) 알고리즘 3단계: 가격 군집화 필터
 *
 * g당 단가를 기준으로 DB 검색 결과를 필터링하여
 * 적정 가격 범위 내의 상품만 상위 순위로 배치합니다.
 */

import { InvoiceItem } from './excel-parser'
import { calculatePricePerGram, calculatePricePerUnit } from './price-normalizer'

/**
 * DB 상품 인터페이스 (간소화)
 */
export interface DBProduct {
  /** 상품 ID */
  id: string
  /** 상품명 */
  name: string
  /** 규격 */
  spec: string
  /** 가격 */
  price: number
  /** 카테고리 */
  category?: string
  /** 기타 메타데이터 */
  [key: string]: any
}

/**
 * 가격 범위
 */
export interface PriceRange {
  /** 최소 가격 (원/g) */
  min: number
  /** 최대 가격 (원/g) */
  max: number
  /** 기준 가격 (원/g) */
  base: number
  /** 적용된 허용 오차 (%) */
  tolerance: number
}

/**
 * 가격 군집화 결과
 */
export interface ClusterResult {
  /** 범위 내 상품 (우선 순위) */
  inRange: DBProduct[]
  /** 범위 외 상품 (하위 순위) */
  outRange: DBProduct[]
  /** 적용된 가격 범위 */
  priceRange: PriceRange
}

/**
 * 카테고리별 허용 오차 (%)
 */
const CATEGORY_TOLERANCES: Record<string, number> = {
  농산물: 40, // 계절 변동 고려
  축산물: 25, // 가격 안정
  가공품: 20, // 정가 제품
  수산물: 35, // 계절 변동
  기타: 30, // 기본값
}

/**
 * 카테고리별 허용 오차 반환
 *
 * @param category 카테고리명
 * @returns 허용 오차 (%)
 *
 * @example
 * getCategoryTolerance('농산물') // 40
 * getCategoryTolerance('축산물') // 25
 * getCategoryTolerance('가공품') // 20
 * getCategoryTolerance('알 수 없음') // 30 (기본값)
 */
export function getCategoryTolerance(category: string): number {
  // 카테고리 정규화 (공백 제거, 소문자 변환)
  const normalized = category.trim()

  // 정확히 일치하는 카테고리 찾기
  if (normalized in CATEGORY_TOLERANCES) {
    return CATEGORY_TOLERANCES[normalized]
  }

  // 부분 일치 검색
  for (const [key, value] of Object.entries(CATEGORY_TOLERANCES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value
    }
  }

  // 기본값
  return CATEGORY_TOLERANCES['기타']
}

/**
 * 가격 범위 계산
 *
 * @param pricePerGram g당 단가 (원/g)
 * @param category 카테고리명 (선택적)
 * @returns 가격 범위
 *
 * @example
 * calculatePriceRange(47, '농산물')
 * // { min: 28.2, max: 65.8, base: 47, tolerance: 40 }
 *
 * calculatePriceRange(100, '축산물')
 * // { min: 75, max: 125, base: 100, tolerance: 25 }
 *
 * calculatePriceRange(50, '가공품')
 * // { min: 40, max: 60, base: 50, tolerance: 20 }
 */
export function calculatePriceRange(
  pricePerGram: number,
  category: string = '기타'
): PriceRange {
  const tolerance = getCategoryTolerance(category)
  const toleranceRate = tolerance / 100

  const min = pricePerGram * (1 - toleranceRate)
  const max = pricePerGram * (1 + toleranceRate)

  return {
    min,
    max,
    base: pricePerGram,
    tolerance,
  }
}

/**
 * 가격 기준 군집화
 *
 * @param invoiceItem 거래명세서 품목
 * @param candidates DB 검색 결과 후보들
 * @returns 군집화 결과 (범위 내/외 분리)
 *
 * @example
 * clusterByPrice(
 *   { itemName: '양파', spec: '1kg', unitPrice: 5000, ... },
 *   [
 *     { id: '1', name: '양파', spec: '1kg', price: 5000, category: '농산물' },
 *     { id: '2', name: '양파', spec: '1kg', price: 10000, category: '농산물' },
 *   ]
 * )
 * // { inRange: [id: '1'], outRange: [id: '2'], priceRange: {...} }
 */
export function clusterByPrice(
  invoiceItem: InvoiceItem,
  candidates: DBProduct[]
): ClusterResult {
  // 1. 거래명세서 품목의 g당 단가 계산
  const invoicePricePerUnit = calculatePricePerUnit(
    invoiceItem.unitPrice,
    invoiceItem.spec
  )

  if (!invoicePricePerUnit) {
    // g당 단가 계산 실패 시 모든 후보를 범위 외로 처리
    return {
      inRange: [],
      outRange: candidates,
      priceRange: {
        min: 0,
        max: 0,
        base: 0,
        tolerance: 0,
      },
    }
  }

  const invoicePricePerGram = invoicePricePerUnit.pricePerUnit

  // 2. 카테고리 결정 (후보 중 가장 많이 등장하는 카테고리 사용)
  const categoryCount: Record<string, number> = {}
  candidates.forEach(candidate => {
    const category = candidate.category || '기타'
    categoryCount[category] = (categoryCount[category] || 0) + 1
  })

  const mostCommonCategory =
    Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '기타'

  // 3. 가격 범위 계산
  const priceRange = calculatePriceRange(invoicePricePerGram, mostCommonCategory)

  // 4. 후보들을 가격 범위 기준으로 분류
  const inRange: DBProduct[] = []
  const outRange: DBProduct[] = []

  candidates.forEach(candidate => {
    // DB 상품의 g당 단가 계산
    const candidatePricePerUnit = calculatePricePerUnit(candidate.price, candidate.spec)

    if (!candidatePricePerUnit) {
      // 단가 계산 실패 시 범위 외로 처리
      outRange.push(candidate)
      return
    }

    const candidatePricePerGram = candidatePricePerUnit.pricePerUnit

    // 가격 범위 내인지 확인
    if (
      candidatePricePerGram >= priceRange.min &&
      candidatePricePerGram <= priceRange.max
    ) {
      inRange.push(candidate)
    } else {
      outRange.push(candidate)
    }
  })

  return {
    inRange,
    outRange,
    priceRange,
  }
}

/**
 * 여러 거래명세서 품목에 대한 일괄 군집화
 *
 * @param invoiceItems 거래명세서 품목 배열
 * @param candidatesMap 품목별 후보 맵 (품목명 → 후보 배열)
 * @returns 품목별 군집화 결과 맵
 *
 * @example
 * clusterBatch(
 *   [
 *     { itemName: '양파', spec: '1kg', unitPrice: 5000, ... },
 *     { itemName: '당근', spec: '500g', unitPrice: 3000, ... },
 *   ],
 *   {
 *     '양파': [...],
 *     '당근': [...],
 *   }
 * )
 */
export function clusterBatch(
  invoiceItems: InvoiceItem[],
  candidatesMap: Record<string, DBProduct[]>
): Record<string, ClusterResult> {
  const results: Record<string, ClusterResult> = {}

  invoiceItems.forEach(item => {
    const candidates = candidatesMap[item.itemName] || []
    results[item.itemName] = clusterByPrice(item, candidates)
  })

  return results
}

/**
 * 군집화 결과를 우선순위에 따라 정렬된 단일 배열로 병합
 *
 * @param clusterResult 군집화 결과
 * @returns 정렬된 상품 배열 (범위 내 → 범위 외 순서)
 *
 * @example
 * mergeClusters({ inRange: [...], outRange: [...] })
 * // [...inRange, ...outRange]
 */
export function mergeClusters(clusterResult: ClusterResult): DBProduct[] {
  return [...clusterResult.inRange, ...clusterResult.outRange]
}

/**
 * 가격 편차 계산 (%)
 *
 * @param invoicePrice 거래명세서 가격
 * @param candidatePrice 후보 상품 가격
 * @returns 가격 편차 (%)
 *
 * @example
 * calculatePriceDeviation(100, 120) // 20 (20% 비쌈)
 * calculatePriceDeviation(100, 80) // -20 (20% 저렴)
 */
export function calculatePriceDeviation(
  invoicePrice: number,
  candidatePrice: number
): number {
  if (invoicePrice === 0) return 0
  return ((candidatePrice - invoicePrice) / invoicePrice) * 100
}
