import { describe, it, expect } from 'vitest'
import {
  buildShinsegaeStatement,
  formatStatementAmount,
  formatStatementDate,
  formatStatementQuantity,
} from '@/features/settlement/report/shinsegae-statement'
import type { VenueStatementItem } from '@/features/settlement/report/venue-statement'

/**
 * [정산] 신세계 유치원 거래명세표 — 원본 서식 그대로 (docs §19-2)
 *
 * ★ **왜 신세계푸드가 공급자인가.** 유치원이 신세계에서 받던 문서를 그대로 원한다.
 * 우리 단가가 신세계 청구가와 **원단위로 같다는 것을 확인**했으므로 사실과 맞는다:
 *
 * ```
 * 국제유치원 26년 6월   우리 단가        신세계 원본
 *   공급가(A)          8,897,920       8,897,920   ✓
 *   부가세(B)            889,792         889,792   ✓
 *   면세(C)           16,401,559      16,401,559   ✓
 *   합계액            26,189,271      26,189,271   ✓
 * ```
 *
 * ★ **명세서 시트는 전부 텍스트 서식(`@`)이다.** 신세계 시스템이 `'13,170'`처럼
 * 콤마까지 문자열로 찍는다. 숫자로 넣으면 표시가 어긋나므로 문자열로 만든다.
 * 반대로 집계표는 `#,##0` 숫자 서식이라 숫자로 넣는다.
 *
 * 아래 기대값은 원본 `국제 26년 6월 급식 청구서류(거래명세표).xlsx`의 오전간식
 * 시트 6개 블록에서 그대로 읽어온 것이다.
 */

/** 오전간식 6월 실제 납품 — 원본 블록의 합계와 맞아야 한다 */
function ganshik(): VenueStatementItem[] {
  const at = (
    date: string,
    productName: string,
    quantity: number,
    unitPrice: number,
    taxable: boolean
  ): VenueStatementItem => {
    const supply = quantity * unitPrice
    return {
      date,
      restaurantName: '오전간식',
      productName,
      spec: '500G',
      unit: '봉',
      quantity,
      unitPrice,
      taxable,
      supply,
      vat: taxable ? supply / 10 : 0,
      total: taxable ? supply * 1.1 : supply,
    }
  }
  return [
    at('2026-06-05', '[간납]지리멸치 특 국내산 건냉', 2, 13170, false), // 면세 26,340
    at('2026-06-08', '볶음쌀 국내산 건냉', 3, 51760, true), // 과세 155,280
    at('2026-06-12', '[간납]지리멸치 특 국내산 건냉', 2, 13170, false), // 면세 26,340
    at('2026-06-12', '두부 국내산 냉장', 2, 4460, true), // 과세 8,920
    at('2026-06-15', '볶음쌀 국내산 건냉', 3, 51760, true), // 과세 155,280
    at('2026-06-22', '볶음쌀 국내산 건냉', 2, 51760, true), // 과세 103,520
    at('2026-06-29', '볶음쌀 국내산 건냉', 2, 51760, true), // 과세 103,520
  ]
}

const INPUT = {
  businessName: '국제유치원(키즈웰)',
  period: '2026-06',
  buyer: {
    companyName: 'EDU)키즈_국제유치원(키즈웰)',
    bizRegNo: '1328049224',
    ceoName: '이정철,김춘태',
    address: '경기 남양주시 별내3로 240',
  },
}

describe('신세계 거래명세표 — 블록 합계', () => {
  const st = buildShinsegaeStatement({ ...INPUT, items: ganshik() })
  const sheet = st.sheets[0]

  it('식당마다 시트 하나, 납품일마다 블록 하나', () => {
    expect(st.sheets).toHaveLength(1)
    expect(sheet.restaurantName).toBe('오전간식')
    expect(sheet.blocks).toHaveLength(6) // 6/5·8·12·15·22·29
    expect(sheet.blocks[2].items).toHaveLength(2) // 6/12만 2건
  })

  it('일계 = 과세·면세를 나눠 적고 세액은 과세의 10%', () => {
    // 원본 블록 3 (6/12): 과세 8,920 / 면세 26,340 / 공급가액 35,260 / 세액 892 / 합계 36,152
    const b = sheet.blocks[2]
    expect(b.taxableSupply).toBe(8_920)
    expect(b.exempt).toBe(26_340)
    expect(b.supply).toBe(35_260)
    expect(b.vat).toBe(892)
    expect(b.total).toBe(36_152)
  })

  it('월합계는 그날까지의 누계다', () => {
    // 원본 6개 블록의 월합계 (공급 / 세액 / 합계)
    expect(sheet.blocks.map((b) => b.cumulativeSupply)).toEqual([
      26_340, 181_620, 216_880, 372_160, 475_680, 579_200,
    ])
    expect(sheet.blocks.map((b) => b.cumulativeVat)).toEqual([
      0, 15_528, 16_420, 31_948, 42_300, 52_652,
    ])
    expect(sheet.blocks.map((b) => b.cumulativeTotal)).toEqual([
      26_340, 197_148, 233_300, 404_108, 517_980, 631_852,
    ])
  })

  it('품목 번호는 블록마다 1부터, 페이지는 n/N', () => {
    expect(sheet.blocks[2].items.map((i) => i.no)).toEqual([1, 2])
    expect(sheet.blocks.map((b) => b.page)).toEqual([
      '1/6',
      '2/6',
      '3/6',
      '4/6',
      '5/6',
      '6/6',
    ])
  })
})

describe('신세계 거래명세표 — 집계표', () => {
  const st = buildShinsegaeStatement({ ...INPUT, items: ganshik() })

  it('식당 행은 공급가(A)·부가세(B)·계(A+B)·면세(C)·합계액(A+B+C)', () => {
    // 원본 집계표 오전간식 행: 526,520 / 52,652 / 579,172 / 52,680 / 631,852
    const row = st.summary[0]
    expect(row.no).toBe(1)
    expect(row.name).toBe('오전간식')
    expect(row.taxableSupply).toBe(526_520)
    expect(row.vat).toBe(52_652)
    expect(row.sum).toBe(579_172) // A+B — 명세서 월합계(579,200)와 뜻이 다르다
    expect(row.exempt).toBe(52_680)
    expect(row.total).toBe(631_852)
  })

  it('계 행은 식당 행의 합', () => {
    expect(st.summaryTotal.taxableSupply).toBe(526_520)
    expect(st.summaryTotal.total).toBe(631_852)
  })

  it('제목은 「<유치원>_26년 6월 급식 청구」', () => {
    expect(st.title).toBe('국제유치원(키즈웰)_26년 6월 급식 청구')
  })
})

/**
 * 표시 형식 — 명세서는 텍스트 셀이라 **우리가 콤마까지 만들어야** 한다.
 * 숫자를 그대로 넣으면 `@` 서식이라 `26340`으로 보인다.
 */
describe('신세계 거래명세표 — 텍스트 표시', () => {
  it('금액은 천단위 콤마', () => {
    expect(formatStatementAmount(26340)).toBe('26,340')
    expect(formatStatementAmount(0)).toBe('0')
  })

  it('수량은 소수 두 자리', () => {
    expect(formatStatementQuantity(2)).toBe('2.00')
    expect(formatStatementQuantity(1.5)).toBe('1.50')
  })

  it('날짜는 「2026년 06월 05일」', () => {
    expect(formatStatementDate('2026-06-05')).toBe('2026년 06월 05일')
  })
})
