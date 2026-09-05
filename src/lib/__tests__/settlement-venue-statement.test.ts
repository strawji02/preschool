import { describe, it, expect } from 'vitest'
import { buildAdjustmentSheet } from '@/features/settlement/report/adjustment-sheet'
import {
  buildVenueStatement,
  uniqueVenueStatementTargets,
  venueStatementArchiveName,
  venueStatementEntryName,
  type VenueStatementItem,
} from '@/features/settlement'
import type { AdjustmentRecord } from '@/features/settlement/data/adjustment'

/**
 * [정산] 유치원 제공 거래명세표 + 조정 시트 (docs/systems/settlement/조정.md §19)
 *
 * ★ 2026-07-31, 국제유치원이 받고 있는 신세계 양식을 실측해 만들었다.
 * 우리 원천(`신세계_전체 일반`)과 대조한 결과 **품목·규격·단위·수량·단가가 전부
 * 일치**했고 26년 6월 합계도 26,189,271로 원단위 일치했다. 그래서 같은 문서를
 * 우리가 만들어 모든 신세계 유치원에 줄 수 있다.
 *
 * ⚠️ **금액은 가맹점(단가) 기준이다** — 유치원에 청구하는 값. 납품가(원가)가 아니다.
 */

function item(over: Partial<VenueStatementItem> = {}): VenueStatementItem {
  return {
    date: '2026-06-01',
    restaurantName: '급식재료',
    productName: '노랑 파프리카 국내산 냉장',
    spec: '1KG',
    unit: 'kg',
    quantity: 1,
    unitPrice: 9470,
    taxable: false,
    supply: 9470,
    vat: 0,
    total: 9470,
    ...over,
  }
}

const 과세품목 = item({
  productName: '데리야끼소스 롯데제과 실온',
  spec: '2KG',
  unit: '개',
  quantity: 2,
  unitPrice: 10230,
  taxable: true,
  supply: 20460,
  vat: 2046,
  total: 22506,
})

describe('buildVenueStatement — 집계표', () => {
  const built = buildVenueStatement({
    businessName: 'EDU)키즈_국제유치원(키즈웰)',
    period: '2026-06',
    issuer: {
      companyName: '키즈웰에듀푸드',
      bizRegNo: '8310503575',
      ceoName: '김중영',
      address: '서울특별시 송파구 충민로66',
    },
    items: [item(), 과세품목, item({ date: '2026-06-02', restaurantName: '오전간식', supply: 5000, total: 5000, unitPrice: 5000 })],
    adjustments: [],
  })

  it('식당별로 공급가·부가세·면세를 나눈다', () => {
    // 국제유치원 양식: 구분 | 식당 | 공급가(A) | 부가세(B) | 계 | 면세(C) | 합계액(A+B+C)
    const 급식 = built.summary.rows.find((r) => r[1] === '급식재료')!
    expect(급식[2]).toBe(20460) // 과세 공급가(A)
    expect(급식[3]).toBe(2046) // 부가세(B)
    expect(급식[4]).toBe(22506) // 계
    expect(급식[5]).toBe(9470) // 면세(C)
    expect(급식[6]).toBe(31976) // 합계액
  })

  it('계 행이 식당 합과 맞는다', () => {
    const total = built.summary.rows.find((r) => r[0] === '계')!
    expect(total[2]).toBe(20460)
    expect(total[3]).toBe(2046)
    expect(total[5]).toBe(9470 + 5000)
    expect(total[6]).toBe(31976 + 5000)
  })

  it('식당마다 시트를 만든다', () => {
    expect(built.restaurants.map((r) => r.name)).toEqual(['급식재료', '오전간식'])
  })
})

