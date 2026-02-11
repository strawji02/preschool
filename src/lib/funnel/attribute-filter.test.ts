import { describe, it, expect } from 'vitest'
import {
  extractAttributes,
  compareAttributes,
  filterByAttributes,
  type InvoiceItem,
  type DBProduct,
} from './attribute-filter'

describe('extractAttributes', () => {
  it('프리미엄 속성을 추출한다', () => {
    expect(extractAttributes('친환경 깻잎')).toEqual(['친환경'])
    expect(extractAttributes('유기농 당근')).toEqual(['유기농'])
    expect(extractAttributes('무농약 상추')).toEqual(['무농약'])
    expect(extractAttributes('무항생제 돼지')).toEqual(['무항생제'])
    expect(extractAttributes('GAP 인증 사과')).toEqual(['GAP'])
    expect(extractAttributes('HACCP 인증 계란')).toEqual(['HACCP'])
    expect(extractAttributes('한우 1++ 등심')).toEqual(expect.arrayContaining(['한우', '1++']))
    expect(extractAttributes('한우 1+ 안심')).toEqual(expect.arrayContaining(['한우', '1+']))
    expect(extractAttributes('프리미엄 배')).toEqual(['프리미엄'])
  })

  it('원산지를 추출한다', () => {
    expect(extractAttributes('깻잎(국내산)')).toEqual(['국내산'])
    expect(extractAttributes('국산 사과')).toEqual(['국내산'])
    expect(extractAttributes('한국산 배추')).toEqual(['국내산'])
    expect(extractAttributes('수입산 바나나')).toEqual(['수입산'])
    expect(extractAttributes('수입 오렌지')).toEqual(['수입산'])
    expect(extractAttributes('외국산 망고')).toEqual(['수입산'])
  })

  it('여러 속성을 동시에 추출한다', () => {
    expect(extractAttributes('친환경 깻잎(국내산)')).toEqual(expect.arrayContaining(['친환경', '국내산']))
    expect(extractAttributes('유기농 무농약 상추')).toEqual(expect.arrayContaining(['유기농', '무농약']))
    expect(extractAttributes('한우 1++ 등심(국내산)')).toEqual(expect.arrayContaining(['한우', '1++', '국내산']))
  })

  it('속성이 없으면 빈 배열을 반환한다', () => {
    expect(extractAttributes('양파')).toEqual([])
    expect(extractAttributes('깻잎')).toEqual([])
    expect(extractAttributes('돼지고기')).toEqual([])
  })

  it('중복된 속성은 제거한다', () => {
    // 국내산, 국산이 모두 있어도 하나로 통합
    expect(extractAttributes('국내산 국산 깻잎')).toEqual(['국내산'])
  })
})

describe('compareAttributes', () => {
  it('속성이 완전히 일치하면 100점', () => {
    const result = compareAttributes(['친환경', '국내산'], ['친환경', '국내산'])
    expect(result.score).toBe(100)
    expect(result.mismatches).toEqual([])
  })

  it('속성이 모두 없으면 100점', () => {
    const result = compareAttributes([], [])
    expect(result.score).toBe(100)
    expect(result.mismatches).toEqual([])
  })

  it('프리미엄 속성 불일치 시 -15점', () => {
    // 거래명세서에 없는데 DB에 있음
    const result1 = compareAttributes(['국내산'], ['친환경', '국내산'])
    expect(result1.score).toBe(85)
    expect(result1.mismatches).toContain('친환경 불일치 (DB에는 있으나 거래명세서에 없음)')

    // 거래명세서에 있는데 DB에 없음
    const result2 = compareAttributes(['친환경', '국내산'], ['국내산'])
    expect(result2.score).toBe(85)
    expect(result2.mismatches).toContain('친환경 누락 (거래명세서에는 있으나 DB에 없음)')
  })

  it('원산지 불일치 시 -20점', () => {
    const result = compareAttributes(['국내산'], ['수입산'])
    expect(result.score).toBe(80)
    expect(result.mismatches).toContain('원산지 불일치')
    expect(result.details.originMismatches).toEqual(['원산지 불일치 (국내산 vs 수입산)'])
  })

  it('여러 속성 불일치 시 누적 차감', () => {
    // 친환경 불일치(-15) + 유기농 불일치(-15)
    const result = compareAttributes(
      ['국내산'],
      ['친환경', '유기농', '국내산']
    )
    expect(result.score).toBe(70)
    expect(result.mismatches).toHaveLength(2)
  })

  it('원산지 불일치와 프리미엄 속성 불일치 동시 발생', () => {
    // 원산지 불일치(-20) + 친환경 불일치(-15)
    const result = compareAttributes(['국내산'], ['친환경', '수입산'])
    expect(result.score).toBe(65)
    expect(result.mismatches).toHaveLength(2)
  })
})

