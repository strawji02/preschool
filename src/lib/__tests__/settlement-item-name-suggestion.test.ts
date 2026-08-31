import { describe, expect, it } from 'vitest'
import {
  suggestInvoiceItemName,
  venueItemNameOptions,
} from '@/features/settlement'

describe('식당 품목명 추천', () => {
  it('CJ 식당명의 유치원명 뒤 접미사를 1순위 추천으로 추출한다', () => {
    expect(
      suggestInvoiceItemName(
        '키즈웰에듀푸드(흑제성당유치원_주방소모품)',
        '키즈웰에듀푸드(흑제성당유치원)'
      )
    ).toBe('주방소모품')
    expect(
      suggestInvoiceItemName(
        '키즈웰에듀푸드(흑제성당유치원_업무추진비)',
        '키즈웰에듀푸드(흑제성당유치원)'
      )
    ).toBe('업무추진비')
  })

  it('별도 접미사가 없는 식당명은 원본 텍스트를 추천한다', () => {
    expect(suggestInvoiceItemName('방과후간식', '복자유치원')).toBe('방과후간식')
  })

  it('드롭다운 후보는 같은 공급사와 같은 유치원의 값만 반환한다', () => {
    const history = [
      item('cj', '1001', 'taxable', '방과후간식'),
      item('cj', '1001', 'taxable', '방과후간식'),
      item('cj', '1001', 'taxable', '급식재료'),
      item('cj', '1001', 'exempt', '주방소모품'),
      item('cj', '9999', 'taxable', '다른 유치원 품목'),
      item('shinsegae', '1001', 'taxable', '다른 공급사 품목'),
    ]

    expect(venueItemNameOptions(history, 'cj', '1001', 'taxable')).toEqual([
      '방과후간식',
      '급식재료',
      '주방소모품',
    ])
  })

  it('같은 유치원 안에서는 동일 과세구분을 먼저, 빈도순으로 보여준다', () => {
    const history = [
      item('cj', '1001', 'exempt', '면세 우선'),
      item('cj', '1001', 'exempt', '면세 우선'),
      item('cj', '1001', 'taxable', '과세 후보'),
    ]

    expect(venueItemNameOptions(history, 'cj', '1001', 'taxable')).toEqual([
      '과세 후보',
      '면세 우선',
    ])
  })
})

function item(
  source: 'shinsegae' | 'cj',
  businessCode: string,
  taxKind: 'taxable' | 'exempt',
  invoiceItemName: string
) {
  return { source, businessCode, taxKind, invoiceItemName }
}