describe('buildVenueStatement — 식당 시트 (일자별 블록)', () => {
  const built = buildVenueStatement({
    businessName: '국제유치원',
    period: '2026-06',
    issuer: {
      companyName: '키즈웰에듀푸드',
      bizRegNo: '8310503575',
      ceoName: '김중영',
      address: '서울 송파구',
    },
    items: [
      item(),
      과세품목,
      item({ date: '2026-06-02', productName: '차조 농협 국내산 실온', supply: 45880, total: 45880, unitPrice: 22940, quantity: 2, unit: '봉' }),
    ],
    adjustments: [],
  })
  const sheet = built.restaurants[0]

  it('일자별로 나눈다 — 하루가 명세서 한 장이다', () => {
    expect(sheet.days.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02'])
  })

  it('일자 합계를 과세·면세로 갈라 적는다', () => {
    const d1 = sheet.days[0]
    expect(d1.taxableSupply).toBe(20460)
    expect(d1.vat).toBe(2046)
    expect(d1.exempt).toBe(9470)
    expect(d1.total).toBe(31976)
  })

  it('★ 온도를 품목명에서 뽑는다 — 원천에 별도 열이 없다', () => {
    const rows = sheet.days[0].rows
    expect(rows[0]).toContain('냉장')
    expect(rows[1]).toContain('실온')
  })

  it('월합계가 일자 합계의 합과 맞는다', () => {
    expect(sheet.monthTotal).toBe(31976 + 45880)
  })
})

describe('buildAdjustmentSheet — 조정 내역', () => {
  function rec(over: Partial<AdjustmentRecord> = {}): AdjustmentRecord {
    return {
      id: 'a1',
      period: '2026-07',
      kind: 'exclude',
      businessName: '키즈웰에듀푸드(아름솔유치원)',
      restaurantName: '키즈웰에듀푸드(아름솔유치원)',
      itemDate: '2026-07-06',
      productCode: '386323',
      productName: '명품 순두부(3Kg/EA)',
      unit: 'EA',
      quantity: 1,
      targetRestaurantName: null,
      reason: '정산제외 요청(본인부담)',
      requestedBy: '김영수',
      createdBy: 'a@b.com',
      createdAt: '2026-07-31T00:00:00Z',
      ...over,
    }
  }

  it('조정이 없으면 시트를 만들지 않는다 — 빈 시트를 붙이면 혼란만 준다', () => {
    expect(buildAdjustmentSheet([], {})).toBeNull()
  })

  it('제외·이동을 구분해 적는다', () => {
    const sheet = buildAdjustmentSheet(
      [rec(), rec({ id: 'a2', kind: 'move', targetRestaurantName: '_방과후간식', quantity: 9 })],
      { a1: 13840, a2: 225900 }
    )!
    const body = sheet.rows.slice(1)
    expect(body[0][0]).toBe('정산 제외')
    expect(body[1][0]).toBe('식당 이동')
  })

  it('★ 합계는 제외분만 센다 — 이동은 사업장 합계를 바꾸지 않는다', () => {
    const sheet = buildAdjustmentSheet(
      [rec(), rec({ id: 'a2', kind: 'move', targetRestaurantName: '_방과후간식', quantity: 9 })],
      { a1: 13840, a2: 225900 }
    )!
    expect(sheet.excludedTotal).toBe(13840)
  })

  it('사유와 요청자를 그대로 싣는다 — 이게 없으면 문서가 근거가 못 된다', () => {
    const sheet = buildAdjustmentSheet([rec()], { a1: 13840 })!
    const row = sheet.rows[1]
    expect(row).toContain('정산제외 요청(본인부담)')
    expect(row).toContain('김영수')
  })
})

describe('유치원 거래명세표 ZIP', () => {
  it('공급사·사업장코드 기준으로 중복을 제거하고 이름순으로 정렬한다', () => {
    expect(uniqueVenueStatementTargets([
      { source: 'cj', businessCode: '1016', businessName: '복자유치원' },
      { source: 'shinsegae', businessCode: '89912', businessName: '나래유치원' },
      { source: 'cj', businessCode: '1016', businessName: '복자유치원 중복' },
    ])).toEqual([
      { source: 'shinsegae', businessCode: '89912', businessName: '나래유치원' },
      { source: 'cj', businessCode: '1016', businessName: '복자유치원' },
    ])
  })

  it('정산월이 드러나는 전체 ZIP 파일명을 만든다', () => {
    expect(venueStatementArchiveName('2026-08')).toBe(
      '2026-08_유치원_거래명세표_전체.zip'
    )
  })

  it('ZIP 안에서는 공급사·사업장코드로 동명이인 파일을 구분한다', () => {
    expect(venueStatementEntryName('2026-08', {
      source: 'cj', businessCode: '1016', businessName: '복자/유치원',
    })).toBe('CJ_1016_복자_유치원_거래명세표_2026-08.xlsx')
  })
})