describe('filterByAttributes', () => {
  const createInvoiceItem = (itemName: string): InvoiceItem => ({
    rowNumber: 1,
    itemName,
    spec: '1kg',
    quantity: 10,
    unitPrice: 5000,
    amount: 50000,
  })

  const createDBProduct = (id: string, name: string, price: number): DBProduct => ({
    id,
    name,
    price,
  })

  it('속성이 일치하는 항목을 primary로 분류한다', () => {
    const invoice = createInvoiceItem('친환경 깻잎(국내산)')
    const candidates = [
      createDBProduct('1', '친환경 깻잎(국내산)', 5000),
      createDBProduct('2', '친환경 깻잎', 4800),
      createDBProduct('3', '깻잎(국내산)', 4500),
      createDBProduct('4', '깻잎', 4000),
    ]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(1)
    expect(result.primary[0].id).toBe('1')
    expect(result.primary[0].attributeScore).toBe(100)

    expect(result.secondary).toHaveLength(3)
  })

  it('테스트 케이스: 깻잎(국내산) vs 깻잎(친환경)', () => {
    const invoice = createInvoiceItem('깻잎(국내산)')
    const candidates = [createDBProduct('1', '깻잎(친환경)', 5000)]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(0)
    expect(result.secondary).toHaveLength(1)
    // 친환경 불일치 (-15점) + 국내산 누락 (-15점) = -30점
    expect(result.secondary[0].attributeScore).toBe(70)
  })

  it('테스트 케이스: 친환경 깻잎 vs 일반 깻잎', () => {
    const invoice = createInvoiceItem('친환경 깻잎')
    const candidates = [createDBProduct('1', '깻잎', 4000)]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(0)
    expect(result.secondary).toHaveLength(1)
    expect(result.secondary[0].attributeScore).toBe(85) // -15점 (친환경 누락)
  })

  it('테스트 케이스: 국내산 돼지 vs 수입 돼지', () => {
    const invoice = createInvoiceItem('국내산 돼지고기')
    const candidates = [createDBProduct('1', '수입 돼지고기', 3000)]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(0)
    expect(result.secondary).toHaveLength(1)
    expect(result.secondary[0].attributeScore).toBe(80) // -20점 (원산지 불일치)
  })

  it('점수 기준으로 정렬한다', () => {
    const invoice = createInvoiceItem('친환경 유기농 깻잎(국내산)')
    const candidates = [
      createDBProduct('1', '친환경 유기농 깻잎(국내산)', 6000), // 100점
      createDBProduct('2', '친환경 깻잎(국내산)', 5500), // 85점 (유기농 누락)
      createDBProduct('3', '깻잎(국내산)', 4500), // 70점 (친환경, 유기농 누락)
      createDBProduct('4', '깻잎', 4000), // 70점 (친환경, 유기농, 국내산 누락)
    ]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(1)
    expect(result.primary[0].id).toBe('1')

    expect(result.secondary).toHaveLength(3)
    expect(result.secondary[0].id).toBe('2')
    expect(result.secondary[0].attributeScore).toBe(85)
  })

  it('커스텀 점수 기준을 적용한다', () => {
    const invoice = createInvoiceItem('친환경 깻잎')
    const candidates = [
      createDBProduct('1', '친환경 깻잎', 5000), // 100점
      createDBProduct('2', '깻잎', 4500), // 85점
    ]

    // 기준을 80점으로 낮추면 둘 다 primary
    const result = filterByAttributes(invoice, candidates, 80)

    expect(result.primary).toHaveLength(2)
    expect(result.secondary).toHaveLength(0)
  })

  it('한우 등급을 올바르게 처리한다', () => {
    const invoice = createInvoiceItem('한우 1++ 등심')
    const candidates = [
      createDBProduct('1', '한우 1++ 등심', 50000), // 100점
      createDBProduct('2', '한우 1+ 등심', 45000), // 70점 (1++ 누락 -15, 1+ 불일치 -15)
      createDBProduct('3', '한우 등심', 40000), // 85점 (1++ 누락 -15)
      createDBProduct('4', '등심', 35000), // 70점 (한우 누락 -15, 1++ 누락 -15)
    ]

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(1)
    expect(result.primary[0].id).toBe('1')
    expect(result.primary[0].attributeScore).toBe(100)

    expect(result.secondary).toHaveLength(3)
    // 1+와 1++는 서로 다른 속성이므로 둘 다 불일치 (-30점)
    expect(result.secondary[0].attributeScore).toBe(85) // id: '3' (한우만 일치)
  })

  it('빈 후보 배열을 처리한다', () => {
    const invoice = createInvoiceItem('친환경 깻잎')
    const candidates: DBProduct[] = []

    const result = filterByAttributes(invoice, candidates)

    expect(result.primary).toHaveLength(0)
    expect(result.secondary).toHaveLength(0)
  })
})
