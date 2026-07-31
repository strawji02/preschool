import { describe, it, expect } from 'vitest'
import { parseCjStatementSheet } from '@/features/settlement/parse/cj-statement'
import { crossCheckCjStatement } from '@/features/settlement/calc/cj-cross-check'
import type { NormalizedVenue } from '@/features/settlement/parse/types'

/**
 * [정산] CJ 거래명세서 파서 + 집계표 교차검증 (docs/systems/settlement.md §5-2)
 *
 * ★ 2026-07-31, 업무 방식이 바뀌었다. 앞으로 CJ에서 **집계표와 거래명세서를 함께**
 * 받는다. 둘은 담고 있는 것이 다르다:
 *
 * - 집계표   : 사업장×식당 집계. **원가와 단가 둘 다.** 정산 산식의 유일한 원가 출처.
 * - 거래명세서 : 날짜·품목 단위. **단가만.** 조정 근거와 기간 검증이 여기서 나온다.
 *
 * 거래명세서로 집계표를 대체할 수 없다 — 원가가 없으면 차액·적립금·부가세차액이
 * 전부 계산 불가다. 26년 7월 실측으로 역산도 확인했는데 14곳 중 0곳만 원단위
 * 일치였다 (계약 비율이 1.19813·1.34836처럼 깨끗한 값이 아니다).
 *
 * 그래서 둘을 **대조**한다. 같은 달 같은 식당이면 거래명세서 단가 합계가 집계표
 * 단가와 원단위로 같아야 한다. 다르면 어느 한쪽이 틀린 것이다.
 */

const HEADER = [
  '번호', '사업장명', '식당명', '구분', '상품코드', '상품명', '원산지', '단위',
  '주문량', '단가', '과세', '비과세', '공급가', '부가세', '총합계',
]

/** 실제 파일 모양 — 맨 위 총계 행, 날짜별 소계 행, 그 아래 품목 행 */
function sheet(): unknown[][] {
  return [
    HEADER,
    ['총계', null, null, null, null, null, null, null, 4, null, 2370, 27110, 29480, 237, 29717],
    ['2026-07-06 소계 ', null, null, null, null, null, null, null, 3, null, 2370, 13840, 16210, 237, 16447],
    [1, '키즈웰(아름솔)', '키즈웰(아름솔)', '일반 매출', '386323', '명품 순두부(3Kg/EA)', null, 'EA', 1, 13840, 0, 13840, 13840, 0, 13840],
    [2, '키즈웰(아름솔)', '키즈웰(아름솔)_방과후간식', '일반 매출', '100358', '백설 부침가루(1Kg/EA)', null, 'EA', 2, 1185, 2370, 0, 2370, 237, 2607],
    ['2026-07-08 소계 ', null, null, null, null, null, null, null, 1, null, 0, 13270, 13270, 0, 13270],
    [3, '키즈웰(우성)', '키즈웰(우성)', '일반 매출', '467997', '모산 백김치(2Kg/EA)', null, 'EA', 1, 13270, 0, 13270, 13270, 0, 13270],
  ]
}

describe('parseCjStatementSheet — 품목 단위 파싱', () => {
  it('총계·소계 행을 품목으로 세지 않는다', () => {
    // ⚠️ 집계표에서 총계 행을 데이터로 읽어 금액이 두 배가 된 전례가 있다 (docs §12)
    const r = parseCjStatementSheet(sheet())
    expect(r.items).toHaveLength(3)
    expect(r.items.map((i) => i.productCode)).toEqual(['386323', '100358', '467997'])
  })

  it('날짜는 직전 소계 행에서 이어받는다 — 품목 행에는 날짜가 없다', () => {
    const r = parseCjStatementSheet(sheet())
    expect(r.items.map((i) => i.date)).toEqual(['2026-07-06', '2026-07-06', '2026-07-08'])
  })

  it('과세/면세를 분해한다', () => {
    const r = parseCjStatementSheet(sheet())
    // 순두부 — 면세
    expect(r.items[0].tax).toEqual({ taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 })
    // 부침가루 — 과세
    expect(r.items[1].tax).toEqual({ taxableSupply: 2370, vat: 237, exempt: 0, total: 2607 })
  })

  it('수량·단가를 읽는다 — 부분 조정(12개 중 9개)에 필요하다', () => {
    const r = parseCjStatementSheet(sheet())
    expect(r.items[1]).toMatchObject({ quantity: 2, unitPrice: 1185, unit: 'EA' })
  })

  it('사업장×식당으로 집계한다 — 집계표와 대조할 단위', () => {
    const r = parseCjStatementSheet(sheet())
    expect(r.venues).toHaveLength(3)
    const 아름솔 = r.venues.find((v) => v.restaurantName === '키즈웰(아름솔)')
    expect(아름솔?.price).toEqual({ taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 })
  })

  it('기간을 뽑는다 — CJ 집계표에는 날짜가 없어서 여기서만 나온다', () => {
    const r = parseCjStatementSheet(sheet())
    expect(r.dateRange).toEqual({
      min: '2026-07-06',
      max: '2026-07-08',
      months: ['2026-07'],
    })
  })

  it('★ 품목 합계가 총계 행과 다르면 경고한다', () => {
    const rows = sheet()
    // 총계의 총합계를 1원 틀리게 만든다
    rows[1][14] = 29718
    const r = parseCjStatementSheet(rows)
    expect(r.warnings.join(' ')).toContain('총계')
  })

  it('총계와 맞으면 경고가 없다', () => {
    expect(parseCjStatementSheet(sheet()).warnings).toEqual([])
  })
})

