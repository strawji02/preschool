import { describe, it, expect } from 'vitest'
import {
  calculateFinalScore,
  matchWithFunnel,
  getFunnelRecommendations,
} from './funnel-matcher'
import type { InvoiceItem } from './excel-parser'
import type { DBProduct } from './price-cluster'

describe('calculateFinalScore', () => {
  it('가중 평균을 올바르게 계산해야 함', () => {
    // 가격 40%, 속성 40%, 텍스트 20%
    expect(calculateFinalScore(100, 100, 100)).toBe(100)
    expect(calculateFinalScore(100, 100, 0)).toBe(80)
    expect(calculateFinalScore(100, 50, 0)).toBe(60)
    expect(calculateFinalScore(50, 100, 0)).toBe(60)
    expect(calculateFinalScore(50, 50, 50)).toBe(50)
  })

  it('텍스트 점수가 없어도 정상 작동해야 함', () => {
    const score = calculateFinalScore(90, 85)
    expect(score).toBe(90 * 0.4 + 85 * 0.4 + 0 * 0.2)
  })
})

describe('matchWithFunnel', () => {
  const createInvoiceItem = (overrides?: Partial<InvoiceItem>): InvoiceItem => ({
    rowNumber: 1,
    itemName: '친환경 깻잎(국내산)',
    spec: '100g',
    quantity: 10,
    unitPrice: 5000, // 50원/g
    amount: 50000,
    ...overrides,
  })

  const createDBProduct = (
    id: string,
    name: string,
    spec: string,
    price: number,
    category = '농산물'
  ): DBProduct => ({
    id,
    name,
    spec,
    price,
    category,
  })

  it('가격 범위 내 + 속성 일치 상품을 1차 추천으로 분류해야 함', () => {
    const invoice = createInvoiceItem({
      itemName: '친환경 깻잎(국내산)', // 원산지 포함
    })

    const candidates = [
      createDBProduct('1', '친환경 깻잎(국내산)', '100g', 5000), // 완전히 일치
      createDBProduct('2', '깻잎', '100g', 5000), // 속성 누락
      createDBProduct('3', '친환경 깻잎(국내산)', '100g', 10000), // 가격 범위 외 (100원/g)
    ]

    const result = matchWithFunnel(invoice, candidates)

    // 1차 추천: 가격 범위 내 && 속성 일치
    expect(result.primary).toHaveLength(1)
    expect(result.primary[0].id).toBe('1')

    // 2차 추천: 나머지
    expect(result.secondary.length).toBeGreaterThan(0)
  })

  it('Top 3 추천만 반환해야 함', () => {
    const invoice = createInvoiceItem({
      itemName: '친환경 깻잎(국내산)',
    })

    const candidates = [
      createDBProduct('1', '친환경 깻잎(국내산)', '100g', 5000),
      createDBProduct('2', '친환경 깻잎(국내산)', '100g', 5100),
      createDBProduct('3', '친환경 깻잎(국내산)', '100g', 5200),
      createDBProduct('4', '친환경 깻잎(국내산)', '100g', 5300),
      createDBProduct('5', '친환경 깻잎(국내산)', '100g', 5400),
    ]

    const result = matchWithFunnel(invoice, candidates)

    expect(result.primary).toHaveLength(3)
  })

  it('점수와 감점 사유를 올바르게 기록해야 함', () => {
    const invoice = createInvoiceItem({
      itemName: '친환경 깻잎(국내산)',
    })

    const candidates = [
      createDBProduct('1', '친환경 깻잎(국내산)', '100g', 5000), // 완벽 일치
      createDBProduct('2', '깻잎', '100g', 5000), // 속성 누락
      createDBProduct('3', '친환경 깻잎(국내산)', '100g', 10000), // 가격 범위 외
    ]

    const result = matchWithFunnel(invoice, candidates)

    // 점수 확인
    expect(result.scores.has('1')).toBe(true)
    expect(result.scores.has('2')).toBe(true)
    expect(result.scores.has('3')).toBe(true)

    // 감점 사유 확인
    expect(result.reasons.has('1')).toBe(false) // 완벽 일치는 사유 없음
    expect(result.reasons.has('2')).toBe(true) // 속성 불일치
    expect(result.reasons.has('3')).toBe(true) // 가격 범위 외
  })

  it('빈 후보 목록에 대해서도 정상 작동해야 함', () => {
    const invoice = createInvoiceItem()
    const result = matchWithFunnel(invoice, [])

    expect(result.primary).toHaveLength(0)
    expect(result.secondary).toHaveLength(0)
    expect(result.scores.size).toBe(0)
    expect(result.reasons.size).toBe(0)
  })

  it('원산지 불일치 상품은 점수가 낮아야 함', () => {
    const invoice = createInvoiceItem({
      itemName: '깻잎(국내산)',
    })

    const candidates = [
      createDBProduct('1', '깻잎(국내산)', '100g', 5000), // 일치
      createDBProduct('2', '깻잎(수입산)', '100g', 5000), // 원산지 불일치
    ]

    const result = matchWithFunnel(invoice, candidates)

    const score1 = result.scores.get('1')!
    const score2 = result.scores.get('2')!

    expect(score1).toBeGreaterThan(score2)
    expect(result.reasons.get('2')).toContain('속성 불일치 (20점 감점)')
  })
})

describe('getFunnelRecommendations', () => {
  it('DB 검색 결과가 없으면 에러를 반환해야 함', async () => {
    const invoice: InvoiceItem = {
      rowNumber: 1,
      itemName: '존재하지 않는 품목',
      spec: '1kg',
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
    }

    const searchFn = async () => []

    const result = await getFunnelRecommendations(invoice, searchFn)

    expect(result.success).toBe(false)
    expect(result.error).toBe('검색 결과가 없습니다')
  })

  it('성공 시 추천 결과와 메타데이터를 반환해야 함', async () => {
    const invoice: InvoiceItem = {
      rowNumber: 1,
      itemName: '양파',
      spec: '1kg',
      quantity: 10,
      unitPrice: 5000,
      amount: 50000,
    }

    const searchFn = async () => [
      {
        id: '1',
        name: '양파',
        spec: '1kg',
        price: 5000,
        category: '농산물',
      },
      {
        id: '2',
        name: '양파',
        spec: '1kg',
        price: 6000,
        category: '농산물',
      },
    ]

    const result = await getFunnelRecommendations(invoice, searchFn)

    expect(result.success).toBe(true)
    expect(result.result.primary.length).toBeGreaterThan(0)
    expect(result.meta.invoicePricePerUnit).toBeDefined()
    expect(result.meta.priceRange).toBeDefined()
  })

  it('검색 함수에서 에러 발생 시 처리해야 함', async () => {
    const invoice: InvoiceItem = {
      rowNumber: 1,
      itemName: '양파',
      spec: '1kg',
      quantity: 10,
      unitPrice: 5000,
      amount: 50000,
    }

    const searchFn = async () => {
      throw new Error('DB 연결 실패')
    }

    const result = await getFunnelRecommendations(invoice, searchFn)

    expect(result.success).toBe(false)
    expect(result.error).toBe('DB 연결 실패')
  })
})