describe('crossCheckCjStatement — 거래명세서 vs 집계표', () => {
  function venue(restaurantName: string, price: NormalizedVenue['price']): NormalizedVenue {
    return {
      source: 'cj',
      businessCode: '1013',
      businessName: '키즈웰(아름솔)',
      restaurantCode: '1000',
      restaurantName,
      cost: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
      price,
    }
  }

  const 명세서 = parseCjStatementSheet(sheet())

  it('단가가 원단위로 같으면 통과', () => {
    const 집계표 = [
      venue('키즈웰(아름솔)', { taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 }),
      venue('키즈웰(아름솔)_방과후간식', { taxableSupply: 2370, vat: 237, exempt: 0, total: 2607 }),
      { ...venue('키즈웰(우성)', { taxableSupply: 0, vat: 0, exempt: 13270, total: 13270 }), businessName: '키즈웰(우성)' },
    ]
    expect(crossCheckCjStatement(명세서.venues, 집계표)).toEqual([])
  })

  it('★ 1원이라도 다르면 잡는다', () => {
    const 집계표 = [
      venue('키즈웰(아름솔)', { taxableSupply: 0, vat: 0, exempt: 13841, total: 13841 }),
      venue('키즈웰(아름솔)_방과후간식', { taxableSupply: 2370, vat: 237, exempt: 0, total: 2607 }),
      { ...venue('키즈웰(우성)', { taxableSupply: 0, vat: 0, exempt: 13270, total: 13270 }), businessName: '키즈웰(우성)' },
    ]
    const found = crossCheckCjStatement(명세서.venues, 집계표)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      restaurantName: '키즈웰(아름솔)',
      kind: 'amount',
      statementTotal: 13840,
      summaryTotal: 13841,
    })
  })

  it('집계표에만 있는 식당을 잡는다 — 명세서가 빠진 것', () => {
    const 집계표 = [
      venue('키즈웰(아름솔)', { taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 }),
      venue('키즈웰(아름솔)_방과후간식', { taxableSupply: 2370, vat: 237, exempt: 0, total: 2607 }),
      { ...venue('키즈웰(우성)', { taxableSupply: 0, vat: 0, exempt: 13270, total: 13270 }), businessName: '키즈웰(우성)' },
      venue('키즈웰(아름솔)_과일', { taxableSupply: 0, vat: 0, exempt: 5000, total: 5000 }),
    ]
    const found = crossCheckCjStatement(명세서.venues, 집계표)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ restaurantName: '키즈웰(아름솔)_과일', kind: 'missingInStatement' })
  })

  it('명세서에만 있는 식당을 잡는다 — 이름이 어긋난 것일 수 있다', () => {
    const 집계표 = [
      venue('키즈웰(아름솔)', { taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 }),
      venue('키즈웰(아름솔)_방과후간식', { taxableSupply: 2370, vat: 237, exempt: 0, total: 2607 }),
    ]
    const found = crossCheckCjStatement(명세서.venues, 집계표)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ restaurantName: '키즈웰(우성)', kind: 'missingInSummary' })
  })

  it('명세서가 없으면 대조하지 않는다 — 지난 달 자료를 다시 올릴 수 있어야 한다', () => {
    const 집계표 = [venue('키즈웰(아름솔)', { taxableSupply: 0, vat: 0, exempt: 13840, total: 13840 })]
    expect(crossCheckCjStatement(null, 집계표)).toEqual([])
  })
})
